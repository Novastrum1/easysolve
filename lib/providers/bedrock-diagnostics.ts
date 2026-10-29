// Server-side only. Never serialize raw SDK errors, headers, request bodies, or credentials.
export type BedrockOperation = "Converse" | "ConverseStream";
export function sanitizeBedrockText(value: unknown): string {
  let text = typeof value === "string" ? value : "";
  for (const name of [
    "AWS_BEARER_TOKEN_BEDROCK",
    "OPENAI_API_KEY",
    "AGENTROUTER_API_KEY",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
  ]) {
    const secret = process.env[name]?.trim();
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  return text
    .replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
    .replace(/ABSK[A-Za-z0-9+/=_-]+/g, "[REDACTED_BEDROCK_KEY]");
}
export function bedrockException(
  error: unknown,
  context: {
    operation: BedrockOperation;
    endpoint: string;
    region: string;
    model: string;
  },
) {
  const e = error as {
    name?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number; requestId?: string };
  };
  return {
    provider: "bedrock",
    ...context,
    exception: sanitizeBedrockText(e?.name) || "UnknownError",
    httpStatus: e?.$metadata?.httpStatusCode ?? null,
    message: sanitizeBedrockText(e?.message),
    requestId: sanitizeBedrockText(e?.$metadata?.requestId) || null,
  };
}
export function logBedrockException(
  error: unknown,
  context: Parameters<typeof bedrockException>[1],
) {
  const diagnostic = bedrockException(error, context);
  console.error("Bedrock upstream exception", JSON.stringify(diagnostic));
  return diagnostic;
}
