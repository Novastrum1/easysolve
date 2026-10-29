import { logBedrockException } from "./bedrock-diagnostics";
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  ConverseCommand,
  type ConverseStreamCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import Ajv from "ajv";
import {
  AIProviderError,
  limit,
  usageSchema,
  type Generation,
  type generateOpenAI,
} from "./openai";

export function bedrockConfig() {
  const region = process.env.AWS_REGION?.trim() || "";
  const model = process.env.BEDROCK_MODEL_ID?.trim() || "";
  const key = process.env.AWS_BEARER_TOKEN_BEDROCK?.trim() || "";
  const missing = [
    !key && "AWS_BEARER_TOKEN_BEDROCK",
    !region && "AWS_REGION",
    !model && "BEDROCK_MODEL_ID",
  ].filter(Boolean);
  const validRegion = /^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region);
  const validModel = !!model && /^[a-zA-Z0-9:._/\-]+$/.test(model);
  return {
    region,
    model,
    key,
    missing,
    configured: !missing.length && validRegion && validModel,
    baseURL: validRegion
      ? `https://bedrock-runtime.${region}.${region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com"}`
      : "",
    timeout: limit("BEDROCK_TIMEOUT_MS", 90000, 90000),
  };
}
export function bedrockError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) return error;
  const e = error as {
    name?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const status = e?.$metadata?.httpStatusCode;
  if (
    status === 401 ||
    [
      "UnrecognizedClientException",
      "ExpiredTokenException",
      "InvalidSignatureException",
    ].includes(e?.name || "")
  )
    return new AIProviderError(
      "AI_AUTHENTICATION",
      "Amazon Bedrock rejected the bearer key. Check its expiration and the AWS Region in which it was generated; update the server key and restart web and worker.",
      503,
    );
  if (
    (status === 403 || e?.name === "AccessDeniedException") &&
    /not available for this account/i.test(e?.message ?? "")
  )
    return new AIProviderError(
      "AI_MODEL_ACCOUNT_ACCESS",
      "AWS reports that the configured Amazon Bedrock model is not available for this account. Ask the account administrator to request model access from AWS Sales. Retrying or changing streaming settings will not resolve this restriction.",
      403,
    );
  if (status === 403 || e?.name === "AccessDeniedException")
    return new AIProviderError(
      "AI_FORBIDDEN",
      "Amazon Bedrock denied access. Check key expiration, key Region, model access, and bedrock:InvokeModelWithResponseStream permission, including inference-profile destination Regions. Review Model catalog in the AWS console; no subscription or agreement was accepted.",
      403,
    );
  if (status === 404 || e?.name === "ResourceNotFoundException")
    return new AIProviderError(
      "AI_MODEL_UNAVAILABLE",
      "Amazon Bedrock could not find this model or inference profile in AWS_REGION. Copy its exact ID from the regional console Programmatic access section.",
      503,
    );
  if (
    status === 429 ||
    ["ThrottlingException", "ServiceQuotaExceededException"].includes(
      e?.name || "",
    )
  )
    return new AIProviderError(
      "AI_RATE_LIMIT",
      "Amazon Bedrock throttled the request or exhausted a service quota. Retry later and check regional quotas.",
      429,
      true,
    );
  if (
    ["AbortError", "TimeoutError", "ModelTimeoutException"].includes(
      e?.name || "",
    )
  )
    return new AIProviderError(
      "AI_TIMEOUT",
      "Amazon Bedrock timed out. No partial action was applied.",
      504,
      true,
    );
  if (status === 400 || e?.name === "ValidationException")
    return new AIProviderError(
      "AI_PARAMETERS",
      "Amazon Bedrock rejected the model or request. Check the exact regional model/inference-profile ID and support for Converse streaming, tools, and the requested output schema. No fallback was used.",
    );
  return new AIProviderError(
    "AI_UNAVAILABLE",
    "Amazon Bedrock is unavailable or its stream was interrupted. No successful result was recorded.",
    503,
    true,
  );
}
const validator = new Ajv({
  strict: false,
  allErrors: false,
  validateFormats: false,
});
function validate(schema: object, value: unknown) {
  if (!validator.validate(schema, value))
    throw new AIProviderError(
      "AI_INVALID_OUTPUT",
      "Amazon Bedrock returned output or tool arguments that do not match the required schema. No action was applied.",
    );
}
export async function generateBedrock(
  input: Parameters<typeof generateOpenAI>[0],
): Promise<Generation> {
  const config = bedrockConfig();
  if (!config.configured)
    throw new AIProviderError(
      "AI_CONFIGURATION",
      "Amazon Bedrock requires AWS_BEARER_TOKEN_BEDROCK, AWS_REGION, and an exact BEDROCK_MODEL_ID (not a console URL). Set these privately and restart web and worker.",
      503,
    );
  let text = "",
    stop = "",
    usage: Generation["usage"] = null;
  const calls = new Map<number, { name: string; arguments: string }>();
  const ended = new Set<number>();
  let failure: AIProviderError | null = null;
  const sdk = new BedrockRuntimeClient({
    region: config.region,
    endpoint: config.baseURL,
    token: { token: config.key },
    authSchemePreference: ["httpBearerAuth"],
    maxAttempts: 1,
  });
  let operation: "Converse" | "ConverseStream" = "ConverseStream";
  try {
    const tools = input.tools?.map((t) => {
      if (t.type !== "function")
        throw new AIProviderError(
          "AI_TOOL_UNSUPPORTED",
          "Amazon Bedrock supports function tools only in EasySolve.",
        );
      return {
        toolSpec: {
          name: t.name,
          description: t.description || t.name,
          inputSchema: { json: t.parameters as never },
        },
      };
    });
    const format = input.format;
    const command: ConverseStreamCommandInput = {
      modelId: config.model,
      system: [{ text: input.instructions }],
      messages: [{ role: "user", content: [{ text: input.input }] }],
      inferenceConfig: { maxTokens: input.maxTokens },
      ...(tools?.length ? { toolConfig: { tools } } : {}),
      ...(format?.type === "json_schema" &&
      /(?:^|\.)openai\./.test(config.model)
        ? {
            additionalModelRequestFields: {
              text: { format: { strict: true } },
            },
          }
        : {}),
      ...(format?.type === "json_schema"
        ? {
            outputConfig: {
              textFormat: {
                type: "json_schema",
                structure: {
                  jsonSchema: {
                    name: format.name,
                    schema: JSON.stringify(format.schema),
                  },
                },
              },
            },
          }
        : {}),
      ...(format?.type === "json_object"
        ? {
            system: [
              {
                text:
                  input.instructions + "\nReturn one valid JSON object only.",
              },
            ],
          }
        : {}),
    };
    // Use Converse for schema-constrained text: some models support this only without streaming.
    if (format?.type === "json_schema" && !tools?.length) {
      operation = "Converse";
      const response = await sdk.send(new ConverseCommand(command), {
        abortSignal: AbortSignal.timeout(config.timeout),
      });
      text =
        response.output?.message?.content
          ?.map((block) => block.text ?? "")
          .join("") ?? "";
      const u = response.usage;
      if (u) {
        const cached = u.cacheReadInputTokens ?? 0;
        const tokens =
          (u.inputTokens ?? 0) + cached + (u.cacheWriteInputTokens ?? 0);
        const parsed = usageSchema.safeParse({
          input_tokens: tokens,
          input_tokens_details: { cached_tokens: cached },
          output_tokens: u.outputTokens,
          total_tokens: tokens + (u.outputTokens ?? 0),
        });
        if (parsed.success) usage = parsed.data;
      }
      if (response.stopReason !== "end_turn")
        throw new AIProviderError(
          "AI_INCOMPLETE",
          "Amazon Bedrock output was incomplete or filtered. No action was applied.",
        );
      if (!usage)
        throw new AIProviderError(
          "AI_USAGE_MISSING",
          "Amazon Bedrock omitted a valid usage receipt.",
        );
      validate(format.schema, JSON.parse(text));
      return {
        provider: "bedrock",
        model: config.model,
        text,
        calls: [],
        usage,
        failure: null,
      };
    }
    const result = await sdk.send(new ConverseStreamCommand(command), {
      abortSignal: AbortSignal.timeout(config.timeout),
    });
    if (!result.stream)
      throw new AIProviderError(
        "AI_STREAM_INTERRUPTED",
        "Amazon Bedrock returned no stream.",
      );
    for await (const event of result.stream) {
      if (event.contentBlockStart?.start?.toolUse) {
        const t = event.contentBlockStart.start.toolUse;
        calls.set(event.contentBlockStart.contentBlockIndex!, {
          name: t.name!,
          arguments: "",
        });
      }
      if (event.contentBlockDelta) {
        const { delta, contentBlockIndex } = event.contentBlockDelta;
        text += delta?.text ?? "";
        if (delta?.toolUse) {
          const call = calls.get(contentBlockIndex!);
          if (!call)
            throw new AIProviderError(
              "AI_INVALID_OUTPUT",
              "Amazon Bedrock sent an invalid tool stream.",
            );
          call.arguments += delta.toolUse.input ?? "";
        }
      }
      if (event.contentBlockStop)
        ended.add(event.contentBlockStop.contentBlockIndex!);
      if (event.messageStop) stop = event.messageStop.stopReason ?? "";
      if (event.metadata?.usage) {
        const u = event.metadata.usage;
        const cached = u.cacheReadInputTokens ?? 0,
          written = u.cacheWriteInputTokens ?? 0;
        // Bedrock reports uncached, cache-read and cache-write input separately.
        const inputTokens = (u.inputTokens ?? 0) + cached + written;
        const receipt = usageSchema.safeParse({
          input_tokens: inputTokens,
          input_tokens_details: { cached_tokens: cached },
          output_tokens: u.outputTokens,
          total_tokens: inputTokens + (u.outputTokens ?? 0),
        });
        if (receipt.success) usage = receipt.data;
      }
      if (
        event.internalServerException ||
        event.modelStreamErrorException ||
        event.serviceUnavailableException ||
        event.throttlingException ||
        event.validationException
      )
        throw new AIProviderError(
          "AI_STREAM_ERROR",
          "Amazon Bedrock reported a stream failure. No partial action was applied.",
          502,
          true,
        );
    }
    if (
      !["end_turn", "tool_use"].includes(stop) ||
      [...calls.keys()].some((i) => !ended.has(i))
    )
      throw new AIProviderError(
        "AI_INCOMPLETE",
        "Amazon Bedrock output was interrupted, truncated, or filtered. No partial action was applied.",
      );
    if (!usage)
      throw new AIProviderError(
        "AI_USAGE_MISSING",
        "Amazon Bedrock omitted a valid usage receipt. No successful action was accepted.",
      );
    for (const call of calls.values()) {
      const tool = input.tools?.find(
        (t) => t.type === "function" && t.name === call.name,
      );
      if (!tool || tool.type !== "function")
        throw new AIProviderError(
          "AI_INVALID_OUTPUT",
          "Amazon Bedrock requested an unknown tool. No action was applied.",
        );
      validate(
        tool.parameters ?? { type: "object" },
        JSON.parse(call.arguments),
      );
    }
    if (!calls.size && format?.type === "json_schema")
      validate(format.schema, JSON.parse(text));
    if (!calls.size && format?.type === "json_object")
      validate({ type: "object" }, JSON.parse(text));
    if (!text.trim() && !calls.size)
      throw new AIProviderError(
        "AI_INVALID_OUTPUT",
        "Amazon Bedrock returned no usable output.",
      );
  } catch (error) {
    if (!(error instanceof AIProviderError) && !(error instanceof SyntaxError))
      logBedrockException(error, {
        operation,
        endpoint: `${config.baseURL}/model/${encodeURIComponent(config.model)}/${operation === "Converse" ? "converse" : "converse-stream"}`,
        region: config.region,
        model: config.model,
      });
    failure =
      error instanceof SyntaxError
        ? new AIProviderError(
            "AI_INVALID_OUTPUT",
            "Amazon Bedrock returned invalid JSON. No action was applied.",
          )
        : bedrockError(error);
  } finally {
    sdk.destroy();
  }
  return {
    provider: "bedrock",
    model: config.model,
    text,
    calls: [...calls.values()],
    usage,
    failure,
  };
}
