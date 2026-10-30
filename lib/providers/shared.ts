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
      "DeepSeek rejected the server API key. Ask the operator to update DEEPSEEK_API_KEY and restart the app and worker.",
      503,
    );
  if (e?.status === 402 || code === "insufficient_quota")
    return new AIProviderError(
      "AI_QUOTA",
      "DeepSeek quota or billing credit is insufficient. The operator must check project billing and limits.",
      402,
    );
  if (e?.status === 404 || code === "model_not_found")
    return new AIProviderError(
      "AI_MODEL_UNAVAILABLE",
      "The configured DeepSeek model is unavailable to this project. Check DEEPSEEK_MODEL and model access. No substitute model was used.",
      503,
    );
  if (e?.status === 429)
    return new AIProviderError(
      "AI_RATE_LIMIT",
      "DeepSeek rate limit reached. Wait briefly and retry.",
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
      "DeepSeek timed out before completing the request. No successful result was recorded.",
      504,
      true,
    );
  if (e?.status === 400 || e?.status === 422)
    return new AIProviderError(
      "AI_PARAMETERS",
      "DeepSeek rejected the model or request parameters. Check DEEPSEEK_MODEL and reasoning/output settings. No substitute model was used.",
    );
  if (e?.status === 403)
    return new AIProviderError(
      "AI_FORBIDDEN",
      "DeepSeek denied access. Check project permissions and model access. No substitute model was used.",
      403,
    );
  return new AIProviderError(
    "AI_UNAVAILABLE",
    "DeepSeek is unavailable or the connection was interrupted. No successful result was recorded.",
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
  provider: "deepseek";
  model: string;
  text: string;
  calls: { id: string; name: string; arguments: string }[];
  assistant?: DeepSeekMessage;
  usage: z.infer<typeof usageSchema> | null;
  failure: AIProviderError | null;
};
export type OutputFormat = OpenAI.Responses.ResponseFormatTextConfig;

export type DeepSeekMessage =
  OpenAI.Chat.Completions.ChatCompletionMessageParam & {
    reasoning_content?: string;
  };
