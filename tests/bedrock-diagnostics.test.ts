import { afterEach, expect, it, vi } from "vitest";
import {
  bedrockException,
  sanitizeBedrockText,
} from "../lib/providers/bedrock-diagnostics";
afterEach(() => vi.unstubAllEnvs());
it("preserves full AWS evidence while redacting credentials and excluding raw error objects", () => {
  vi.stubEnv("AWS_BEARER_TOKEN_BEDROCK", "private-diagnostic-fixture");
  const message =
    "Model unavailable. private-diagnostic-fixture Bearer another-secret ABSKtestSecret123==";
  const result = bedrockException(
    {
      name: "AccessDeniedException",
      message,
      $metadata: { httpStatusCode: 403, requestId: "request-fixture" },
      request: { headers: { authorization: "private-diagnostic-fixture" } },
    },
    {
      operation: "Converse",
      endpoint:
        "https://bedrock-runtime.eu-north-1.amazonaws.com/model/fixture/converse",
      region: "eu-north-1",
      model: "fixture",
    },
  );
  expect(result).toMatchObject({
    exception: "AccessDeniedException",
    httpStatus: 403,
    requestId: "request-fixture",
    operation: "Converse",
    region: "eu-north-1",
    model: "fixture",
  });
  expect(result.message).toBe(
    "Model unavailable. [REDACTED] Bearer [REDACTED] [REDACTED_BEDROCK_KEY]",
  );
  expect(result).not.toHaveProperty("request");
});
it("does not truncate the full sanitized AWS message", () => {
  const message = "Access denied detail ".repeat(500);
  expect(sanitizeBedrockText(message)).toBe(message);
});
