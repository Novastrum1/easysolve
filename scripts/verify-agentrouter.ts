import "dotenv/config";
import { writeFile } from "node:fs/promises";
import {
  agentrouterConfig,
  agentrouterModels,
} from "../lib/providers/agentrouter";
import { AIProviderError } from "../lib/providers/openai";
import { ai } from "../lib/ai";
import { chat } from "../lib/chat";
import { db } from "../lib/db";
// Explicitly selected provider only. No environment credential is copied to another provider.
process.env.AI_PROVIDER = "agentrouter";
process.env.AI_MAX_OUTPUT_TOKENS = "512";
const config = agentrouterConfig();
const report: {
  at: string;
  provider: string;
  model: string;
  models: string[];
  astraAvailable: boolean | null;
  workflows: { name: string; status: string; code?: string; detail?: string }[];
  usage: unknown[];
} = {
  at: new Date().toISOString(),
  provider: "agentrouter",
  model: config.model,
  models: [],
  astraAvailable: null,
  workflows: [],
  usage: [],
};
let userId = "";
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    report.workflows.push({ name, status: "verified" });
  } catch (error) {
    report.workflows.push({
      name,
      status: "failed",
      code:
        error instanceof AIProviderError ? error.code : "VERIFICATION_FAILED",
      detail:
        error instanceof AIProviderError
          ? error.message
          : "Verification did not complete; no success is claimed.",
    });
    throw error;
  }
}
try {
  await step("authenticated model catalog", async () => {
    report.models = await agentrouterModels();
    report.astraAvailable = report.models.includes("gpt-6-astra");
  });
  if (!config.model || !report.models.includes(config.model))
    throw new AIProviderError(
      "AI_MODEL_UNAVAILABLE",
      "Requested model is not in the token catalog. Choose an available model explicitly; no substitute was used.",
      503,
    );
  userId = (
    await db.user.create({
      data: {
        email: `gateway-verification-${crypto.randomUUID()}@example.test`,
        name: "Temporary gateway fixture",
        password: "no-login",
      },
    })
  ).id;
  await step("streamed Chat Completions and actual usage", async () => {
    const text = await ai(
      userId,
      "connection_verification",
      "Reply exactly EASYSOLVE_OK.",
      "Return the requested marker only.",
    );
    if (text.trim() !== "EASYSOLVE_OK") throw Error("Unexpected marker");
  });
  await step("harmless query_issues function workflow", async () => {
    const result = await chat(
      userId,
      "Use query_issues to list my workspace issues. Do not use any other tool.",
    );
    if (
      !(result.activity as any[]).some((v) => v.label === "Queried your issues")
    )
      throw Error("Read-only tool was not called");
    if (await db.run.count({ where: { userId } }))
      throw Error("Unexpected run");
  });
  await step("strict structured output", async () => {
    const text = await ai(
      userId,
      "structured_verification",
      'Return {"ok":true}.',
      "Return the requested JSON.",
      undefined,
      undefined,
      {
        type: "json_schema",
        name: "verification",
        strict: true,
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
      },
    );
    if (JSON.parse(text).ok !== true) throw Error("Schema output mismatch");
  });
} catch (error) {
  process.exitCode = 1;
  if (!report.workflows.some((w) => w.status === "failed"))
    report.workflows.push({
      name: "model selection",
      status: "blocked",
      code:
        error instanceof AIProviderError ? error.code : "VERIFICATION_FAILED",
      detail:
        error instanceof AIProviderError ? error.message : "No model selected.",
    });
} finally {
  try {
    for (const name of [
      "streamed Chat Completions and actual usage",
      "harmless query_issues function workflow",
      "strict structured output",
    ])
      if (!report.workflows.some((w) => w.name === name))
        report.workflows.push({
          name,
          status: "blocked",
          detail:
            "Authentication or model availability must be resolved first.",
        });
    report.workflows.push({
      name: "Responses API",
      status: "unverified",
      detail:
        "The current official co.agentrouter.org guide documents Chat Completions. Responses support is not established; EasySolve uses the documented chat endpoint.",
    });
    if (userId) {
      report.usage = await db.usage.findMany({
        where: { userId },
        select: {
          provider: true,
          model: true,
          input: true,
          cached: true,
          reasoning: true,
          output: true,
          total: true,
        },
      });
      await db.user.delete({ where: { id: userId } });
      await db.rateLimit.deleteMany({ where: { key: `ai:${userId}` } });
    }
    await writeFile(
      "docs/agentrouter-live-verification.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await db.$disconnect();
  }
}
