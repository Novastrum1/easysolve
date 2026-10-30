import { providerConfig, generateAI } from "./providers";
import type OpenAI from "openai";
import {
  limit,
  type DeepSeekMessage,
  type OutputFormat,
} from "./providers/shared";
import { db } from "./db";
import {
  allowanceWindow,
  monthStart,
  nextMonth,
  settings,
  planLimits,
} from "./policy";
import { HttpError, rateLimit } from "./security";
import { providerFingerprint } from "./provider-status";
export class AllowanceError extends Error {
  constructor(
    message: string,
    public reset = nextMonth(),
  ) {
    super(message);
  }
}
export type AIConversation = {
  messages: DeepSeekMessage[];
  calls: { id: string; name: string; arguments: string }[];
  signal?: AbortSignal;
  onText?: (text: string) => void;
};
export async function ai(
  userId: string,
  purpose: string,
  input: string,
  instructions: string,
  runId?: string,
  tools?: OpenAI.Responses.Tool[],
  format?: OutputFormat,
  conversation?: AIConversation,
) {
  conversation?.signal?.throwIfAborted();
  const provider = providerConfig();
  if (!provider.configured)
    throw new HttpError(
      503,
      `${provider.name} is not configured. Ask the operator to set its server-side API key and restart the app and worker.`,
    );
  await rateLimit(`ai:${userId}`, limit("AI_REQUESTS_PER_MINUTE", 20));
  await rateLimit("ai:global", limit("AI_GLOBAL_REQUESTS_PER_MINUTE", 60));
  const result = await db
    .$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`usage:${userId}`}))`;
        const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (u.suspendedAt) throw new HttpError(403, "Account suspended");
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
        const max = limit("AI_MAX_OUTPUT_TOKENS", 6000, 128000);
        const reserve =
          Buffer.byteLength(
            input +
              instructions +
              JSON.stringify([
                tools ?? [],
                format ?? {},
                conversation?.messages ?? [],
              ]),
            "utf8",
          ) +
          512 +
          max;
        if ((usage._sum.total ?? 0) + reserve > planLimits(u).tokens)
          throw new AllowanceError(
            "Plan token allowance exhausted; queued until next reset",
            nextMonth(),
          );
        if ((cycle._sum.total ?? 0) + reserve > config.monthlyTokens)
          throw new AllowanceError(
            "Token allowance exhausted; queued until configured reset",
            window.reset,
          );
        if (
          Buffer.byteLength(
            input +
              instructions +
              JSON.stringify([
                tools ?? [],
                format ?? {},
                conversation?.messages ?? [],
              ]),
          ) > limit("AI_MAX_INPUT_BYTES", 200000)
        )
          throw new HttpError(
            413,
            "AI request exceeds the configured input limit. Narrow the context.",
          );
        if (runId) {
          const jobUsage = await tx.usage.aggregate({
            where: { userId, runId },
            _sum: { total: true },
            _count: true,
          });
          if (
            (jobUsage._sum.total ?? 0) + reserve >
              limit("AI_JOB_MAX_TOKENS", 500000) ||
            (await tx.aIRequest.count({ where: { userId, runId } })) >=
              limit("AI_JOB_MAX_REQUESTS", 18)
          )
            throw new HttpError(
              422,
              "AI job budget exhausted. Review the run and narrow its scope before retrying.",
            );
        }
        // Durable attempts include rejected/interrupted requests; usage rows remain actual receipts only.
        await db.aIRequest.create({ data: { userId, runId } });
        const response = await generateAI({
          input,
          instructions,
          maxTokens: max,
          tools,
          format,
          history: conversation?.messages,
          signal: conversation?.signal,
          onText: conversation?.onText,
        });
        const model = response.model;
        const usageData = response.usage;
        if (usageData)
          await tx.usage.create({
            data: {
              userId,
              provider: response.provider,
              runId,
              purpose,
              model,
              input: usageData?.input_tokens ?? 0,
              cached: usageData?.input_tokens_details?.cached_tokens ?? 0,
              output: usageData?.output_tokens ?? 0,
              reasoning:
                usageData?.output_tokens_details?.reasoning_tokens ?? 0,
              total: usageData?.total_tokens ?? 0,
            },
          });
        if (!response.failure)
          await tx.providerConnection.upsert({
            where: { id: provider.id },
            create: {
              id: provider.id,
              fingerprint: providerFingerprint(),
              model: provider.model,
              verifiedAt: new Date(),
            },
            update: {
              fingerprint: providerFingerprint(),
              model: provider.model,
              verifiedAt: new Date(),
            },
          });
        else
          await tx.providerConnection.upsert({
            where: { id: provider.id },
            create: {
              id: provider.id,
              fingerprint: providerFingerprint(),
              model: provider.model,
              verifiedAt: new Date(0),
            },
            update: {
              fingerprint: providerFingerprint(),
              model: provider.model,
              verifiedAt: new Date(0),
            },
          });
        return response;
      },
      { timeout: 110000 },
    )
    .catch(async (error: unknown) => {
      // A failed request revokes previous connection health; do not retain stale success.
      await db.providerConnection.upsert({
        where: { id: provider.id },
        create: {
          id: provider.id,
          fingerprint: providerFingerprint(),
          model: provider.model,
          verifiedAt: new Date(0),
        },
        update: {
          fingerprint: providerFingerprint(),
          model: provider.model,
          verifiedAt: new Date(0),
        },
      });
      throw error;
    });
  if (result.failure) throw result.failure;
  if (conversation) conversation.calls = result.calls;
  if (result.calls.length > 1) {
    return JSON.stringify({
      answer: "",
      actions: result.calls.map((c) => ({
        type: c.name,
        ...JSON.parse(c.arguments),
      })),
    });
  }
  const call = result.calls[0];
  if (call)
    return JSON.stringify({
      answer: "",
      action: { type: call.name, ...JSON.parse(call.arguments) },
    });
  if (!result.text.trim())
    throw new HttpError(
      502,
      `${provider.name} returned no usable output. No action was applied.`,
    );
  return result.text;
}
