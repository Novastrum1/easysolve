import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { send, construct } = vi.hoisted(() => ({
  send: vi.fn(),
  construct: vi.fn(),
}));
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    constructor(config: unknown) {
      construct(config);
    }
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
vi.mock("../lib/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import {
  bedrockConfig,
  bedrockError,
  generateBedrock,
} from "../lib/providers/bedrock";
import { generateAI } from "../lib/providers";
const input = {
  instructions: "system",
  input: "workspace history and tool results",
  maxTokens: 32,
};
function stream(events: unknown[]) {
  return (async function* () {
    for (const event of events) yield event;
  })();
}
const receipt = {
  metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AI_PROVIDER", "bedrock");
  vi.stubEnv("AWS_BEARER_TOKEN_BEDROCK", "private-bedrock-fixture");
  vi.stubEnv("AWS_REGION", "eu-north-1");
  vi.stubEnv("BEDROCK_MODEL_ID", "fixture.model-v1:0");
  send.mockResolvedValue({
    stream: stream([
      { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "OK" } } },
      { messageStop: { stopReason: "end_turn" } },
      receipt,
    ]),
  });
});
afterEach(() => vi.unstubAllEnvs());
it("dispatches exclusively to Bedrock with explicit bearer auth and actual usage", async () => {
  const result = await generateAI(input);
  expect(result).toMatchObject({
    provider: "bedrock",
    text: "OK",
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    failure: null,
  });
  expect(construct).toHaveBeenCalledWith(
    expect.objectContaining({
      token: { token: "private-bedrock-fixture" },
      region: "eu-north-1",
      maxAttempts: 1,
    }),
  );
  expect(send.mock.calls[0][0].input).toMatchObject({
    system: [{ text: "system" }],
    messages: [{ role: "user", content: [{ text: input.input }] }],
    inferenceConfig: { maxTokens: 32 },
  });
});
it.each(["AWS_REGION", "BEDROCK_MODEL_ID", "AWS_BEARER_TOKEN_BEDROCK"])(
  "requires %s without defaults",
  async (key) => {
    vi.stubEnv(key, "");
    expect(bedrockConfig().configured).toBe(false);
    await expect(generateBedrock(input)).rejects.toMatchObject({
      code: "AI_CONFIGURATION",
    });
    expect(send).not.toHaveBeenCalled();
  },
);
it("rejects console links", () => {
  vi.stubEnv("BEDROCK_MODEL_ID", "[model](https://console.aws.amazon.com)");
  expect(bedrockConfig().configured).toBe(false);
});
it("assembles fragmented tools and validates arguments", async () => {
  send.mockResolvedValue({
    stream: stream([
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { toolUse: { name: "query", toolUseId: "a" } },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: "{" } },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: "}" } },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: "tool_use" } },
      receipt,
    ]),
  });
  const tools = [
    {
      type: "function" as const,
      name: "query",
      strict: true,
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ];
  expect((await generateBedrock({ ...input, tools })).calls).toEqual([
    { name: "query", arguments: "{}" },
  ]);
});
it("retains real usage while rejecting truncated output", async () => {
  send.mockResolvedValue({
    stream: stream([{ messageStop: { stopReason: "max_tokens" } }, receipt]),
  });
  const result = await generateBedrock(input);
  expect(result.failure?.code).toBe("AI_INCOMPLETE");
  expect(result.usage?.total_tokens).toBe(15);
});
it("rejects missing usage and invalid structured responses", async () => {
  send.mockResolvedValueOnce({
    stream: stream([{ messageStop: { stopReason: "end_turn" } }]),
  });
  expect((await generateBedrock(input)).failure?.code).toBe("AI_USAGE_MISSING");
  send.mockResolvedValueOnce({
    output: { message: { content: [{ text: "invalid JSON" }] } },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    stopReason: "end_turn",
  });
  const result = await generateBedrock({
    ...input,
    format: {
      type: "json_schema",
      name: "output",
      schema: {
        type: "object",
        required: ["answer"],
        properties: { answer: { type: "string" } },
        additionalProperties: false,
      },
      strict: true,
    },
  });
  expect(result.failure?.code).toBe("AI_INVALID_OUTPUT");
});
it.each([
  ["AccessDeniedException", "AI_FORBIDDEN"],
  ["ExpiredTokenException", "AI_AUTHENTICATION"],
  ["ThrottlingException", "AI_RATE_LIMIT"],
  ["TimeoutError", "AI_TIMEOUT"],
  ["ValidationException", "AI_PARAMETERS"],
])("sanitizes %s", (name, code) => {
  const error = bedrockError({ name, message: "private-bedrock-fixture" });
  expect(error.code).toBe(code);
  expect(error.message).not.toContain("private-bedrock-fixture");
});
it("distinguishes account model availability from missing IAM permissions", () => {
  const error = bedrockError({
    name: "AccessDeniedException",
    message:
      "openai.gpt-6.1-terra is not available for this account. Contact AWS Sales.",
    $metadata: { httpStatusCode: 403 },
  });
  expect(error).toMatchObject({
    code: "AI_MODEL_ACCOUNT_ACCESS",
    status: 403,
    retryable: false,
  });
  expect(error.message).toContain("AWS Sales");
});
