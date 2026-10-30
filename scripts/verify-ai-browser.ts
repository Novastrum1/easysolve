// Explicitly invoked live check: one real browser chat request; no GitHub actions.
import "../lib/load-env";
import { chromium } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../lib/db";
import { providerStatus } from "../lib/provider-status";

let userId = "";
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const result: { name: string; status: string; detail?: string } = {
  name: "actual browser chat live response",
  status: "failed",
};
let usage: unknown[] = [];
try {
  const status = await providerStatus();
  if (!status.verified)
    throw Error("Connection must pass the bounded API verifier first");
  const user = await db.user.create({
    data: {
      email: `deepseek-live-browser-${crypto.randomUUID()}@example.test`,
      name: "Temporary live browser fixture",
      password: "no-login-fixture",
      settings: { monthlyTokens: 25000 },
    },
  });
  userId = user.id;
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      id: createHash("sha256").update(token).digest("hex"),
      userId,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  browser = await chromium.launch({ headless: true });
  const publicUrl = new URL(process.env.APP_URL || "http://localhost:3000");
  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    extraHTTPHeaders: { "X-Forwarded-Host": publicUrl.host },
  });
  await context.addCookies([
    {
      name: "es_session",
      value: token,
      url: "http://localhost:3000",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  await page.goto("/chat");
  await page
    .getByLabel("Message EasySolve")
    .fill("Reply exactly BROWSER_OK. Do not use tools. No explanation.");
  const received = page.waitForResponse(
    (r) => r.url().endsWith("/api/chat") && r.request().method() === "POST",
    { timeout: 100000 },
  );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const response = await received;
  if (
    response.status() !== 200 ||
    !response.headers()["content-type"]?.includes("application/x-ndjson")
  )
    throw Error("Browser chat did not return the expected stream");
  const frames = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  if (
    !frames.some((frame) => frame.type === "text" && frame.text) ||
    !frames.some(
      (frame) =>
        frame.type === "complete" &&
        frame.message?.content?.includes("BROWSER_OK"),
    ) ||
    frames.some((frame) => frame.type === "error")
  )
    throw Error("Browser stream did not complete successfully");
  await page
    .locator("article.message.assistant p")
    .filter({ hasText: "BROWSER_OK" })
    .waitFor({ timeout: 15000 });
  const stored = await db.message.findFirst({
    where: { userId, role: "assistant" },
  });
  if (!stored?.content.includes("BROWSER_OK"))
    throw Error("Browser response was not persisted");
  const current = await providerStatus();
  if (!current.verified || current.id !== "deepseek")
    throw Error("DeepSeek connection was not verified after browser chat");
  result.status = "verified";
  console.log(
    "Actual browser chat, visible stream, persistence and verified status: passed",
  );
} catch {
  result.detail =
    "Browser verification did not complete; no live success is claimed.";
  process.exitCode = 1;
  console.log("Actual browser chat: failed (sanitized details recorded)");
} finally {
  await browser?.close();
  if (userId) {
    usage = await db.usage.findMany({
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
  const path = "docs/ai-live-verification.json";
  const report = JSON.parse(await readFile(path, "utf8"));
  report.workflows = [
    ...report.workflows.filter((w: { name: string }) => w.name !== result.name),
    result,
  ];
  report.usage.push(...usage);
  report.browserCheckedAt = new Date().toISOString();
  await writeFile(path, JSON.stringify(report, null, 2) + "\n");
  await db.$disconnect();
}
