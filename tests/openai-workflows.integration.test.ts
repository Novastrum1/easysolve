import "dotenv/config";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const { create, gh } = vi.hoisted(() => ({
  create: vi.fn(),
  gh: { request: vi.fn(), pages: vi.fn() },
}));
vi.mock("openai", () => ({
  default: class {
    responses = { create };
  },
}));
vi.mock("../lib/github", () => ({ github: vi.fn().mockResolvedValue(gh) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { db } from "../lib/db";
import { ai } from "../lib/ai";
import { chat } from "../lib/chat";
import { analyzeIssue, draftApplication } from "../lib/issue-analysis";
import { prepareWave } from "../lib/wave";
import { handleAccount } from "../lib/routes/account";
import { providerStatus, providerFingerprint } from "../lib/provider-status";
import { startRuns } from "../lib/queue";
import { executeRun } from "../worker/agent";
let userId = "";
const issue = {
  repo: "fixture/project",
  number: 1,
  title: "Fix sum",
  body: "sum.cjs subtracts instead of adding. Run node --test. Keep the regression test.",
  url: "https://example.test/1",
};
function events(text: string, calls: any[] = []) {
  return (async function* () {
    yield {
      type: "response.completed",
      response: {
        status: "completed",
        model: "gpt-6-astra",
        output: calls.length
          ? calls
          : [{ type: "message", content: [{ type: "output_text", text }] }],
        usage: {
          input_tokens: 20,
          input_tokens_details: { cached_tokens: 5 },
          output_tokens: 10,
          output_tokens_details: { reasoning_tokens: 4 },
          total_tokens: 30,
        },
      },
    };
  })();
}
function reply(text: string) {
  create.mockResolvedValueOnce(events(text));
}
function call(name: string, args: unknown = {}) {
  create.mockResolvedValueOnce(
    events("", [
      { type: "function_call", name, arguments: JSON.stringify(args) },
    ]),
  );
}
beforeAll(async () => {
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "mocked-provider-fixture";
  userId = (
    await db.user.create({
      data: {
        issueLimitOverride: 100,
        email: `openai-workflows-${crypto.randomUUID()}@example.test`,
        name: "Provider fixture",
        password: "no-login",
      },
    })
  ).id;
});
beforeEach(() => {
  vi.clearAllMocks();
  create.mockReset();
});
afterAll(async () => {
  await db.providerConnection.deleteMany({
    where: { fingerprint: providerFingerprint() },
  });
  await db.user.delete({ where: { id: userId } });
  await db.rateLimit.deleteMany({ where: { key: `ai:${userId}` } });
  await db.$disconnect();
});
it("persists chat, validates real tool calls, and does not start unconfirmed jobs", async () => {
  const i = await db.issue.create({
    data: { ...issue, userId, identityId: "fixture" },
  });
  reply("Hello from the mocked Responses boundary.");
  expect((await chat(userId, "Hello")).content).toContain("Responses");
  call("query_issues");
  expect((await chat(userId, "Query my issues")).activity).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: "Queried your issues" }),
    ]),
  );
  call("start_run", { ids: [i.id] });
  const result = await chat(userId, "Start the issue");
  expect(result.activity).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "confirmation", action: "start_run" }),
    ]),
  );
  expect(await db.run.count({ where: { userId } })).toBe(0);
  expect(await db.message.count({ where: { userId } })).toBe(6);
  expect(create.mock.calls[0][0]).toMatchObject({
    model: "gpt-6-astra",
    tools: expect.any(Array),
    parallel_tool_calls: false,
  });
});
it("routes analysis, editable drafts, contribution matching and planning through OpenAI", async () => {
  reply("Inspect the arithmetic module and add a regression test.");
  expect(await analyzeIssue(userId, issue)).toContain("regression");
  reply("I can add a Node test based on my supplied experience.");
  expect(
    await draftApplication(userId, issue, "I write Node tests."),
  ).toContain("Node");
  gh.pages.mockResolvedValue([{ ...issue, assignees: [], labels: [] }]);
  reply(
    JSON.stringify({
      matches: [{ number: 1, reason: "Node testing experience" }],
    }),
  );
  reply("Editable proposed approach and tests.");
  const result = await prepareWave(userId, {
    identityId: "fixture",
    repo: issue.repo,
    experience: "I write Node tests.",
    wave: "",
    complexity: "small",
    languages: ["JavaScript"],
    count: 1,
    numbers: [],
  });
  expect(result.applications[0].draft).toContain("Editable");
  expect(create.mock.calls[2][0].text.format).toMatchObject({
    type: "json_schema",
    strict: true,
  });
  const [run] = await startRuns(userId, [
    (await db.issue.findFirstOrThrow({ where: { userId } })).id,
  ]);
  await db.run.update({ where: { id: run.id }, data: { mode: "plan" } });
  gh.request.mockImplementation(async (path: string) => {
    if (path === `/repos/${issue.repo}`) return { default_branch: "main" };
    if (path.includes("/git/ref/")) return { object: { sha: "base" } };
    if (path.includes("/git/commits/")) return { tree: { sha: "tree" } };
    return { tree: [] };
  });
  reply("Read the module, fix sum, and run the tests.");
  await executeRun(userId, run.id);
  expect(
    (await db.run.findUniqueOrThrow({ where: { id: run.id } })).status,
  ).toBe("planned");
});
it("tests the actual worker read, failing test, repair, test and approval path with an SDK mock and real Docker", async () => {
  const i = await db.issue.create({
    data: { ...issue, number: 2, userId, identityId: "fixture" },
  });
  const [run] = await startRuns(userId, [i.id]);
  const files: Record<string, string> = {
    "sum.cjs": "exports.sum=(a,b)=>a-b;",
    "sum.test.cjs":
      "const {test}=require('node:test');const assert=require('node:assert/strict');const {sum}=require('./sum.cjs');test('sum',()=>assert.equal(sum(2,3),5));",
  };
  gh.request.mockImplementation(async (path: string) => {
    if (path === `/repos/${issue.repo}`) return { default_branch: "main" };
    if (path.includes("/git/ref/")) return { object: { sha: "base" } };
    if (path.includes("/git/commits/")) return { tree: { sha: "tree" } };
    if (path.includes("/git/trees/"))
      return {
        tree: Object.keys(files).map((path) => ({
          path,
          type: "blob",
          mode: "100644",
          size: files[path].length,
          sha: path,
        })),
      };
    const name = path.split("/git/blobs/")[1];
    if (name in files)
      return { content: Buffer.from(files[name]).toString("base64") };
    throw Error("Unexpected GitHub boundary request");
  });
  const action = (fields: Record<string, unknown>) =>
    reply(
      JSON.stringify({
        plan: "Inspect and repair arithmetic",
        path: null,
        content: null,
        command: null,
        summary: null,
        ...fields,
      }),
    );
  action({ action: "read", path: "sum.cjs" });
  action({ action: "test", command: "node --test sum.test.cjs" });
  action({
    action: "write",
    path: "sum.cjs",
    content: "exports.sum=(a,b)=>a+b;",
  });
  action({ action: "test", command: "node --test sum.test.cjs" });
  action({ action: "finish" });
  await executeRun(userId, run.id);
  const saved = await db.run.findUniqueOrThrow({ where: { id: run.id } });
  expect(saved.status).toBe("awaiting_review");
  expect(saved.tests).toContain("fail 1");
  expect(saved.tests).toContain("pass 1");
  expect(saved.artifacts).toMatchObject({
    "sum.cjs": "exports.sum=(a,b)=>a+b;",
  });
  expect(gh.request.mock.calls.every((c) => !c[1] || c[1] === "GET")).toBe(
    true,
  );
  expect(create.mock.calls[0][0].text.format).toMatchObject({
    type: "json_schema",
    strict: true,
  });
  expect(create.mock.calls[2][0].input).toContain("exitCode");
  expect(
    await db.usage.count({
      where: { userId, runId: run.id, purpose: "repair" },
    }),
  ).toBeGreaterThanOrEqual(1);
}, 30000);
it("denies non-admin connection tests and binds verification to key/model", async () => {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const ctx = {
    request: new Request("http://localhost/api/provider/test", {
      method: "POST",
    }),
    path: ["provider", "test"],
    body: {},
    url: new URL("http://localhost"),
    u,
  };
  delete process.env.AI_ADMIN_USER_IDS;
  delete process.env.OPENAI_ADMIN_USER_IDS;
  await expect(handleAccount(ctx)).rejects.toMatchObject({ status: 403 });
  expect(create).not.toHaveBeenCalled();
  process.env.OPENAI_ADMIN_USER_IDS = userId;
  reply("EASYSOLVE_OK");
  const response = await handleAccount(ctx);
  expect(await response!.json()).toMatchObject({
    configured: true,
    verified: true,
    modelName: "GPT-6 Astra",
  });
  process.env.OPENAI_MODEL = "other-model";
  expect((await providerStatus()).verified).toBe(false);
  delete process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = "another-fixture";
  expect((await providerStatus()).verified).toBe(false);
  process.env.OPENAI_API_KEY = "mocked-provider-fixture";
  delete process.env.AI_ADMIN_USER_IDS;
  delete process.env.OPENAI_ADMIN_USER_IDS;
});
it("enforces input, job token/request budgets, and request rate ceilings before SDK calls", async () => {
  for (const [name, value, runId] of [
    ["AI_MAX_INPUT_BYTES", "1", undefined],
    ["AI_JOB_MAX_TOKENS", "1", "budget-fixture"],
    ["AI_JOB_MAX_REQUESTS", "1", "request-fixture"],
    ["AI_REQUESTS_PER_MINUTE", "1", undefined],
  ] as const) {
    process.env[name] = value;
    if (name === "AI_JOB_MAX_REQUESTS")
      await db.aIRequest.create({ data: { userId, runId } });
    try {
      await expect(
        ai(userId, "budget", "hello", "concise", runId),
      ).rejects.toBeInstanceOf(Error);
      expect(create).not.toHaveBeenCalled();
    } finally {
      delete process.env[name];
    }
  }
});
it("preserves billed incomplete usage and reasoning without accepting partial output", async () => {
  create.mockResolvedValueOnce(
    (async function* () {
      yield {
        type: "response.incomplete",
        response: {
          status: "incomplete",
          model: "gpt-6-astra",
          output: [],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
            output_tokens_details: { reasoning_tokens: 4 },
          },
        },
      };
    })(),
  );
  await expect(
    ai(userId, "incomplete", "hello", "concise"),
  ).rejects.toMatchObject({ code: "AI_INCOMPLETE" });
  expect(
    await db.usage.findFirst({ where: { userId, purpose: "incomplete" } }),
  ).toMatchObject({ provider: "openai", total: 15, reasoning: 4 });
  expect((await providerStatus()).verified).toBe(false);
});
