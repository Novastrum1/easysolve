import OpenAI from "openai";
import {
  AIProviderError,
  limit,
  usageSchema,
  type Generation,
  type OutputFormat,
} from "./openai";

export function agentrouterConfig() {
  const baseURL = (
    process.env.AGENTROUTER_BASE_URL?.trim() || "https://co.agentrouter.org/v1"
  ).replace(/\/$/, "");
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    throw new AIProviderError(
      "AI_CONFIGURATION",
      "Invalid AGENTROUTER_BASE_URL.",
      503,
    );
  }
  // Never allow an AgentRouter credential to reach OpenAI or follow a redirect there.
  if (
    url.protocol !== "https:" ||
    !["co.agentrouter.org", "agentrouter.org"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/v1"
  )
    throw new AIProviderError(
      "AI_CONFIGURATION",
      "AGENTROUTER_BASE_URL must be an HTTPS AgentRouter /v1 endpoint. OpenAI and other hosts are forbidden.",
      503,
    );
  return {
    baseURL,
    model: process.env.AGENTROUTER_MODEL?.trim() || "",
    timeout: limit("AGENTROUTER_TIMEOUT_MS", 90000, 90000),
  };
}
export function agentrouterError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) return error;
  const e = error as {
    status?: number;
    name?: string;
    code?: string;
    message?: string;
    error?: { message?: string; code?: string };
  };
  const text = `${e?.message ?? ""} ${e?.error?.message ?? ""}`.toLowerCase();
  if (e?.status === 401 && text.includes("unauthorized client detected"))
    return new AIProviderError(
      "AI_CLIENT_RESTRICTED",
      "AgentRouter rejected EasySolve as an unauthorized client. Ask AgentRouter support (neo@agentrouter.org) to authorize this application and token for the documented API. No client impersonation or bypass was attempted.",
      503,
    );
  if (e?.status === 401)
    return new AIProviderError(
      "AI_AUTHENTICATION",
      "AgentRouter rejected the gateway token or client access. Check AGENTROUTER_API_KEY in the server environment and confirm API/client authorization with AgentRouter support.",
      503,
    );
  if (e?.status === 403)
    return new AIProviderError(
      "AI_FORBIDDEN",
      "AgentRouter denied model or client access. Ask the account administrator or AgentRouter support to enable the requested resource pool.",
      403,
    );
  if (e?.status === 402 || (e?.code ?? e?.error?.code) === "insufficient_quota")
    return new AIProviderError(
      "AI_QUOTA",
      "AgentRouter credit, resource-pool quota, or account allowance is exhausted. Check the gateway account; wallet credit alone may not grant access.",
      402,
    );
  if (e?.status === 404)
    return new AIProviderError(
      "AI_GATEWAY_UNSUPPORTED",
      "AgentRouter did not expose the requested endpoint or model. Check the gateway API documentation and token model catalog. No fallback was used.",
      503,
    );
  if (e?.status === 429)
    return new AIProviderError(
      "AI_RATE_LIMIT",
      "AgentRouter rate limit reached. Retry later.",
      429,
      true,
    );
  if (e?.status === 400 || e?.status === 422)
    return new AIProviderError(
      "AI_PARAMETERS",
      "AgentRouter rejected the model or Chat Completions parameters (streaming, tools, or JSON schema). Compatibility is not verified. No weaker request or alternate model was substituted.",
      502,
    );
  if (
    e?.status === 408 ||
    ["TimeoutError", "AbortError", "APIConnectionTimeoutError"].includes(
      e?.name ?? "",
    )
  )
    return new AIProviderError(
      "AI_TIMEOUT",
      "AgentRouter timed out. No partial action was applied.",
      504,
      true,
    );
  return new AIProviderError(
    "AI_UNAVAILABLE",
    "AgentRouter is unavailable or the stream was interrupted. No successful result was recorded.",
    503,
    true,
  );
}
function client() {
  const config = agentrouterConfig();
  const key = process.env.AGENTROUTER_API_KEY?.trim();
  if (!key)
    throw new AIProviderError(
      "AI_SETUP",
      "AgentRouter is not configured. Set AGENTROUTER_API_KEY privately on the server and restart web and worker.",
      503,
    );
  return {
    config,
    sdk: new OpenAI({
      apiKey: key,
      baseURL: config.baseURL,
      timeout: config.timeout,
      maxRetries: 0,
      fetch: (url, init) => fetch(url, { ...init, redirect: "error" }),
    }),
  };
}
export async function agentrouterModels(
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const { sdk, config } = client();
    const result = await sdk.models.list({
      signal: signal ?? AbortSignal.timeout(config.timeout),
    });
    if (!Array.isArray(result.data))
      throw new AIProviderError(
        "AI_CATALOG_UNSUPPORTED",
        "AgentRouter did not return an OpenAI-compatible model catalog. Ask support for a token-scoped catalog; model access remains unverified.",
        503,
      );
    return result.data.map((m) => m.id).filter((id) => typeof id === "string");
  } catch (error) {
    throw agentrouterError(error);
  }
}
export async function generateAgentRouter(input: {
  instructions: string;
  input: string;
  maxTokens: number;
  tools?: OpenAI.Responses.Tool[];
  format?: OutputFormat;
}): Promise<Generation> {
  try {
    const { sdk, config } = client();
    if (!config.model)
      throw new AIProviderError(
        "AI_MODEL_REQUIRED",
        "Set AGENTROUTER_MODEL to an exact ID from the authenticated gateway catalog. No model was selected automatically.",
        503,
      );
    const signal = AbortSignal.timeout(config.timeout);
    const models = await agentrouterModels(signal);
    if (!models.includes(config.model))
      throw new AIProviderError(
        "AI_MODEL_UNAVAILABLE",
        "The configured model is absent from this AgentRouter token’s catalog. Run npm run agentrouter:verify to list available models and choose one. No substitute was used.",
        503,
      );
    const tools = input.tools?.map((tool) => {
      if (tool.type !== "function")
        throw new AIProviderError(
          "AI_TOOL_UNSUPPORTED",
          "Only validated function tools are enabled for AgentRouter.",
        );
      return {
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description ?? undefined,
          parameters: tool.parameters ?? undefined,
          strict: tool.strict ?? false,
        },
      };
    });
    const format = input.format;
    const response_format =
      format?.type === "json_schema"
        ? {
            type: "json_schema" as const,
            json_schema: {
              name: format.name,
              schema: format.schema,
              strict: format.strict ?? true,
            },
          }
        : format?.type === "json_object"
          ? { type: "json_object" as const }
          : undefined;
    const stream = await sdk.chat.completions.create(
      {
        model: config.model,
        messages: [
          { role: "system", content: input.instructions },
          { role: "user", content: input.input },
        ],
        max_tokens: input.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        ...(tools ? { tools, parallel_tool_calls: false } : {}),
        ...(response_format ? { response_format } : {}),
      },
      { signal },
    );
    let text = "",
      finish: string | null = null,
      usage: Generation["usage"] = null,
      model = config.model,
      refused = false;
    const calls = new Map<number, { name: string; arguments: string }>();
    for await (const chunk of stream) {
      if (chunk.model) model = chunk.model;
      if (chunk.usage) {
        const u = usageSchema.safeParse({
          input_tokens: chunk.usage.prompt_tokens,
          input_tokens_details: chunk.usage.prompt_tokens_details,
          output_tokens: chunk.usage.completion_tokens,
          output_tokens_details: chunk.usage.completion_tokens_details,
          total_tokens: chunk.usage.total_tokens,
        });
        if (u.success) usage = u.data;
      }
      const choice = chunk.choices.find((c) => c.index === 0);
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      if (choice.delta.refusal) refused = true;
      text += choice.delta.content ?? "";
      for (const call of choice.delta.tool_calls ?? []) {
        const current = calls.get(call.index) ?? { name: "", arguments: "" };
        current.name += call.function?.name ?? "";
        current.arguments += call.function?.arguments ?? "";
        calls.set(call.index, current);
      }
    }
    const failure = !finish
      ? new AIProviderError(
          "AI_STREAM_INTERRUPTED",
          "AgentRouter ended the stream without a finish receipt. Partial output was not applied.",
          502,
          true,
        )
      : !["stop", "tool_calls"].includes(finish)
        ? new AIProviderError(
            "AI_INCOMPLETE",
            "AgentRouter output was truncated or filtered. Partial output was not applied.",
          )
        : refused
          ? new AIProviderError(
              "AI_REFUSAL",
              "AgentRouter declined the request. No action was applied.",
            )
          : !usage
            ? new AIProviderError(
                "AI_USAGE_MISSING",
                "AgentRouter omitted valid stream usage. No successful action was accepted.",
              )
            : null;
    return {
      provider: "agentrouter",
      model,
      text,
      calls: [...calls.values()],
      usage,
      failure,
    };
  } catch (error) {
    throw agentrouterError(error);
  }
}
