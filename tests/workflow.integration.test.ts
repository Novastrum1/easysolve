import "dotenv/config";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db } from "../lib/db";
import { claimJob, enqueue, startRuns } from "../lib/queue";
import { hash } from "../lib/security";
import { executeRun, publish } from "../worker/agent";
const { gh, model, sandbox } = vi.hoisted(() => ({
  gh: { request: vi.fn(), pages: vi.fn() },
  model: vi.fn(),
  sandbox: { create: vi.fn(), op: vi.fn(), destroy: vi.fn() },
}));
vi.mock("../lib/github", () => ({ github: vi.fn().mockResolvedValue(gh) }));
vi.mock("../lib/ai", () => ({ ai: model }));
vi.mock("../worker/sandbox", () => ({
  Sandbox: class {
    create = sandbox.create;
    op = sandbox.op;
    destroy = sandbox.destroy;
  },
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
let userId = "",
  otherId = "";
let serial = 0;
async function issue(repo = "test/project") {
  return db.issue.create({
    data: {
      userId,
      identityId: "test-identity",
      repo,
      number: ++serial,
      title: "Fix arithmetic",
      body: "Return the sum of two numbers.",
      url: "https://github.com/test/project/issues/1",
    },
  });
}
beforeAll(async () => {
  userId = (
    await db.user.create({
      data: {
        issueLimitOverride: 100,
        email: `integration-${crypto.randomUUID()}@example.test`,
        name: "Integration fixture",
        password: "not-a-real-password",
      },
    })
  ).id;
  otherId = (
    await db.user.create({
      data: {
        email: `integration-${crypto.randomUUID()}@example.test`,
        name: "Other fixture",
        password: "not-a-real-password",
      },
    })
  ).id;
});
afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await db.$disconnect();
});
beforeEach(() => {
  vi.clearAllMocks();
  sandbox.op.mockResolvedValue("Files written");
  gh.request.mockImplementation(async (path: string) => {
    if (path === "/repos/test/project")
      return { default_branch: "main", permissions: { push: true } };
    if (path.includes("/git/ref/heads/main"))
      return { object: { sha: "base-sha" } };
    if (path.includes("/git/commits/base-sha"))
      return { tree: { sha: "tree-sha" } };
    if (path.includes("/git/trees/tree-sha"))
      return {
        tree: [
          {
            path: "sum.js",
            type: "blob",
            mode: "100644",
            size: 38,
            sha: "blob",
          },
        ],
      };
    if (path.includes("/git/blobs/blob"))
      return {
        content: Buffer.from("export const sum=(a,b)=>a-b;").toString("base64"),
      };
    throw Error(`Unexpected provider request ${path}`);
  });
});
describe("durable issue → run → approval → PR workflow", () => {
  it("enforces user ownership and prevents concurrent duplicate issue runs", async () => {
    const i = await issue();
    await expect(startRuns(otherId, [i.id])).rejects.toThrow("unavailable");
    const results = await Promise.allSettled([
      startRuns(userId, [i.id]),
      startRuns(userId, [i.id]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.run.count({
        where: { userId, issueIds: { array_contains: [i.id] } },
      }),
    ).toBe(1);
  });
  it("imports never enqueue runs and batches at most four per repository", async () => {
    const list = await Promise.all(
      Array.from({ length: 6 }, () => issue("test/batching")),
    );
    expect(
      await db.job.count({
        where: { userId, payload: { path: ["runId"], equals: list[0].id } },
      }),
    ).toBe(0);
    const runs = await startRuns(
      userId,
      list.map((i) => i.id),
    );
    expect(runs.map((r) => (r.issueIds as string[]).length).sort()).toEqual([
      2, 4,
    ]);
  });
  it("recovers an expired lease and preserves queue idempotency", async () => {
    const job = await enqueue(
      userId,
      "test",
      `test:${crypto.randomUUID()}`,
      {},
    );
    expect((await enqueue(userId, "test", job.key, {})).id).toBe(job.id);
    await db.job.updateMany({
      where: { userId, status: "queued" },
      data: { availableAt: new Date(Date.now() + 86400000) },
    });
    await db.job.update({
      where: { id: job.id },
      data: { status: "running", leaseUntil: new Date(Date.now() - 1000) },
    });
    const claimed = await claimJob();
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.attempts).toBe(1);
    await db.job.update({
      where: { id: job.id },
      data: { status: "completed" },
    });
  });
  it("plan-only mode never starts a sandbox or writes to GitHub", async () => {
    const i = await issue();
    await db.user.update({
      where: { id: userId },
      data: { settings: { mode: "plan" } },
    });
    const [run] = await startRuns(userId, [i.id]);
    model.mockResolvedValue("Inspect sum.js and fix subtraction.");
    await executeRun(userId, run.id);
    expect(sandbox.create).not.toHaveBeenCalled();
    expect(gh.request.mock.calls.every((c) => !c[1] || c[1] === "GET")).toBe(
      true,
    );
    expect(
      (await db.run.findUniqueOrThrow({ where: { id: run.id } })).status,
    ).toBe("planned");
    await expect(publish(userId, run.id)).rejects.toThrow("approval");
    await db.user.update({ where: { id: userId }, data: { settings: {} } });
  });
  it("saves actual patch and test output, blocks unapproved publication, publishes once", async () => {
    const i = await issue();
    await db.user.update({
      where: { id: userId },
      data: { settings: { mode: "approval" } },
    });
    const [run] = await startRuns(userId, [i.id]);
    model
      .mockResolvedValueOnce(
        JSON.stringify({
          plan: "Fix sum",
          action: "read",
          path: "sum.js",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          ...{ path: null, content: null, command: null, summary: null },
          plan: "Fix sum",
          action: "write",
          path: "sum.js",
          content: "export const sum=(a,b)=>a+b;",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          ...{ path: null, content: null, command: null, summary: null },
          plan: "Verify sum",
          action: "test",
          command: "node --test",
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          ...{ path: null, content: null, command: null, summary: null },
          plan: "Fix sum",
          action: "finish",
        }),
      );
    sandbox.op.mockImplementation(async (op: any) =>
      op.type === "test"
        ? JSON.stringify({ exitCode: 0, stdout: "1 test passed", stderr: "" })
        : op.type === "read"
          ? "export const sum=(a,b)=>a-b;"
          : "Files written",
    );
    await executeRun(userId, run.id);
    let saved = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("awaiting_review");
    expect(saved.diff).toContain("+export const sum=(a,b)=>a+b;");
    expect(saved.tests).toContain("1 test passed");
    expect(saved.headSha).toBe(hash(JSON.stringify(saved.artifacts)));
    await expect(publish(userId, run.id)).rejects.toThrow("approval");
    let published = false;
    let branch = false;
    let commits = 0,
      prs = 0;
    gh.request.mockImplementation(async (path: string, method?: string) => {
      if (path === "/user") return { id: 7, login: "contributor" };
      if (path.includes("/pulls?head="))
        return published
          ? [{ number: 7, html_url: "https://github.com/test/project/pull/7" }]
          : [];
      if (path.includes("/git/commits/base-sha"))
        return { tree: { sha: "base-tree" } };
      if (path.includes("/git/ref/heads/")) {
        if (!branch) throw Error("GitHub 404: request failed");
        return { object: { sha: "commit-sha" } };
      }
      if (path.endsWith("/git/trees") && method === "POST")
        return { sha: "new-tree" };
      if (path.endsWith("/git/commits") && method === "POST") {
        commits++;
        return { sha: "commit-sha" };
      }
      if (path.endsWith("/git/refs")) {
        branch = true;
        return {};
      }
      if (path === "/repos/test/project")
        return { default_branch: "main", permissions: { push: true } };
      if (path.endsWith("/pulls") && method === "POST") {
        published = true;
        prs++;
        return {
          number: 7,
          html_url: "https://github.com/test/project/pull/7",
        };
      }
      throw Error(path);
    });
    await db.run.update({
      where: { id: run.id },
      data: { approvedSha: saved.headSha },
    });
    await publish(userId, run.id);
    await publish(userId, run.id);
    saved = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("published");
    expect(saved.prNumber).toBe(7);
    expect(commits).toBe(1);
    expect(prs).toBe(1);
    await db.user.update({ where: { id: userId }, data: { settings: {} } });
  });
  it("rejects stale approval and cancellation before sandbox creation", async () => {
    const i = await issue();
    const [run] = await startRuns(userId, [i.id]);
    await db.run.update({
      where: { id: run.id },
      data: { status: "awaiting_review", headSha: "new", approvedSha: "old" },
    });
    await expect(publish(userId, run.id)).rejects.toThrow("stale");
    await db.run.update({
      where: { id: run.id },
      data: { status: "cancelled" },
    });
    await executeRun(userId, run.id);
    expect(sandbox.create).not.toHaveBeenCalled();
  });
  it("enforces server plan ceilings when user settings try to raise them", async () => {
    const i = await issue();
    const before = process.env.PLAN_MAX_JOBS;
    process.env.PLAN_MAX_JOBS = "1";
    await db.user.update({
      where: { id: userId },
      data: { settings: { monthlyJobs: 9999 } },
    });
    await expect(startRuns(userId, [i.id])).rejects.toThrow(
      "Monthly job limit",
    );
    if (before === undefined) delete process.env.PLAN_MAX_JOBS;
    else process.env.PLAN_MAX_JOBS = before;
    await db.user.update({ where: { id: userId }, data: { settings: {} } });
  });
});

it("publishes via a verified contributor fork when upstream write access is absent", async () => {
  const i = await issue();
  const [run] = await startRuns(userId, [i.id]);
  const files = { "sum.js": "export const sum=(a,b)=>a+b;" };
  const { patchHash } = await import("../lib/security");
  const fingerprint = patchHash(files);
  await db.run.update({
    where: { id: run.id },
    data: {
      status: "awaiting_review",
      baseSha: "base",
      headSha: fingerprint,
      approvedSha: fingerprint,
      artifacts: files,
      plan: "Fix sum",
      tests: "Not run",
    },
  });
  let forked = false;
  gh.request.mockImplementation(async (path: string, method?: string) => {
    if (path === "/repos/test/project")
      return { default_branch: "main", permissions: { push: false } };
    if (path === "/user") return { login: "contributor" };
    if (path === "/repos/contributor/project") {
      if (!forked) throw Error("GitHub 404");
      return { parent: { full_name: "test/project" } };
    }
    if (path === "/repos/test/project/forks") {
      forked = true;
      return { parent: { full_name: "test/project" } };
    }
    if (path.includes("/pulls?head=")) return [];
    if (path === "/repos/contributor/project/git/commits/base")
      return { tree: { sha: "parent-tree" } };
    if (path === "/repos/contributor/project/git/trees")
      return { sha: "patched-tree" };
    if (path.includes("/git/ref/heads/")) throw Error("GitHub 404");
    if (path === "/repos/contributor/project/git/commits")
      return { sha: "commit" };
    if (path === "/repos/contributor/project/git/refs") return {};
    if (path === "/repos/test/project/pulls")
      return {
        number: 42,
        html_url: "https://github.com/test/project/pull/42",
      };
    throw Error(path);
  });
  await publish(userId, run.id);
  expect(gh.request).toHaveBeenCalledWith("/repos/test/project/forks", "POST", {
    default_branch_only: true,
  });
  expect(gh.request).toHaveBeenCalledWith(
    "/repos/test/project/pulls",
    "POST",
    expect.objectContaining({ head: `contributor:${run.branch}`, draft: true }),
  );
  expect(gh.request).toHaveBeenCalledWith(
    "/repos/contributor/project/git/commits",
    "POST",
    expect.objectContaining({
      author: expect.objectContaining({ date: run.createdAt.toISOString() }),
    }),
  );
  expect(
    (await db.run.findUniqueOrThrow({ where: { id: run.id } })).prNumber,
  ).toBe(42);
});

it("cancels durable work and can requeue failed publication without inventing success", async () => {
  const { handleRuns } = await import("../lib/routes/runs");
  const { approveRun } = await import("../lib/queue");
  const i = await issue();
  const [run] = await startRuns(userId, [i.id]);
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  await handleRuns({
    u,
    request: new Request("http://localhost/api", { method: "POST" }),
    path: ["runs", run.id, "cancel"],
    body: {},
    url: new URL("http://localhost"),
  });
  expect(
    (await db.job.findUniqueOrThrow({ where: { key: `run:${run.id}` } }))
      .status,
  ).toBe("cancelled");
  expect(
    (await db.issue.findUniqueOrThrow({ where: { id: i.id } })).status,
  ).toBe("ready");
  await expect(approveRun(userId, run.id, "sha")).rejects.toThrow(
    "not awaiting",
  );
  await db.run.update({
    where: { id: run.id },
    data: { status: "awaiting_review", headSha: "sha" },
  });
  const job = await approveRun(userId, run.id, "sha");
  await db.job.update({
    where: { id: job.id },
    data: { status: "failed", attempts: 3, error: "provider failure" },
  });
  await approveRun(userId, run.id, "sha");
  expect(
    await db.job.findUniqueOrThrow({ where: { id: job.id } }),
  ).toMatchObject({ status: "queued", attempts: 0, error: null });
  await expect(approveRun(otherId, run.id, "sha")).rejects.toThrow(
    "not awaiting",
  );
});

it("validates an existing PR against the approved patch before recovering publication", async () => {
  const i = await issue();
  const [run] = await startRuns(userId, [i.id]);
  const files = { "sum.js": "fixed" };
  const { patchHash } = await import("../lib/security");
  const sha = patchHash(files);
  await db.run.update({
    where: { id: run.id },
    data: {
      status: "awaiting_review",
      artifacts: files,
      baseSha: "base",
      headSha: sha,
      approvedSha: sha,
    },
  });
  let matching = false;
  gh.request.mockImplementation(async (path: string, method?: string) => {
    if (path === "/user") return { id: 7, login: "contributor" };
    if (path === "/repos/test/project")
      return { default_branch: "main", permissions: { push: true } };
    if (path.includes("/pulls?head="))
      return [
        {
          number: 9,
          head: { sha: "existing" },
          html_url: "https://github.com/test/project/pull/9",
        },
      ];
    if (path.endsWith("/git/commits/base"))
      return { tree: { sha: "base-tree" } };
    if (path.endsWith("/git/trees")) return { sha: "approved-tree" };
    if (path.includes("/git/ref/heads/"))
      return { object: { sha: "existing" } };
    if (path.endsWith("/git/commits/existing"))
      return {
        tree: { sha: matching ? "approved-tree" : "different-tree" },
        parents: [{ sha: "base" }],
        message: run.title,
      };
    throw Error(path);
  });
  await expect(publish(userId, run.id)).rejects.toThrow("changed externally");
  expect(
    (await db.run.findUniqueOrThrow({ where: { id: run.id } })).status,
  ).toBe("awaiting_review");
  matching = true;
  await publish(userId, run.id);
  expect(
    (await db.run.findUniqueOrThrow({ where: { id: run.id } })).prNumber,
  ).toBe(9);
  expect(
    gh.request.mock.calls.filter(
      (c) => c[0].endsWith("/pulls") && c[1] === "POST",
    ),
  ).toHaveLength(0);
});
