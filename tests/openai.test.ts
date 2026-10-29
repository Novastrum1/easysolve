import { beforeEach, afterEach, it, expect, vi } from "vitest";
const { create, constructor } = vi.hoisted(() => ({
  create: vi.fn(),
  constructor: vi.fn(),
}));
vi.mock("openai", () => ({
  default: class {
    constructor(options: unknown) {
      constructor(options);
    }
    responses = { create };
  },
}));
vi.mock("../lib/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { generateOpenAI, providerError } from "../lib/providers/openai";
function events(response: any, type = "response.completed") {
  return (async function* () {
    yield { type: "response.output_text.delta", delta: "untrusted partial" };
    yield { type, response };
  })();
}
const result = {
  status: "completed",
  model: "gpt-6-astra",
  output: [
    {
      type: "message",
      content: [{ type: "output_text", text: "Actual final response" }],
    },
  ],
  usage: {
    input_tokens: 20,
    input_tokens_details: { cached_tokens: 7 },
    output_tokens: 10,
    total_tokens: 30,
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "fixture-only-private-key";
  create.mockResolvedValue(events(result));
});
afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
});
it("uses only the OpenAI key, official endpoint, configured model and SSE", async () => {
  process.env.OPENAI_MODEL = "gpt-6-astra";
  const value = await generateOpenAI({
    input: "Hello",
    instructions: "Be concise",
    maxTokens: 100,
  });
  expect(constructor).toHaveBeenCalledWith(
    expect.objectContaining({
      apiKey: "fixture-only-private-key",
      baseURL: "https://api.openai.com/v1",
      maxRetries: 0,
    }),
  );
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ model: "gpt-6-astra", stream: true }),
    expect.any(Object),
  );
  expect(value.text).toBe("Actual final response");
  expect(value.usage).toMatchObject({
    input_tokens: 20,
    output_tokens: 10,
    total_tokens: 30,
  });
  expect(value.text).not.toContain("partial");
});
it("uses final function calls without relying on disabled parallel calls", async () => {
  create.mockResolvedValue(
    events({
      ...result,
      output: [
        { type: "function_call", name: "query_issues", arguments: "{}" },
        { type: "function_call", name: "check_jobs", arguments: "{}" },
      ],
    }),
  );
  const value = await generateOpenAI({
    input: "status",
    instructions: "Use tools",
    maxTokens: 100,
    tools: [
      {
        type: "function",
        name: "query_issues",
        parameters: { type: "object" },
        strict: true,
      },
    ],
  });
  expect(value.calls).toHaveLength(2);
  expect(create.mock.calls[0][0].parallel_tool_calls).toBe(false);
  expect(create.mock.calls[0][0].tools[0].strict).toBe(true);
});
it.each([
  [401, "AI_AUTHENTICATION", false],
  [402, "AI_QUOTA", false],
  [429, "AI_RATE_LIMIT", true],
  [503, "AI_UNAVAILABLE", true],
])("redacts provider errors for HTTP %s", (status, code, retryable) => {
  const e = providerError({
    status,
    message: "Authorization: Bearer fixture-only-private-key",
  });
  expect(e.code).toBe(code);
  expect(e.retryable).toBe(retryable);
  expect(e.message).not.toContain("fixture-only-private-key");
});
it("reports timeouts clearly", () => {
  expect(providerError({ name: "TimeoutError" })).toMatchObject({
    code: "AI_TIMEOUT",
    status: 504,
    retryable: true,
  });
});
it("rejects interrupted streams and never substitutes partial output", async () => {
  create.mockResolvedValue(
    (async function* () {
      yield { type: "response.output_text.delta", delta: "partial success" };
    })(),
  );
  await expect(
    generateOpenAI({ input: "x", instructions: "x", maxTokens: 1 }),
  ).rejects.toMatchObject({ code: "AI_STREAM_INTERRUPTED" });
});
it("preserves incomplete usage receipts but marks output unusable", async () => {
  create.mockResolvedValue(
    events({ ...result, status: "incomplete" }, "response.incomplete"),
  );
  const r = await generateOpenAI({
    input: "x",
    instructions: "x",
    maxTokens: 1,
  });
  expect(r.failure?.code).toBe("AI_INCOMPLETE");
  expect(r.usage?.total_tokens).toBe(30);
});
it("rejects missing usage rather than fabricating zero-token success", async () => {
  create.mockResolvedValue(events({ ...result, usage: null }));
  expect(
    (await generateOpenAI({ input: "x", instructions: "x", maxTokens: 1 }))
      .failure?.code,
  ).toBe("AI_USAGE_MISSING");
});
it("requires a server OpenAI key", async () => {
  delete process.env.OPENAI_API_KEY;
  await expect(
    generateOpenAI({ input: "x", instructions: "x", maxTokens: 1 }),
  ).rejects.toMatchObject({ code: "AI_SETUP" });
});
it("never substitutes an unavailable model", async () => {
  create.mockRejectedValue({ status: 404, code: "model_not_found" });
  await expect(
    generateOpenAI({ input: "x", instructions: "x", maxTokens: 1 }),
  ).rejects.toMatchObject({ code: "AI_MODEL_UNAVAILABLE" });
  expect(create).toHaveBeenCalledTimes(1);
});
it("distinguishes quota from rate limits", () => {
  expect(
    providerError({ status: 429, code: "insufficient_quota" }),
  ).toMatchObject({ code: "AI_QUOTA", retryable: false });
});
it("defaults to Astra with supported low reasoning and no remote storage", async () => {
  await generateOpenAI({ input: "x", instructions: "x", maxTokens: 100 });
  expect(create.mock.calls[0][0]).toMatchObject({
    model: "gpt-6-astra",
    reasoning: { effort: "low" },
    store: false,
  });
});
it("preserves reasoning tokens in actual usage", async () => {
  create.mockResolvedValue(
    events({
      ...result,
      usage: {
        ...result.usage,
        output_tokens_details: { reasoning_tokens: 8 },
      },
    }),
  );
  expect(
    (await generateOpenAI({ input: "x", instructions: "x", maxTokens: 100 }))
      .usage?.output_tokens_details?.reasoning_tokens,
  ).toBe(8);
});
it("rejects unsupported reasoning without contacting the provider", async () => {
  process.env.OPENAI_REASONING_EFFORT = "none";
  try {
    await expect(
      generateOpenAI({ input: "x", instructions: "x", maxTokens: 100 }),
    ).rejects.toMatchObject({ code: "AI_CONFIGURATION" });
    expect(create).not.toHaveBeenCalled();
  } finally {
    delete process.env.OPENAI_REASONING_EFFORT;
  }
});
it("passes structured output schemas to Responses", async () => {
  const format = {
    type: "json_schema" as const,
    name: "fixture",
    strict: true,
    schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  };
  await generateOpenAI({
    input: "x",
    instructions: "x",
    maxTokens: 100,
    format,
  });
  expect(create.mock.calls[0][0].text.format).toEqual(format);
});
