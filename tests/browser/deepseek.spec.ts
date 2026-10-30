import "dotenv/config";
import { expect, test } from "@playwright/test";
import { db } from "../../lib/db";
const emails: string[] = [];
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
});
test("DeepSeek chat sends streaming requests and displays sanitized failures (mocked API)", async ({
  page,
  context,
  baseURL,
}) => {
  const email = `deepseek-browser-${crypto.randomUUID()}@example.test`;
  emails.push(email);
  const signup = await context.request.post(`${baseURL}/api/auth/signup`, {
    headers: { Origin: baseURL!, "X-Forwarded-For": email },
    data: {
      email,
      name: "Streaming fixture",
      password: "streaming-fixture-password",
    },
  });
  expect(signup.ok()).toBeTruthy();
  await page.goto("/chat");
  await expect(
    page.getByText(/^DeepSeek (configured but unverified|verified)$/, {
      exact: true,
    }),
  ).toBeVisible();
  await page.route("**/api/chat", async (route) => {
    expect(route.request().headers().accept).toBe("application/x-ndjson");
    await route.fulfill({
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({ type: "text", text: "Visible provisional answer" }) +
        "\n" +
        JSON.stringify({
          type: "error",
          error:
            "DeepSeek rejected the server API key. Update the private server configuration.",
        }) +
        "\n",
    });
  });
  await page.getByLabel("Message EasySolve").fill("Hello DeepSeek");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "DeepSeek rejected the server API key" }),
  ).toContainText("DeepSeek rejected the server API key");
  await expect(page.getByLabel("Message EasySolve")).toHaveValue(
    "Hello DeepSeek",
  );
  await expect(page.getByText("Visible provisional answer")).toHaveCount(0);
});
