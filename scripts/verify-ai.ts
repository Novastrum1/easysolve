import "../lib/load-env";
import { writeFile } from "node:fs/promises";
import { db } from "../lib/db";
import { ai } from "../lib/ai";
import { chat } from "../lib/chat";
import { AIProviderError } from "../lib/providers/openai";
import { providerConfig } from "../lib/providers";
const config = providerConfig();
const report: {
  provider: string;
  model: string;
  region?: string;
  at: string;
  workflows: { name: string; status: string; detail?: string }[];
  usage: unknown[];
} = {
  provider: config.id,
  model: config.model,
  region: "region" in config ? config.region : undefined,
  at: new Date().toISOString(),
  workflows: [],
  usage: [],
};
let userId = "";
try {
  if (!config.configured)
    throw new AIProviderError(
      "AI_CONFIGURATION",
      "Complete the selected provider configuration before live verification.",
      503,
    );
  process.env.AI_MAX_OUTPUT_TOKENS = "128";
  userId = (
    await db.user.create({
      data: {
        email: `openai-verification-${crypto.randomUUID()}@example.test`,
        name: "Temporary connection fixture",
        password: "no-login-fixture",
      },
    })
  ).id;
  for (const [name, action] of [
    [
      "streaming connection and usage receipt",
      async () => {
        const result = await ai(
          userId,
          "connection_verification",
          "Reply exactly EASYSOLVE_OK.",
          "Return the requested marker only.",
        );
        if (result.trim() !== "EASYSOLVE_OK")
          throw Error("Unexpected verification marker");
      },
    ],
    [
      "persistent chat response",
      async () => {
        const result = await chat(
          userId,
          "Reply exactly CHAT_OK. Do not use tools.",
        );
        if (!result.content.includes("CHAT_OK"))
          throw Error("Unexpected chat response");
        if ((await db.message.count({ where: { userId } })) !== 2)
          throw Error("Chat was not persisted");
      },
    ],
    [
      "harmless workspace tool call",
      async () => {
        const result = await chat(
          userId,
          "Use the check_jobs tool to read my current run status. Do not request any other action.",
          undefined,
          "tool-verification",
        );
        if (
          !Array.isArray(result.activity) ||
          !result.activity.some((a: any) => a.label === "Checked run status")
        )
          throw Error("Expected read-only tool call was not returned");
      },
    ],
  ] as const) {
    try {
      await action();
      report.workflows.push({ name, status: "verified" });
      console.log(`${name}: verified`);
    } catch (error) {
      report.workflows.push({
        name,
        status: "failed",
        detail:
          error instanceof AIProviderError
            ? `${error.code}: ${error.message}`
            : "Verification did not complete.",
      });
      process.exitCode = 1;
      break;
    }
  }
  for (const name of [
    "persistent chat response",
    "harmless workspace tool call",
  ]) {
    if (!report.workflows.some((w) => w.name === name))
      report.workflows.push({
        name,
        status: "blocked",
        detail: "Not attempted because an earlier verification failed.",
      });
  }
} catch (error) {
  report.workflows.push({
    name: "verification setup",
    status: "failed",
    detail:
      error instanceof AIProviderError
        ? error.code
        : "Local verification setup failed.",
  });
  process.exitCode = 1;
} finally {
  try {
    if (userId) {
      report.usage = await db.usage.findMany({
        where: { userId },
        select: {
          provider: true,
          model: true,
          purpose: true,
          input: true,
          cached: true,
          reasoning: true,
          output: true,
          total: true,
        },
      });
      await db.user.delete({ where: { id: userId } });
    }
    await writeFile(
      "docs/ai-live-verification.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      "Sanitized report: docs/ai-live-verification.json. No GitHub or agent actions attempted.",
    );
  } finally {
    await db.$disconnect();
  }
}
