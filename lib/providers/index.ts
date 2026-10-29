import { AIProviderError, generateOpenAI, openaiConfig } from "./openai";
import { agentrouterConfig, generateAgentRouter } from "./agentrouter";
export function providerConfig() {
  const id = process.env.AI_PROVIDER?.trim() || "openai";
  if (id === "agentrouter")
    return {
      id,
      name: "AgentRouter",
      ...agentrouterConfig(),
      configured: !!process.env.AGENTROUTER_API_KEY?.trim(),
      key: process.env.AGENTROUTER_API_KEY ?? "",
    };
  if (id === "openai")
    return {
      id,
      name: "OpenAI",
      ...openaiConfig(),
      baseURL: "https://api.openai.com/v1",
      configured: !!process.env.OPENAI_API_KEY?.trim(),
      key: process.env.OPENAI_API_KEY ?? "",
    };
  throw new AIProviderError(
    "AI_CONFIGURATION",
    "AI_PROVIDER must be agentrouter or openai.",
    503,
  );
}
export const generateAI = (input: Parameters<typeof generateOpenAI>[0]) =>
  providerConfig().id === "agentrouter"
    ? generateAgentRouter(input)
    : generateOpenAI(input);
