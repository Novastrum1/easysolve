import { beforeEach, afterEach, expect, it, vi } from "vitest";
const { create, constructor } = vi.hoisted(() => ({
  create: vi.fn(),
  constructor: vi.fn(),
}));
vi.mock("openai", () => ({
  default: class {
    constructor(options: unknown) {
      constructor(options);
    }
    chat = { completions: { create } };
  },
}));
vi.mock("../lib/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { generateDeepSeek, deepseekConfig } from "../lib/providers/deepseek";
import { providerError, type DeepSeekMessage } from "../lib/providers/shared";
const usage = {
  prompt_tokens: 12,
  completion_tokens: 8,
  total_tokens: 20,
  prompt_cache_hit_tokens: 4,
};
function stream(chunks: any[]) {
  return (async function* () {
    for (const c of chunks) yield c;
  })();
}
function chunk(delta: any, finish_reason: string | null = null, receipt?: any) {
  return {
    model: "deepseek-flash",
    choices: [{ index: 0, delta, finish_reason }],
    ...(receipt ? { usage: receipt } : {}),
  };
}
const input = { instructions: "Help", input: "Hello", maxTokens: 128 };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AI_PROVIDER", "deepseek");
  vi.stubEnv("DEEPSEEK_API_KEY", "fixture-private");
  vi.stubEnv("DEEPSEEK_THINKING", "disabled");
  vi.stubEnv("DEEPSEEK_BASE_URL", "https://api.deepseek.com");
  create.mockResolvedValue(
    stream([chunk({ content: "Hello" }, "stop", usage)]),
  );
});
afterEach(() => vi.unstubAllEnvs());
it("uses only the official DeepSeek endpoint, streaming and actual usage", async () => {
  const value = await generateDeepSeek(input);
  expect(constructor).toHaveBeenCalledWith(
    expect.objectContaining({
      baseURL: "https://api.deepseek.com",
      apiKey: "fixture-private",
      maxRetries: 0,
    }),
  );
  expect(create.mock.calls[0][0]).toMatchObject({
    model: "deepseek-flash",
    stream: true,
    thinking: { type: "disabled" },
  });
  expect(value).toMatchObject({
    provider: "deepseek",
    text: "Hello",
    failure: null,
    usage: {
      input_tokens: 12,
      output_tokens: 8,
      total_tokens: 20,
      input_tokens_details: { cached_tokens: 4 },
    },
  });
});
it("assembles split tool arguments and preserves private reasoning in tool continuation", async () => {
  vi.stubEnv("DEEPSEEK_THINKING", "enabled");
  create.mockResolvedValueOnce(
    stream([
      chunk({ reasoning_content: "private reasoning" }),
      chunk({
        tool_calls: [
          {
            index: 0,
            id: "call_1",
            function: { name: "lookup", arguments: '{"id":' },
          },
        ],
      }),
      chunk(
        { tool_calls: [{ index: 0, function: { arguments: "7}" } }] },
        "tool_calls",
        usage,
      ),
    ]),
  );
  const history: DeepSeekMessage[] = [];
  const onText = vi.fn();
  const tools: any = [
    {
      type: "function",
      name: "lookup",
      parameters: {
        type: "object",
        properties: { id: { type: "integer" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  ];
  const first = await generateDeepSeek({ ...input, history, tools, onText });
  expect(first.failure).toBeNull();
  expect(first.calls).toEqual([
    { id: "call_1", name: "lookup", arguments: '{"id":7}' },
  ]);
  expect(onText).not.toHaveBeenCalled();
  history.push({ role: "tool", tool_call_id: "call_1", content: "found" });
  await generateDeepSeek({ ...input, history, tools });
  expect(create.mock.calls[1][0].messages[2]).toMatchObject({
    role: "assistant",
    reasoning_content: "private reasoning",
    tool_calls: expect.any(Array),
  });
  expect(history[4]).toMatchObject({
    role: "assistant",
    content: "Hello",
    reasoning_content: "",
  });
});
it.each(["length", "content_filter", null])(
  "rejects incomplete output (%s) while retaining receipt",
  async (finish) => {
    create.mockResolvedValueOnce(
      stream([chunk({ content: "partial" }, finish, usage)]),
    );
    const value = await generateDeepSeek(input);
    expect(value.failure?.code).toBe("AI_INCOMPLETE");
    expect(value.failure?.retryable).toBe(true);
    expect(value.usage?.total_tokens).toBe(20);
  },
);
it("rejects missing usage, unknown tools, invalid schemas and credentials redirected to another host", async () => {
  create.mockResolvedValueOnce(stream([chunk({ content: "Hello" }, "stop")]));
  expect((await generateDeepSeek(input)).failure?.code).toBe(
    "AI_USAGE_MISSING",
  );
  create.mockResolvedValueOnce(
    stream([
      chunk(
        {
          tool_calls: [
            {
              index: 0,
              id: "bad",
              function: { name: "unknown", arguments: "{}" },
            },
          ],
        },
        "tool_calls",
        usage,
      ),
    ]),
  );
  expect((await generateDeepSeek(input)).failure?.code).toBe(
    "AI_INVALID_OUTPUT",
  );
  create.mockResolvedValueOnce(
    stream([chunk({ content: '{"id":"wrong"}' }, "stop", usage)]),
  );
  expect(
    (
      await generateDeepSeek({
        ...input,
        format: {
          type: "json_schema",
          name: "test",
          schema: {
            type: "object",
            properties: { id: { type: "integer" } },
            required: ["id"],
          },
        },
      })
    ).failure?.code,
  ).toBe("AI_INVALID_OUTPUT");
  vi.stubEnv("DEEPSEEK_BASE_URL", "https://api.openai.com/v1");
  expect(() => deepseekConfig()).toThrow("official");
});
it.each([
  [401, "AI_AUTHENTICATION"],
  [402, "AI_QUOTA"],
  [429, "AI_RATE_LIMIT"],
  [500, "AI_UNAVAILABLE"],
])(
  "sanitizes upstream %s errors without leaking response bodies",
  (status, code) => {
    const error = providerError({
      status,
      message: "fixture-private credential upstream body",
    });
    expect(error.code).toBe(code);
    expect(error.message).not.toContain("fixture-private");
  },
);
it("fails closed for other providers and passes caller cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  create.mockRejectedValueOnce({ name: "AbortError" });
  await expect(
    generateDeepSeek({ ...input, signal: controller.signal }),
  ).rejects.toMatchObject({ code: "AI_TIMEOUT" });
  expect(create.mock.calls[0][1].signal.aborted).toBe(true);
  vi.stubEnv("AI_PROVIDER", "openai");
  expect(() => deepseekConfig()).toThrow("must be deepseek");
});
