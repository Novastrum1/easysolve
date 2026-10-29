import OpenAI from "openai";
import { z } from "zod";
import { HttpError } from "../security";
export class AIProviderError extends HttpError {
  constructor(
    public code: string,
    message: string,
    status = 502,
    public retryable = false,
  ) {
    super(status, message);
    this.name = "AIProviderError";
  }
}
export function limit(
  name: string,
  fallback: number,
  ceiling = Number.MAX_SAFE_INTEGER,
) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling)
    throw new AIProviderError(
      "AI_CONFIGURATION",
      `Invalid server setting ${name}.`,
      503,
    );
  return value;
}
export function openaiConfig() {
  const effort = process.env.OPENAI_REASONING_EFFORT || "low";
  if (!["low", "medium", "high", "xhigh", "max"].includes(effort))
    throw new AIProviderError(
      "AI_CONFIGURATION",
      "OPENAI_REASONING_EFFORT must be low, medium, high, xhigh, or max. GPT-6 Astra does not support none.",
      503,
    );
  return {
    model: process.env.OPENAI_MODEL?.trim() || "gpt-6-astra",
    timeout: limit("OPENAI_TIMEOUT_MS", 90000, 90000),
    effort: effort as "low" | "medium" | "high" | "xhigh" | "max",
  };
}
export function providerError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) return error;
  const e = error as {
    status?: number;
    name?: string;
    code?: string;
    error?: { code?: string };
  };
  const code = e?.code ?? e?.error?.code;
  if (e?.status === 401)
    return new AIProviderError(
      "AI_AUTHENTICATION",
      "OpenAI rejected the server API key. Ask the operator to update OPENAI_API_KEY and restart the app and worker.",
      503,
    );
  if (e?.status === 402 || code === "insufficient_quota")
    return new AIProviderError(
      "AI_QUOTA",
      "OpenAI quota or billing credit is insufficient. The operator must check project billing and limits.",
      402,
    );
  if (e?.status === 404 || code === "model_not_found")
    return new AIProviderError(
      "AI_MODEL_UNAVAILABLE",
      "The configured OpenAI model is unavailable to this project. Check OPENAI_MODEL and model access. No substitute model was used.",
      503,
    );
  if (e?.status === 429)
    return new AIProviderError(
      "AI_RATE_LIMIT",
      "OpenAI rate limit reached. Wait briefly and retry.",
      429,
      true,
    );
  if (
    e?.status === 408 ||
    ["APIConnectionTimeoutError", "AbortError", "TimeoutError"].includes(
      e?.name ?? "",
    )
  )
    return new AIProviderError(
      "AI_TIMEOUT",
      "OpenAI timed out before completing the request. No successful result was recorded.",
      504,
      true,
    );
  if (e?.status === 400 || e?.status === 422)
    return new AIProviderError(
      "AI_PARAMETERS",
      "OpenAI rejected the model or request parameters. Check OPENAI_MODEL and reasoning/output settings. No substitute model was used.",
    );
  if (e?.status === 403)
    return new AIProviderError(
      "AI_FORBIDDEN",
      "OpenAI denied access. Check project permissions and model access. No substitute model was used.",
      403,
    );
  return new AIProviderError(
    "AI_UNAVAILABLE",
    "OpenAI is unavailable or the connection was interrupted. No successful result was recorded.",
    503,
    true,
  );
}
export const usageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    input_tokens_details: z
      .object({ cached_tokens: z.number().int().nonnegative().optional() })
      .optional(),
    output_tokens: z.number().int().nonnegative(),
    output_tokens_details: z
      .object({ reasoning_tokens: z.number().int().nonnegative().optional() })
      .optional(),
    total_tokens: z.number().int().nonnegative(),
  })
  .refine(
    (u) =>
      (u.input_tokens_details?.cached_tokens ?? 0) <= u.input_tokens &&
      (u.output_tokens_details?.reasoning_tokens ?? 0) <= u.output_tokens &&
      u.total_tokens === u.input_tokens + u.output_tokens,
  );
export type Generation = {
  provider: "openai" | "agentrouter" | "bedrock";
  model: string;
  text: string;
  calls: { name: string; arguments: string }[];
  usage: z.infer<typeof usageSchema> | null;
  failure: AIProviderError | null;
};
export type OutputFormat = OpenAI.Responses.ResponseFormatTextConfig;
export async function generateOpenAI(input: {
  instructions: string;
  input: string;
  maxTokens: number;
  tools?: OpenAI.Responses.Tool[];
  format?: OutputFormat;
}): Promise<Generation> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key)
    throw new AIProviderError(
      "AI_SETUP",
      "OpenAI is not configured. Ask the operator to set OPENAI_API_KEY on the server and restart the app and worker.",
      503,
    );
  if (
    key === process.env.AGENTROUTER_API_KEY?.trim() ||
    key === process.env.AWS_BEARER_TOKEN_BEDROCK?.trim()
  )
    throw new AIProviderError(
      "AI_CREDENTIAL_SCOPE",
      "The configured direct OpenAI key matches the AgentRouter token. Configure a separate OpenAI credential; gateway tokens are never sent to api.openai.com.",
      503,
    );
  const config = openaiConfig();
  try {
    // Explicit official URL prevents inherited OPENAI_BASE_URL from redirecting credentials.
    const client = new OpenAI({
      apiKey: key,
      baseURL: "https://api.openai.com/v1",
      timeout: config.timeout,
      maxRetries: 0,
    });
    const stream = await client.responses.create(
      {
        model: config.model,
        instructions: input.instructions,
        input: input.input,
        max_output_tokens: input.maxTokens,
        reasoning: { effort: config.effort },
        stream: true,
        store: false,
        ...(input.tools
          ? { tools: input.tools, parallel_tool_calls: false }
          : {}),
        ...(input.format ? { text: { format: input.format } } : {}),
      },
      { signal: AbortSignal.timeout(config.timeout) },
    );
    let final: OpenAI.Responses.Response | undefined;
    for await (const event of stream) {
      if (event.type === "error")
        throw new AIProviderError(
          "AI_STREAM_ERROR",
          "OpenAI reported a streaming error. No partial action was applied.",
          502,
          true,
        );
      if (
        [
          "response.completed",
          "response.incomplete",
          "response.failed",
        ].includes(event.type) &&
        "response" in event
      )
        final = event.response as OpenAI.Responses.Response;
    }
    if (!final)
      throw new AIProviderError(
        "AI_STREAM_INTERRUPTED",
        "OpenAI ended the stream without a completion receipt. No partial action was applied.",
        502,
        true,
      );
    const usage = usageSchema.safeParse(final.usage);
    const refused = final.output.some(
      (item) =>
        item.type === "message" &&
        item.content.some((c) => c.type === "refusal"),
    );
    const failure =
      final.status !== "completed"
        ? new AIProviderError(
            final.status === "incomplete"
              ? "AI_INCOMPLETE"
              : "AI_GENERATION_FAILED",
            final.status === "incomplete"
              ? "OpenAI reached an output limit or content boundary. Increase AI_MAX_OUTPUT_TOKENS or narrow the task; partial output was not applied."
              : "OpenAI reported generation failure. No model action was applied.",
          )
        : refused
          ? new AIProviderError(
              "AI_REFUSAL",
              "OpenAI declined this request. No model action was applied.",
            )
          : null;
    return {
      provider: "openai",
      model: final.model || config.model,
      text: final.output
        .filter((item) => item.type === "message")
        .flatMap((item) =>
          item.content
            .filter((c) => c.type === "output_text")
            .map((c) => c.text),
        )
        .join(""),
      calls: final.output
        .filter((item) => item.type === "function_call")
        .map((c) => ({ name: c.name, arguments: c.arguments })),
      usage: usage.success ? usage.data : null,
      failure:
        failure ??
        (!usage.success
          ? new AIProviderError(
              "AI_USAGE_MISSING",
              "OpenAI omitted a valid usage receipt. The response was not accepted as successful.",
            )
          : null),
    };
  } catch (error) {
    throw providerError(error);
  }
}
