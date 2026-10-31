import OpenAI from "openai";
import Ajv from "ajv";
import {
  AIProviderError,
  limit,
  providerError,
  usageSchema,
  type Generation,
  type OutputFormat,
  type DeepSeekMessage,
} from "./shared";

export function deepseekConfig() {
  if (process.env.AI_PROVIDER && process.env.AI_PROVIDER.trim() !== "deepseek")
    throw new AIProviderError(
      "AI_CONFIGURATION",
      "AI_PROVIDER must be deepseek.",
      503,
    );
  const baseURL = (
    process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com"
  ).replace(/\/$/, "");
  if (
    !["https://api.deepseek.com", "https://api.deepseek.com/v1"].includes(
      baseURL,
    )
  )
    throw new AIProviderError(
      "AI_CONFIGURATION",
      "DEEPSEEK_BASE_URL must use the official https://api.deepseek.com endpoint.",
      503,
    );
  const thinking = process.env.DEEPSEEK_THINKING || "disabled";
  if (!["enabled", "disabled"].includes(thinking))
    throw new AIProviderError(
      "AI_CONFIGURATION",
      "DEEPSEEK_THINKING must be enabled or disabled.",
      503,
    );
  return {
    baseURL,
    model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash",
    timeout: limit("DEEPSEEK_TIMEOUT_MS", 90000, 90000),
    thinking,
    key: process.env.DEEPSEEK_API_KEY?.trim() || "",
    configured: !!process.env.DEEPSEEK_API_KEY?.trim(),
  };
}
const validator = new Ajv({ strict: false, validateFormats: false });
export async function generateDeepSeek(input: {
  instructions: string;
  input: string;
  maxTokens: number;
  tools?: OpenAI.Responses.Tool[];
  format?: OutputFormat;
  history?: DeepSeekMessage[];
  signal?: AbortSignal;
  onText?: (text: string) => void;
}): Promise<Generation> {
  const config = deepseekConfig();
  if (!config.configured)
    throw new AIProviderError(
      "AI_SETUP",
      "DeepSeek is not configured. Set DEEPSEEK_API_KEY in the private root .env and restart web and worker.",
      503,
    );
  const tools = input.tools?.map((t) => {
    if (t.type !== "function")
      throw new AIProviderError(
        "AI_TOOL_UNSUPPORTED",
        "Only function tools are supported.",
      );
    return {
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description ?? undefined,
        parameters: t.parameters ?? undefined,
      },
    };
  });
  const messages: DeepSeekMessage[] = input.history?.length
    ? [...input.history]
    : [
        {
          role: "system",
          content:
            input.instructions +
            (input.format
              ? `\nReturn JSON matching this schema: ${JSON.stringify(input.format)}`
              : ""),
        },
        { role: "user", content: input.input },
      ];
  try {
    const sdk = new OpenAI({
      apiKey: config.key,
      baseURL: config.baseURL,
      timeout: config.timeout,
      maxRetries: 0,
      fetch: (url, init) => fetch(url, { ...init, redirect: "error" }),
    });
    const deadline = AbortSignal.timeout(config.timeout);
    const signal = input.signal
      ? AbortSignal.any([input.signal, deadline])
      : deadline;
    const stream = await sdk.chat.completions.create(
      {
        model: config.model,
        messages,
        max_tokens: input.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        ...(tools?.length ? { tools } : {}),
        ...(input.format
          ? { response_format: { type: "json_object" as const } }
          : {}),
        ...({ thinking: { type: config.thinking } } as Record<string, unknown>),
      },
      { signal },
    );
    let text = "",
      reasoning = "",
      finish: string | null = null;
    let usage: Generation["usage"] = null;
    let model = config.model;
    const calls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    for await (const chunk of stream) {
      model = chunk.model || model;
      if (chunk.usage) {
        const u = chunk.usage as typeof chunk.usage & {
          prompt_cache_hit_tokens?: number;
        };
        const parsed = usageSchema.safeParse({
          input_tokens: u.prompt_tokens,
          input_tokens_details: {
            cached_tokens:
              u.prompt_cache_hit_tokens ??
              u.prompt_tokens_details?.cached_tokens ??
              0,
          },
          output_tokens: u.completion_tokens,
          output_tokens_details: u.completion_tokens_details,
          total_tokens: u.total_tokens,
        });
        if (parsed.success) usage = parsed.data;
      }
      const choice = chunk.choices.find((c) => c.index === 0);
      if (!choice) continue;
      finish = choice.finish_reason ?? finish;
      const delta = choice.delta as typeof choice.delta & {
        reasoning_content?: string;
      };
      reasoning += delta.reasoning_content ?? "";
      text += delta.content ?? "";
      if (delta.content) input.onText?.(delta.content);
      for (const call of delta.tool_calls ?? []) {
        const current = calls.get(call.index) ?? {
          id: "",
          name: "",
          arguments: "",
        };
        current.id += call.id ?? "";
        current.name += call.function?.name ?? "";
        current.arguments += call.function?.arguments ?? "";
        calls.set(call.index, current);
      }
    }
    const list = [...calls.values()];
    let failure: AIProviderError | null = !["stop", "tool_calls"].includes(
      finish ?? "",
    )
      ? new AIProviderError(
          "AI_INCOMPLETE",
          "DeepSeek output was interrupted, truncated, or filtered. Partial actions were not applied.",
          502,
          true,
        )
      : !usage
        ? new AIProviderError(
            "AI_USAGE_MISSING",
            "DeepSeek omitted a valid usage receipt. No action was accepted.",
          )
        : null;
    if (!failure && !list.length && !text.trim())
      failure = new AIProviderError(
        "AI_EMPTY_OUTPUT",
        "DeepSeek returned no usable output. No action was applied.",
      );
    if (!failure) {
      try {
        if ((finish === "tool_calls") !== !!list.length) throw Error();
        for (const call of list) {
          const tool = tools?.find((t) => t.function.name === call.name);
          if (
            !call.id ||
            !tool ||
            !validator.validate(
              tool.function.parameters ?? {},
              JSON.parse(call.arguments),
            )
          )
            throw Error();
        }
        if (
          input.format?.type === "json_schema" &&
          !validator.validate(input.format.schema, JSON.parse(text))
        )
          throw Error();
        if (input.format?.type === "json_object") JSON.parse(text);
      } catch {
        failure = new AIProviderError(
          "AI_INVALID_OUTPUT",
          "DeepSeek returned invalid JSON or tool arguments. No action was applied.",
        );
      }
    }
    const assistant: DeepSeekMessage = {
      role: "assistant",
      content: text || null,
      ...(config.thinking === "enabled"
        ? { reasoning_content: reasoning }
        : {}),
      ...(list.length
        ? {
            tool_calls: list.map((c) => ({
              id: c.id,
              type: "function" as const,
              function: { name: c.name, arguments: c.arguments },
            })),
          }
        : {}),
    };
    // Reasoning is returned only to the internal conversation, never the UI or database.
    if (!failure && input.history) {
      if (!input.history.length) input.history.push(...messages);
      input.history.push(assistant);
    }
    return { provider: "deepseek", model, text, calls: list, usage, failure };
  } catch (error) {
    throw providerError(error);
  }
}
