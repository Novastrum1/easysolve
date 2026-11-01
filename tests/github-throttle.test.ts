import { afterEach, expect, it, vi } from "vitest";
import { GitHub } from "../lib/github";

const state = vi.hoisted(() => ({
  row: null as {
    blockedUntil?: Date | null;
    nextAllowedAt?: Date | null;
  } | null,
  upserts: [] as any[],
}));
vi.mock("../lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: (tx: any) => unknown) =>
      fn({
        $executeRaw: vi.fn(),
        githubThrottle: {
          findUnique: vi.fn(async () => state.row),
          upsert: vi.fn(async ({ create, update }: any) => {
            const value = { ...(state.row ?? {}), ...create, ...update };
            state.row = value;
            state.upserts.push(value);
            return value;
          }),
        },
      }),
    ),
    githubThrottle: {
      upsert: vi.fn(async ({ create, update }: any) => {
        const value = { ...(state.row ?? {}), ...create, ...update };
        state.row = value;
        state.upserts.push(value);
        return value;
      }),
    },
  },
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

afterEach(() => {
  state.row = null;
  state.upserts.length = 0;
  vi.unstubAllGlobals();
});

it("coordinates requests for the same EasySolve user across GitHub clients", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ ok: true })),
  );
  await new GitHub("token-a", "user:one").request("/user");
  await new GitHub("token-b", "user:one").request("/user");
  expect(state.upserts.length).toBe(2);
  expect(state.upserts.every((row) => row.key === "github:user:one")).toBe(
    true,
  );
});

it("stops after GitHub reports a retryable rate or abuse limit", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response('{"message":"You have exceeded a secondary rate limit."}', {
      status: 403,
      headers: {
        "retry-after": "60",
        "x-ratelimit-remaining": "0",
      },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const client = new GitHub("token", "user:one");
  const first = client.request("/user");
  await expect(first).rejects.toMatchObject({ status: 429 });
  await expect(client.request("/user")).rejects.toMatchObject({ status: 429 });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("pauses instead of burning execution time during long coordinated pacing", async () => {
  state.row = { nextAllowedAt: new Date(Date.now() + 60000) };
  const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    new GitHub("token", "user:one").request("/repos/a/b"),
  ).rejects.toMatchObject({
    status: 429,
  });
  expect(fetch).not.toHaveBeenCalled();
});
