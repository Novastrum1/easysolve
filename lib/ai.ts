import type OpenAI from "openai";
import { generateDeepSeek } from "./providers/deepseek";
import { db } from "./db";
import { allowanceWindow, monthStart, nextMonth, settings } from "./policy";
import { HttpError } from "./security";
export class AllowanceError extends Error {
  constructor(
    message: string,
    public reset = nextMonth(),
  ) {
    super(message);
  }
}
export async function ai(
  userId: string,
  purpose: string,
  input: string,
  instructions: string,
  runId?: string,
  tools?: OpenAI.Responses.Tool[],
) {
  if (!process.env.DEEPSEEK_API_KEY)
    throw new HttpError(
      503,
      "DeepSeek is not configured. Set DEEPSEEK_API_KEY in Codespaces secrets and restart the app and worker.",
    );
  const result=await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`usage:${userId}`}))`;
      const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const config = settings(u.settings);
      const usage = await tx.usage.aggregate({
        where: { userId, createdAt: { gte: monthStart() } },
        _sum: { total: true },
      });
      const window = allowanceWindow(config);
      const cycle = await tx.usage.aggregate({
        where: { userId, createdAt: { gte: window.start } },
        _sum: { total: true },
      });
      const max = Number(process.env.AI_MAX_OUTPUT_TOKENS || 6000);
      const reserve =
        Buffer.byteLength(
          input + instructions + JSON.stringify(tools ?? []),
          "utf8",
        ) +
        512 +
        max;
      if (
        (usage._sum.total ?? 0) + reserve >
        Number(process.env.PLAN_MAX_TOKENS || 1000000)
      )
        throw new AllowanceError(
          "Plan token allowance exhausted; queued until next reset",
          nextMonth(),
        );
      if ((cycle._sum.total ?? 0) + reserve > config.monthlyTokens)
        throw new AllowanceError(
          "Token allowance exhausted; queued until configured reset",
          window.reset,
        );
      const response=await generateDeepSeek({input,instructions,maxTokens:max,tools});
      const model=response.model;
      const usageData = response.usage;
      if(usageData)await tx.usage.create({
        data: {
          userId,
          provider:response.provider,
          runId,
          purpose,
          model,
          input: usageData?.input_tokens ?? 0,
          cached: usageData?.input_tokens_details?.cached_tokens ?? 0,
          output: usageData?.output_tokens ?? 0,
          total: usageData?.total_tokens ?? 0,
        },
      });
      return response;
    },
    { timeout: 110000 },
  );
  if(result.failure)throw result.failure;
  if(result.calls.length>1){return JSON.stringify({answer:'',actions:result.calls.map(c=>({type:c.name,...JSON.parse(c.arguments)}))});}
  const call=result.calls[0];
  if(call)return JSON.stringify({answer:'',action:{type:call.name,...JSON.parse(call.arguments)}});
  if(!result.text.trim())throw new HttpError(502,'DeepSeek returned no usable output. No action was applied.');
  return result.text;
}
