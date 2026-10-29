import "dotenv/config";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    send = send;
    destroy() {}
  },
  ConverseCommand: class {
    constructor(public input: unknown) {}
  },
  ConverseStreamCommand: class {
    constructor(public input: unknown) {}
  },
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { db } from "../lib/db";
import { chat } from "../lib/chat";
import { ai } from "../lib/ai";
import { analyzeIssue, draftApplication } from "../lib/issue-analysis";
import { providerStatus } from "../lib/provider-status";
let userId = "";
function result(text: string, tool?: { name: string; input: string }) {
  return {
    output: { message: { content: [{ text }] } },
    usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    stopReason: "end_turn",
    stream: (async function* () {
      if (tool) {
        yield {
          contentBlockStart: {
            contentBlockIndex: 0,
            start: { toolUse: { name: tool.name, toolUseId: "t1" } },
          },
        };
        yield {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: tool.input } },
          },
        };
        yield { contentBlockStop: { contentBlockIndex: 0 } };
      } else
        yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text } } };
      yield { messageStop: { stopReason: tool ? "tool_use" : "end_turn" } };
      yield {
        metadata: {
          usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        },
      };
    })(),
  };
}
beforeAll(async () => {
  vi.stubEnv("AI_PROVIDER", "bedrock");
  vi.stubEnv("AWS_BEARER_TOKEN_BEDROCK", "bedrock-integration-fixture");
  vi.stubEnv("AWS_REGION", "eu-north-1");
  vi.stubEnv("BEDROCK_MODEL_ID", "fixture.model-v1:0");
  userId = (
    await db.user.create({
      data: {
        email: `bedrock-${crypto.randomUUID()}@example.test`,
        name: "Bedrock fixture",
        password: "no-login",
      },
    })
  ).id;
});
afterAll(async () => {
  await db.providerConnection.deleteMany({
    where: { id: "bedrock", model: "fixture.model-v1:0" },
  });
  if (userId) await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
  vi.unstubAllEnvs();
});
it("persists chat, deduplicates retries, scopes message identity, and records Bedrock usage", async () => {
  send.mockResolvedValue(result("Hello"));
  const requestId = crypto.randomUUID();
  const first = await chat(userId, "hello", undefined, "default", requestId);
  expect(
    (await chat(userId, "hello", undefined, "default", requestId)).id,
  ).toBe(first.id);
  expect(await db.message.count({ where: { userId } })).toBe(2);
  await expect(
    chat(userId, "changed", undefined, "default", requestId),
  ).rejects.toMatchObject({ status: 409 });
  expect(await db.usage.findFirst({ where: { userId } })).toMatchObject({
    provider: "bedrock",
    input: 20,
    output: 10,
    total: 30,
  });
  expect(await providerStatus()).toMatchObject({
    verified: true,
    region: "eu-north-1",
  });
});
it("records failed message and retries without duplicate user messages", async () => {
  const requestId = crypto.randomUUID();
  send.mockRejectedValueOnce({ name: "AccessDeniedException" });
  await expect(
    chat(userId, "retry me", undefined, "retry", requestId),
  ).rejects.toMatchObject({ code: "AI_FORBIDDEN" });
  expect(await providerStatus()).toMatchObject({
    verified: false,
    connectionFailed: true,
  });
  expect(
    (await db.message.findUniqueOrThrow({ where: { id: requestId } })).activity,
  ).toMatchObject([{ type: "error" }]);
  send.mockResolvedValueOnce(result("Recovered"));
  await chat(userId, "retry me", undefined, "retry", requestId);
  expect(
    await db.message.count({ where: { userId, conversation: "retry" } }),
  ).toBe(2);
});
it("keeps tool writes as confirmation previews and supports harmless results", async () => {
  send.mockResolvedValueOnce(result("", { name: "check_jobs", input: "{}" }));
  expect((await chat(userId, "check jobs")).activity).toMatchObject([
    { type: "result", label: "Checked run status" },
  ]);
  send.mockResolvedValueOnce(
    result("", {
      name: "start_run",
      input: JSON.stringify({ ids: ["owned-issue"] }),
    }),
  );
  expect((await chat(userId, "start run")).activity).toMatchObject([
    { type: "confirmation", action: "start_run" },
  ]);
  expect(await db.run.count({ where: { userId } })).toBe(0);
  send.mockResolvedValueOnce(
    result("", { name: "start_run", input: JSON.stringify({ ids: "bad" }) }),
  );
  await expect(chat(userId, "invalid tool")).rejects.toMatchObject({
    code: "AI_INVALID_OUTPUT",
  });
});
it("routes analysis, application drafts and structured agent output through Bedrock", async () => {
  const issue = {
    repo: "fixture/project",
    number: 1,
    title: "Fix sum",
    body: "Use addition",
  };
  send.mockResolvedValueOnce(result("Inspect arithmetic and test"));
  expect(await analyzeIssue(userId, issue)).toContain("arithmetic");
  send.mockResolvedValueOnce(result("I propose a tested fix"));
  expect(await draftApplication(userId, issue, "TypeScript")).toContain(
    "tested",
  );
  send.mockResolvedValueOnce(result('{"plan":"inspect and test"}'));
  expect(
    await ai(
      userId,
      "agent_plan",
      "plan",
      "instructions",
      undefined,
      undefined,
      {
        type: "json_schema",
        name: "plan",
        schema: {
          type: "object",
          properties: { plan: { type: "string" } },
          required: ["plan"],
          additionalProperties: false,
        },
        strict: true,
      },
    ),
  ).toContain("inspect and test");
  const purposes = await db.usage.findMany({
    where: { userId },
    select: { purpose: true, provider: true },
  });
  for (const purpose of ["issue_analysis", "application", "agent_plan"])
    expect(purposes).toContainEqual({ purpose, provider: "bedrock" });
});
