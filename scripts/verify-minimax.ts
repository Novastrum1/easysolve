import "../lib/load-env";
import bcrypt from "bcryptjs";
import { chromium, expect } from "@playwright/test";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../lib/db";
import { ai } from "../lib/ai";
import { chat } from "../lib/chat";
import { bedrockConfig } from "../lib/providers/bedrock";
import {
  bedrockException,
  sanitizeBedrockText,
} from "../lib/providers/bedrock-diagnostics";
import { AIProviderError } from "../lib/providers/openai";
import { providerStatus } from "../lib/provider-status";
const config = bedrockConfig();
if (
  process.env.AI_PROVIDER !== "bedrock" ||
  config.region !== "eu-north-1" ||
  config.model !== "minimax.minimax-m2.5" ||
  !config.configured
)
  throw Error(
    "Approved MiniMax configuration does not match; no requests made.",
  );
process.env.AI_MAX_OUTPUT_TOKENS = "1024";
const report: any = {
  at: new Date().toISOString(),
  provider: "bedrock",
  region: config.region,
  model: config.model,
  tests: [],
  usage: [],
  noGithubWrites: true,
};
if (process.argv.includes("--resume")) {
  const previous = JSON.parse(
    await readFile("docs/minimax-live-verification.json", "utf8"),
  );
  if (previous.model !== config.model || previous.region !== config.region)
    throw Error("Previous verification used a different configuration.");
  Object.assign(report, previous);
  report.resumedAt = new Date().toISOString();
}
let userId = "";
const email = `minimax-verification-${crypto.randomUUID()}@example.test`;
const password = crypto.randomUUID();
const client = new BedrockRuntimeClient({
  region: config.region,
  endpoint: config.baseURL,
  token: { token: config.key },
  authSchemePreference: ["httpBearerAuth"],
  maxAttempts: 1,
});
async function save() {
  await writeFile(
    "docs/minimax-live-verification.json",
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
}
try {
  userId = (
    await db.user.create({
      data: {
        email,
        name: "MiniMax verification",
        password: await bcrypt.hash(password, 10),
      },
    })
  ).id;
  const steps: [string, () => Promise<unknown>][] = [
    [
      "non-streaming Converse",
      async () => {
        const operation = "Converse" as const;
        try {
          const response = await client.send(
            new ConverseCommand({
              modelId: config.model,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      text: "Reply exactly MINIMAX_OK. Use at most one short sentence.",
                    },
                  ],
                },
              ],
              inferenceConfig: { maxTokens: 512 },
            }),
            { abortSignal: AbortSignal.timeout(config.timeout) },
          );
          const text =
            response.output?.message?.content
              ?.map((c) => c.text ?? "")
              .join("") ?? "";
          report.nonStreaming = {
            httpStatus: response.$metadata.httpStatusCode,
            requestId: response.$metadata.requestId,
            stopReason: response.stopReason,
            reply: text,
            usage: response.usage,
          };
          if (response.usage) {
            const u = response.usage;
            const input =
              (u.inputTokens ?? 0) +
              (u.cacheReadInputTokens ?? 0) +
              (u.cacheWriteInputTokens ?? 0);
            await db.usage.create({
              data: {
                userId,
                provider: "bedrock",
                purpose: "minimax_nonstream_verification",
                model: config.model,
                input,
                cached: u.cacheReadInputTokens ?? 0,
                output: u.outputTokens ?? 0,
                total: input + (u.outputTokens ?? 0),
              },
            });
          }
          if (
            response.stopReason !== "end_turn" ||
            !text.includes("MINIMAX_OK") ||
            !response.usage
          )
            throw Error(
              "Non-streaming response was incomplete or omitted marker/usage.",
            );
          return report.nonStreaming;
        } catch (error) {
          if (!(error instanceof AIProviderError))
            report.nonStreamingError = bedrockException(error, {
              operation,
              endpoint: `${config.baseURL}/model/${config.model}/converse`,
              region: config.region,
              model: config.model,
            });
          throw error;
        }
      },
    ],
    [
      "streaming response through EasySolve AI",
      async () => {
        const reply = await ai(
          userId,
          "minimax_stream_verification",
          "Reply exactly STREAM_OK.",
          "Return the requested marker only. Be brief.",
        );
        if (!reply.includes("STREAM_OK"))
          throw Error("Streaming marker missing.");
        return { reply, connection: await providerStatus() };
      },
    ],
    [
      "harmless tool-calling workflow",
      async () => {
        const result = await chat(
          userId,
          "Use check_jobs to read my current run status. Call only check_jobs with empty arguments. Do not request any write action.",
          undefined,
          "minimax-tool-verification",
          crypto.randomUUID(),
        );
        if (
          !Array.isArray(result.activity) ||
          !result.activity.some(
            (a: any) => a.label === "Checked run status" && a.type === "result",
          )
        )
          throw Error("Expected read-only check_jobs result was not returned.");
        if (result.activity.some((a: any) => a.type === "confirmation"))
          throw Error("Unexpected consequential-action preview returned.");
        return { reply: result.content, activity: result.activity };
      },
    ],
    [
      "actual EasySolve browser chat reply",
      async () => {
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage({
            viewport: { width: 1280, height: 900 },
          });
          await page.goto("http://localhost:3000/");
          await page.getByLabel("Email address").fill(email);
          await page.getByLabel("Password", { exact: true }).fill(password);
          await page
            .getByRole("button", { name: "Continue", exact: true })
            .click();
          await expect(
            page.getByRole("heading", { name: /Let’s move good work forward/ }),
          ).toBeVisible({ timeout: 15000 });
          await page.goto("http://localhost:3000/chat");
          // Use the normal UI submission, authentication, CSRF checks and chat persistence.
          await page
            .getByLabel("Message EasySolve")
            .fill("Reply exactly CHAT_OK. Do not use tools.");
          const pending = page.waitForResponse(
            (r) =>
              r.url().endsWith("/api/chat") && r.request().method() === "POST",
            { timeout: 100000 },
          );
          await page
            .getByRole("button", { name: "Send message", exact: true })
            .click();
          const response = await pending;
          const data = await response.json();
          if (!response.ok())
            throw new AIProviderError(
              "AI_CHAT_VERIFICATION",
              sanitizeBedrockText(data.error) || "Chat HTTP request failed",
              response.status(),
            );
          if (
            typeof data.content !== "string" ||
            !data.content.includes("CHAT_OK")
          )
            throw Error("Chat HTTP response omitted marker.");
          await expect(
            page.locator(".message.assistant").filter({ hasText: "CHAT_OK" }),
          ).toBeVisible({ timeout: 10000 });
          await page.reload();
          await expect(
            page.locator(".message.assistant").filter({ hasText: "CHAT_OK" }),
          ).toBeVisible({ timeout: 10000 });
          if (
            (await db.message.count({
              where: { userId, conversation: "default" },
            })) !== 2
          )
            throw Error("Chat created duplicate messages.");
          await mkdir("artifacts", { recursive: true });
          await page.screenshot({
            path: "artifacts/minimax-chat-verification.png",
            fullPage: true,
          });
          return {
            httpStatus: response.status(),
            reply: data.content,
            persistedAfterReload: true,
            messageCount: 2,
            screenshot: "artifacts/minimax-chat-verification.png",
          };
        } finally {
          await browser.close();
        }
      },
    ],
  ];
  for (const [name, action] of steps) {
    const previous = report.tests.find((t: any) => t.name === name);
    if (previous && previous.status !== "blocked") continue;
    report.tests = report.tests.filter((t: any) => t.name !== name);

    try {
      const detail = await action();
      report.tests.push({ name, status: "verified", detail });
      console.log(JSON.stringify({ name, status: "verified", detail }));
      await save();
    } catch (error) {
      report.tests.push({
        name,
        status: "failed",
        detail:
          error instanceof AIProviderError
            ? { code: error.code, message: error.message }
            : {
                message: sanitizeBedrockText(
                  error instanceof Error
                    ? error.message
                    : "Verification failed",
                ),
              },
      });
      console.log(JSON.stringify(report.tests.at(-1)));
      process.exitCode = 1;
      await save();
      if (!process.argv.includes("--resume")) break;
    }
  }
  for (const [name] of steps)
    if (!report.tests.some((t: any) => t.name === name))
      report.tests.push({
        name,
        status: "blocked",
        detail: "Earlier verification failed; not invoked.",
      });
  report.connection = await providerStatus();
} finally {
  client.destroy();
  if (userId) {
    report.usage = await db.usage.findMany({
      where: { userId },
      select: {
        provider: true,
        model: true,
        purpose: true,
        input: true,
        cached: true,
        output: true,
        reasoning: true,
        total: true,
      },
    });
    await db.user.delete({ where: { id: userId } });
  }
  await save();
  await db.$disconnect();
  console.log(
    "Sanitized results saved to docs/minimax-live-verification.json; temporary verification account removed.",
  );
}
