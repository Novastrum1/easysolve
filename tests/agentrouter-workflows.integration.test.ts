import "dotenv/config";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
const { create, list } = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    models = { list };
    chat = { completions: { create } };
  },
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { db } from "../lib/db";
import { chat } from "../lib/chat";
import { ai } from "../lib/ai";
import { providerFingerprint, providerStatus } from "../lib/provider-status";
let userId = "";
function result(text: string, tool?: { name: string; arguments: string }) {
  return (async function* () {
    yield {
      model: "gpt-6-astra",
      choices: [
        {
          index: 0,
          delta: tool
            ? { tool_calls: [{ index: 0, function: tool }] }
            : { content: text },
          finish_reason: tool ? "tool_calls" : "stop",
        },
      ],
    };
    yield {
      choices: [],
      usage: {
        prompt_tokens: 20,
        prompt_tokens_details: { cached_tokens: 5 },
        completion_tokens: 10,
        completion_tokens_details: { reasoning_tokens: 3 },
        total_tokens: 30,
      },
    };
  })();
}
beforeAll(async () => {
  process.env.AI_PROVIDER = "agentrouter";
  process.env.AGENTROUTER_API_KEY = "gateway-workflow-fixture";
  process.env.AGENTROUTER_MODEL = "gpt-6-astra";
  list.mockResolvedValue({ data: [{ id: "gpt-6-astra" }] });
  userId = (
    await db.user.create({
      data: {
        email: `ar-${crypto.randomUUID()}@example.test`,
        name: "Gateway fixture",
        password: "no-login",
      },
    })
  ).id;
});
afterAll(async () => {
  await db.providerConnection.deleteMany({
    where: { fingerprint: providerFingerprint() },
  });
  await db.user.delete({ where: { id: userId } });
  await db.rateLimit.deleteMany({ where: { key: `ai:${userId}` } });
  await db.$disconnect();
});
it("uses the gateway for persisted chat and records actual gateway usage separately", async () => {
  create.mockResolvedValueOnce(result("Gateway fixture response"));
  expect((await chat(userId, "hello")).content).toBe(
    "Gateway fixture response",
  );
  expect(await db.usage.findFirst({ where: { userId } })).toMatchObject({
    provider: "agentrouter",
    model: "gpt-6-astra",
    input: 20,
    cached: 5,
    reasoning: 3,
    output: 10,
    total: 30,
  });
  expect(await providerStatus()).toMatchObject({
    id: "agentrouter",
    name: "AgentRouter",
    verified: true,
  });
});
it("runs harmless owned-issue queries and keeps start-run actions behind confirmation", async () => {
  const issue = await db.issue.create({
    data: {
      userId,
      identityId: "fixture",
      repo: "fixture/project",
      number: 1,
      title: "Fix arithmetic",
      url: "https://example.test",
    },
  });
  create.mockResolvedValueOnce(
    result("", { name: "query_issues", arguments: "{}" }),
  );
  expect((await chat(userId, "query issues")).activity).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: "Queried your issues" }),
    ]),
  );
  create.mockResolvedValueOnce(
    result("", {
      name: "start_run",
      arguments: JSON.stringify({ ids: [issue.id] }),
    }),
  );
  expect((await chat(userId, "start this issue")).activity).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "confirmation", action: "start_run" }),
    ]),
  );
  expect(await db.run.count({ where: { userId } })).toBe(0);
});
it("passes strict schemas through the common AI path without using Responses", async () => {
  create.mockResolvedValueOnce(result('{"ok":true}'));
  await expect(
    ai(userId, "schema", "return JSON", "concise", undefined, undefined, {
      type: "json_schema",
      name: "fixture",
      strict: true,
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    }),
  ).resolves.toBe('{"ok":true}');
  expect(create.mock.calls.at(-1)?.[0].response_format).toMatchObject({
    type: "json_schema",
    json_schema: { strict: true },
  });
});
