import "dotenv/config";
import { expect, test } from "@playwright/test";
import { db } from "../../lib/db";
const emails: string[] = [];
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
});
test("an existing conversation survives reply refresh and navigation with Promise-returning scrollIntoView", async ({
  page,
  context,
  baseURL,
}) => {
  const email = `chat-regression-${crypto.randomUUID()}@example.test`;
  emails.push(email);
  const signup = await context.request.post(`${baseURL}/api/auth/signup`, {
    headers: { Origin: baseURL!, "X-Forwarded-For": email },
    data: { email, name: "Chat fixture", password: "chat-regression-password" },
  });
  expect(signup.ok()).toBeTruthy();
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.message.createMany({
    data: [
      { userId: user.id, role: "user", content: "Previous greeting" },
      { userId: user.id, role: "assistant", content: "Previous saved reply" },
    ],
  });
  // Current browsers return a Promise; emulate the same API on older test browsers.
  await page.addInitScript(() => {
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
      return Promise.resolve(scroll.apply(this, args));
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/chat");
  await expect(page.locator("article.message.assistant")).toHaveCount(1);
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    await db.message.create({
      data: {
        id: body.requestId,
        userId: user.id,
        role: "user",
        content: body.text,
      },
    });
    const message = await db.message.create({
      data: {
        id: `${body.requestId}-reply`,
        userId: user.id,
        role: "assistant",
        content:
          body.text === "code"
            ? "```js\nconsole.log('ok')\n```"
            : body.text === "jobs"
              ? "There are no queued jobs."
              : "New normal reply",
        activity:
          body.text === "jobs"
            ? [{ type: "result", label: "Checked run status", result: [] }]
            : [],
      },
    });
    await route.fulfill({
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({ type: "text", text: message.content }) +
        "\n" +
        JSON.stringify({ type: "complete", message }) +
        "\n",
    });
  });
  await page.getByLabel("Message EasySolve").fill("hi");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("article.message.assistant")).toHaveCount(2);
  expect(errors).toEqual([]);
  await expect(
    page.getByText("Previous saved reply", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("This page couldn’t load", { exact: true }),
  ).toHaveCount(0);
  for (const prompt of ["code", "jobs"]) {
    await page.getByLabel("Message EasySolve").fill(prompt);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.locator("article.message.assistant")).toHaveCount(
      prompt === "code" ? 3 : 4,
    );
  }
  await expect(
    page
      .locator("article.message.assistant p")
      .filter({ hasText: "console.log('ok')" }),
  ).toBeVisible();
  await expect(
    page.getByText("Checked run status", { exact: true }),
  ).toBeVisible();
  if (
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .isVisible()
  ) {
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  }
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Let’s move good work forward/ }),
  ).toBeVisible();
  if (
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .isVisible()
  ) {
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  }
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Chat", exact: true })
    .click();
  await expect(page.locator("article.message.assistant")).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("network/provider failures stay inline, retry keeps its ID, and a refresh failure keeps the saved reply visible", async ({
  page,
  context,
  baseURL,
}) => {
  const email = `chat-retry-${crypto.randomUUID()}@example.test`;
  emails.push(email);
  expect(
    (
      await context.request.post(`${baseURL}/api/auth/signup`, {
        headers: { Origin: baseURL!, "X-Forwarded-For": email },
        data: {
          email,
          name: "Retry fixture",
          password: "chat-regression-password",
        },
      })
    ).ok(),
  ).toBeTruthy();
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.message.createMany({
    data: [
      { userId: user.id, role: "user", content: "Earlier user message" },
      {
        userId: user.id,
        role: "assistant",
        content: "Earlier assistant message",
      },
    ],
  });
  // Preserve support for older browsers whose scroll API returns undefined.
  await page.addInitScript(() => {
    const native = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
      native.apply(this, args);
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/chat");
  await expect(page.locator("article.message.assistant")).toHaveCount(1);
  let failRefresh = false;
  await page.route("**/api/bootstrap", (route) =>
    failRefresh
      ? route.fulfill({
          status: 503,
          json: { error: "Temporary refresh outage" },
        })
      : route.continue(),
  );
  const ids: string[] = [];
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    ids.push(body.requestId);
    if (ids.length === 1) return route.abort("failed");
    if (ids.length === 2)
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: '{"type":"text","text":"Partial"}\n{"type":"error","error":"DeepSeek rate limit reached. Retry later."}\n',
      });
    await db.message.create({
      data: {
        id: body.requestId,
        userId: user.id,
        role: "user",
        content: body.text,
      },
    });
    const message = await db.message.create({
      data: {
        id: `${body.requestId}-reply`,
        userId: user.id,
        role: "assistant",
        content: "Recovered real-contract fixture reply",
      },
    });
    failRefresh = true;
    return route.fulfill({
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({ type: "text", text: message.content }) +
        "\n" +
        JSON.stringify({ type: "complete", message }) +
        "\n",
    });
  });
  await page.getByLabel("Message EasySolve").fill("Please retry safely");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("Earlier assistant message", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry message", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "DeepSeek rate limit" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry message", exact: true })
    .click();
  await expect(
    page
      .locator("article.message.assistant p")
      .filter({ hasText: "Recovered real-contract fixture reply" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Live update failed: Temporary refresh outage/),
  ).toBeVisible();
  expect(new Set(ids).size).toBe(1);
  expect(await db.message.count({ where: { userId: user.id } })).toBe(4);
  expect(errors).toEqual([]);
  failRefresh = false;
  await page.reload();
  await expect(
    page
      .locator("article.message.assistant p")
      .filter({ hasText: "Recovered real-contract fixture reply" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
