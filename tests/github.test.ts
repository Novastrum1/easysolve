import { afterEach,expect,it,vi } from "vitest";
import { GitHub } from "../lib/github";
vi.mock("../lib/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it("uses server credentials and propagates permission failures without leaking credentials", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response('{"message":"secret"}', { status: 403 }));
  vi.stubGlobal("fetch", fetch);
  await expect(new GitHub("private").request("/user")).rejects.toThrow(
    "permission or rate limit denied",
  );
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer private");
});
it("handles paginated issue results without silently truncating", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(Array.from({ length: 100 }, (_, n) => ({ n }))),
      )
      .mockResolvedValueOnce(Response.json([{ n: 100 }])),
  );
  const items = await new GitHub("x").pages("/issues?state=open");
  expect(items).toHaveLength(101);
});
it("supports successful 204 permission validation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  );
  await expect(
    new GitHub("x").request("/repos/a/b/assignees/user"),
  ).resolves.toBeUndefined();
});
