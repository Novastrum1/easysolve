import "dotenv/config";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";
import { db } from "../../lib/db";
const emails: string[] = [];
const ratePrefix = `auth-browser-${crypto.randomUUID()}`;
let email = "";
const fixturePassword = "fixture-login-password";
test.beforeAll(async () => {
  email = `auth-browser-${crypto.randomUUID()}@example.test`;
  emails.push(email);
  await db.user.create({
    data: {
      email,
      name: "Login fixture",
      password: await bcrypt.hash(fixturePassword, 4),
    },
  });
});
test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({
    "X-Forwarded-For": `${ratePrefix}-${crypto.randomUUID()}`,
  });
});
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.rateLimit.deleteMany({
    where: { key: { startsWith: `auth:${ratePrefix}` } },
  });
  await db.$disconnect();
});
test("existing account signs in without a signup-only name", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(fixturePassword);
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/api/auth/login"),
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const login = await response;
  // Assert only field shape; never print the authentication payload or password.
  expect(login.status()).toBe(200);
  expect(Object.keys(login.request().postDataJSON()).sort()).toEqual([
    "email",
    "password",
  ]);
  await expect(
    page.getByRole("heading", { name: /Let’s move good work forward/ }),
  ).toBeVisible();
});
test("DOM-filled credentials submit without input events (autofill simulation)", async ({
  page,
}) => {
  await page.goto("/?reset=&redirect=");
  const emailInput = page.getByLabel("Email address");
  const passwordInput = page.getByLabel("Password", { exact: true });
  await expect(emailInput).toHaveAttribute("autocomplete", "username");
  await expect(passwordInput).toHaveAttribute(
    "autocomplete",
    "current-password",
  );
  await emailInput.evaluate((input, value) => {
    (input as HTMLInputElement).value = value;
  }, email);
  await passwordInput.evaluate((input, value) => {
    (input as HTMLInputElement).value = value;
  }, fixturePassword);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Let’s move good work forward/ }),
  ).toBeVisible();
});
test("signup and subsequent login accept an eight-character password", async ({
  page,
}) => {
  const signupEmail = `auth-signup-${crypto.randomUUID()}@example.test`;
  emails.push(signupEmail);
  await page.goto("/");
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await page.getByLabel("Your name").fill("Signup fixture");
  await page.getByLabel("Email address").fill(signupEmail);
  await page.getByLabel("Password", { exact: true }).fill("eight123");
  await expect(
    page.getByText("Use at least 8 characters.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: /Let’s move good work forward/ }),
  ).toBeVisible();
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByLabel("Email address").fill(signupEmail);
  await page.getByLabel("Password", { exact: true }).fill("eight123");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Let’s move good work forward/ }),
  ).toBeVisible();
});
test("a missing form control produces a field-level error", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(fixturePassword);
  await page.getByLabel("Email address").evaluate((input) => {
    (input as HTMLInputElement).disabled = true;
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByText("Enter your email address.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Invalid input:|expected string/)).toHaveCount(0);
});
test("invalid credentials show a useful sign-in error", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("incorrect-fixture-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "Email or password is incorrect",
  );
  await expect(page.getByText(/Invalid input:|expected string/)).toHaveCount(0);
});
