import { expect,test } from "@playwright/test";
import "dotenv/config";
import { db } from "../../lib/db";
const emails: string[] = [];
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
});
test("signup, every workspace screen, persistence, responsive navigation and logout", async ({
  page,
}, info) => {
  const email = `browser-${crypto.randomUUID()}@example.test`;
  emails.push(email);
  await page.goto("/");
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await page.getByLabel("Your name").fill("Browser fixture");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-browser-password-123");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: /Let’s move good work forward/ }),
  ).toBeVisible();
  await expect(page.getByText("An agent’s momentum.")).toHaveCount(0);
  await page.screenshot({
    path: `test-results/overview-${info.project.name}.png`,
    fullPage: true,
  });
  const pages = [
    ["Chat", "A little direction goes a long way."],
    ["Issues", "Good work starts here."],
    ["Runs", "Every run. Every step."],
    ["Find issues", "An open issue. A real opportunity."],
    ["Wave apply", "Make your next Wave count."],
    ["Dashboard", "A healthy project starts here."],
    ["Assignments", "The right issue. The right contributor."],
    ["Review queue", "The last mile deserves a closer look."],
    ["Repositories", "A considered home for your repositories."],
    ["AI usage", "A clear view of your AI usage."],
    ["Run settings", "Set the pace. Keep control."],
    ["Account", "Your account. Your identities."],
    ["Plans & billing", "A plan that’s clear about its limits."],
  ];
  for (const [name, heading] of pages) {
    if (info.project.name === "mobile")
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.goto("/settings");
  await page.getByText("Plan only", { exact: true }).click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toContainText("Run settings saved");
  await page.reload();
  await expect(page.getByRole("radio", { name: /Plan only/ })).toBeChecked();
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Profile menu" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to EasySolve." }),
  ).toBeVisible();
});
test("authentication, CSRF and cross-user resource isolation", async ({
  browser,
  baseURL,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const emailA = `isolation-${crypto.randomUUID()}@example.test`,
    emailB = `isolation-${crypto.randomUUID()}@example.test`;
  emails.push(emailA, emailB);
  for (const [context, email] of [
    [a, emailA],
    [b, emailB],
  ] as const) {
    const signup = await context.request.post(`${baseURL}/api/auth/signup`, {
      headers: { Origin: baseURL! },
      data: {
        email,
        name: "Isolation fixture",
        password: "long-test-password-123",
      },
    });
    expect(signup.status()).toBe(200);
  }
  const owner = await db.user.findUniqueOrThrow({ where: { email: emailA } });
  const run = await db.run.create({
    data: {
      userId: owner.id,
      identityId: "test-fixture",
      repo: "test/private",
      issueIds: [],
      title: "Private fixture run",
      branch: `test/${crypto.randomUUID()}`,
    },
  });
  expect((await a.request.get(`${baseURL}/api/runs/${run.id}`)).status()).toBe(
    200,
  );
  expect((await b.request.get(`${baseURL}/api/runs/${run.id}`)).status()).toBe(
    404,
  );
  expect(
    (
      await b.request.post(`${baseURL}/api/runs/${run.id}/cancel`, {
        headers: { Origin: baseURL! },
        data: {},
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await a.request.post(`${baseURL}/api/settings`, {
        headers: { Origin: "https://evil.test" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect((await a.request.get(`${baseURL}/api/auth/logout`)).status()).toBe(
    405,
  );
  const payload = await (
    await a.request.get(`${baseURL}/api/bootstrap`)
  ).json();
  expect(payload.user.password).toBeUndefined();
  expect(payload.identities.every((i: any) => i.token === undefined)).toBe(
    true,
  );
  await a.close();
  await b.close();
});
