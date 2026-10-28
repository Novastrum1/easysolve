import "dotenv/config";
import { afterAll,beforeAll,expect,it,vi } from "vitest";
import { db } from "../lib/db";
import { github,syncIssues } from "../lib/github";
import { encrypt } from "../lib/security";
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
let userId = "",
  identityId = "";
beforeAll(async () => {
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64");
  userId = (
    await db.user.create({
      data: {
        email: `sync-${crypto.randomUUID()}@example.test`,
        name: "Sync fixture",
        password: "test-only",
      },
    })
  ).id;
  identityId = (
    await db.identity.create({
      data: {
        userId,
        login: "fixture-user",
        token: encrypt("provider-fixture-token"),
      },
    })
  ).id;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});
it("syncs actual provider-shaped records idempotently without creating coding jobs", async () => {
  const issue = {
    repository: { full_name: "a/b" },
    number: 42,
    title: "Real provider boundary",
    body: "Description",
    labels: [{ name: "Wave" }],
    assignees: [{ login: "fixture-user" }],
    html_url: "https://github.com/a/b/issues/42",
    state: "open",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => Response.json([issue])),
  );
  await syncIssues(userId, identityId);
  await syncIssues(userId, identityId);
  expect(await db.issue.count({ where: { userId } })).toBe(1);
  expect(await db.run.count({ where: { userId } })).toBe(0);
  expect(await db.job.count({ where: { userId, kind: "run" } })).toBe(0);
  const saved = await db.issue.findFirstOrThrow({ where: { userId } });
  expect(saved.status).toBe("ready");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({ ...issue, assignees: [], state: "closed" }),
      ),
  );
  await syncIssues(userId, identityId);
  expect(await db.issue.findUnique({ where: { id: saved.id } })).toMatchObject({
    status: "done",
    assignees: [],
  });
});
it("rejects foreign and inactive credentials and marks permission failures", async () => {
  await expect(github("other-user", identityId)).rejects.toThrow(
    "active GitHub identity",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
  );
  await expect(syncIssues(userId, identityId)).rejects.toThrow("permission");
  expect(
    await db.identity.findUnique({ where: { id: identityId } }),
  ).toMatchObject({ status: "needs_attention" });
  await db.identity.update({
    where: { id: identityId },
    data: { active: false },
  });
  await expect(github(userId, identityId)).rejects.toThrow(
    "active GitHub identity",
  );
});
