import { beforeEach, afterEach, expect, it, vi } from "vitest";
const { create, list, construct } = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  construct: vi.fn(),
}));
vi.mock("openai", () => ({
  default: class {
    constructor(options: unknown) {
      construct(options);
    }
    models = { list };
    chat = { completions: { create } };
    responses = { create };
  },
}));
vi.mock("../lib/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import {
  agentrouterConfig,
  generateAgentRouter,
  agentrouterError,
} from "../lib/providers/agentrouter";
import { generateOpenAI } from "../lib/providers/openai";
import { generateAI } from "../lib/providers";
const usage = {
  prompt_tokens: 10,
  prompt_tokens_details: { cached_tokens: 3 },
  completion_tokens: 5,
  completion_tokens_details: { reasoning_tokens: 2 },
  total_tokens: 15,
};
function stream(chunks: any[]) {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AI_PROVIDER", "agentrouter");
  vi.stubEnv("AGENTROUTER_API_KEY", "private-gateway-fixture");
  vi.stubEnv("AGENTROUTER_BASE_URL", "https://co.agentrouter.org/v1");
  vi.stubEnv("AGENTROUTER_MODEL", "gpt-6-astra");
  list.mockResolvedValue({ data: [{ id: "gpt-6-astra" }] });
  create.mockResolvedValue(
    stream([
      {
        model: "gpt-6-astra",
        choices: [
          { index: 0, delta: { content: "OK" }, finish_reason: "stop" },
        ],
      },
      { choices: [], usage },
    ]),
  );
});
afterEach(() => vi.unstubAllEnvs());
it("dispatches to the explicit gateway using only its own token and final actual usage", async () => {
  vi.stubEnv("OPENAI_API_KEY", "separate-openai-fixture");
  const result = await generateAI({
    input: "hi",
    instructions: "be concise",
    maxTokens: 32,
  });
  expect(result).toMatchObject({
    provider: "agentrouter",
    text: "OK",
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      input_tokens_details: { cached_tokens: 3 },
      output_tokens_details: { reasoning_tokens: 2 },
    },
    failure: null,
  });
  expect(construct).toHaveBeenCalledWith(
    expect.objectContaining({
      apiKey: "private-gateway-fixture",
      baseURL: "https://co.agentrouter.org/v1",
      maxRetries: 0,
    }),
  );
  expect(create.mock.calls[0][0]).toMatchObject({
    model: "gpt-6-astra",
    stream: true,
    stream_options: { include_usage: true },
  });
  expect(create.mock.calls[0][0].reasoning_effort).toBeUndefined();
});
it("queries token model access without substituting a missing model", async () => {
  list.mockResolvedValue({ data: [{ id: "available-fixture-model" }] });
  await expect(
    generateAgentRouter({ input: "hi", instructions: "hi", maxTokens: 32 }),
  ).rejects.toMatchObject({ code: "AI_MODEL_UNAVAILABLE" });
  expect(create).not.toHaveBeenCalled();
});
it("does not default to any gateway model", async () => {
  vi.stubEnv("AGENTROUTER_MODEL", "");
  await expect(
    generateAgentRouter({ input: "hi", instructions: "hi", maxTokens: 32 }),
  ).rejects.toMatchObject({ code: "AI_MODEL_REQUIRED" });
  expect(create).not.toHaveBeenCalled();
});
it.each([
  "https://api.openai.com/v1",
  "http://co.agentrouter.org/v1",
  "https://co.agentrouter.org.evil.test/v1",
  "https://co.agentrouter.org/v1?token=x",
])("rejects unsafe gateway URL %s", (url) => {
  vi.stubEnv("AGENTROUTER_BASE_URL", url);
  expect(agentrouterConfig).toThrow();
});
it("prevents direct OpenAI from receiving the configured gateway credential", async () => {
  vi.stubEnv("OPENAI_API_KEY", "private-gateway-fixture");
  await expect(
    generateOpenAI({ input: "x", instructions: "x", maxTokens: 1 }),
  ).rejects.toMatchObject({ code: "AI_CREDENTIAL_SCOPE" });
  expect(construct).not.toHaveBeenCalled();
});
it("disables redirect following on gateway requests", async () => {
  await generateAgentRouter({ input: "x", instructions: "x", maxTokens: 1 });
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}"));
  try {
    await construct.mock.calls[0][0].fetch(
      "https://co.agentrouter.org/v1/models",
      {},
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://co.agentrouter.org/v1/models",
      expect.objectContaining({ redirect: "error" }),
    );
  } finally {
    fetchMock.mockRestore();
  }
});
it("maps strict tool and output schemas without weakening them", async () => {
  create.mockResolvedValue(
    stream([
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { name: "query_issues", arguments: "{" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] },
            finish_reason: "tool_calls",
          },
        ],
      },
      { choices: [], usage },
    ]),
  );
  const result = await generateAgentRouter({
    input: "query",
    instructions: "tools",
    maxTokens: 32,
    tools: [
      {
        type: "function",
        name: "query_issues",
        strict: true,
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    ],
    format: {
      type: "json_schema",
      name: "fixture",
      strict: true,
      schema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  });
  expect(result.calls).toEqual([{ name: "query_issues", arguments: "{}" }]);
  expect(create.mock.calls[0][0]).toMatchObject({
    tools: [
      { type: "function", function: { name: "query_issues", strict: true } },
    ],
    response_format: { type: "json_schema", json_schema: { strict: true } },
  });
});
it("rejects interrupted streams even with text and usage", async () => {
  create.mockResolvedValue(
    stream([
      {
        choices: [
          { index: 0, delta: { content: "partial" }, finish_reason: null },
        ],
        usage,
      },
    ]),
  );
  expect(
    (
      await generateAgentRouter({
        input: "x",
        instructions: "x",
        maxTokens: 32,
      })
    ).failure?.code,
  ).toBe("AI_STREAM_INTERRUPTED");
});
it("requires actual usage receipts and retains incomplete usage", async () => {
  create.mockResolvedValueOnce(
    stream([
      {
        choices: [{ index: 0, delta: { content: "x" }, finish_reason: "stop" }],
      },
    ]),
  );
  expect(
    (
      await generateAgentRouter({
        input: "x",
        instructions: "x",
        maxTokens: 32,
      })
    ).failure?.code,
  ).toBe("AI_USAGE_MISSING");
  create.mockResolvedValueOnce(
    stream([
      { choices: [{ index: 0, delta: {}, finish_reason: "length" }], usage },
    ]),
  );
  const result = await generateAgentRouter({
    input: "x",
    instructions: "x",
    maxTokens: 32,
  });
  expect(result.failure?.code).toBe("AI_INCOMPLETE");
  expect(result.usage?.total_tokens).toBe(15);
});
it("reports client restrictions without bypassing or leaking error contents", () => {
  const e = agentrouterError({
    status: 401,
    message:
      "unauthorized client detected, contact support for assistance private-gateway-fixture",
  });
  expect(e).toMatchObject({ code: "AI_CLIENT_RESTRICTED", retryable: false });
  expect(e.message).not.toContain("private-gateway-fixture");
  expect(e.message).toContain("neo@agentrouter.org");
});
it("stops after authentication rejection", async () => {
  list.mockRejectedValue({
    status: 401,
    message: "unauthorized client detected",
  });
  await expect(
    generateAgentRouter({ input: "x", instructions: "x", maxTokens: 32 }),
  ).rejects.toMatchObject({ code: "AI_CLIENT_RESTRICTED" });
  expect(create).not.toHaveBeenCalled();
});
