import { deepseekConfig, generateDeepSeek } from "./deepseek";
export function providerConfig() {
  return { id: "deepseek" as const, name: "DeepSeek", ...deepseekConfig() };
}
export const generateAI = generateDeepSeek;
