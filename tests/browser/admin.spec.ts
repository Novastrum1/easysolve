import "dotenv/config";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";
import { db } from "../../lib/db";
let adminId = "",
  ordinaryId = "",
  adminEmail = "",
  ordinaryEmail = "",
  jobId = "";
test.beforeAll(async () => {
  for (const role of ["ADMIN", "USER"] as const) {
    const email = `admin-browser-${crypto.randomUUID()}@example.test`;
    const account = await db.user.create({
      data: {
        email,
        name:
          role === "ADMIN"
            ? "Admin browser fixture"
            : "Ordinary browser fixture",
        role,
        password: await bcrypt.hash("browser-fixture-password-123", 4),
      },
    });
    if (role === "ADMIN") {
      adminId = account.id;
      adminEmail = email;
    } else {
      ordinaryId = account.id;
      ordinaryEmail = email;
    }
  }
  jobId = (
    await db.job.create({
      data: {
        userId: ordinaryId,
        kind: "sync",
        key: `fixture:${crypto.randomUUID()}`,
        payload: {},
        status: "failed",
        error: "Browser fixture failure",
      },
    })
  ).id;
});
test.afterAll(async () => {
  await db.adminAudit.deleteMany({ where: { actorId: adminId } });
  await db.user.deleteMany({ where: { id: { in: [adminId, ordinaryId] } } });
  await db.$disconnect();
});
test("anonymous and ordinary accounts cannot open admin pages or call admin APIs", async ({
  page,
  request,
  baseURL,
}) => {
  expect((await request.get("/api/admin/overview")).status()).toBe(401);
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Owner dashboard" }),
  ).toHaveCount(0);
  const login = await page.request.post("/api/auth/login", {
    headers: { Origin: baseURL! },
    data: { email: ordinaryEmail, password: "browser-fixture-password-123" },
  });
  expect(login.status()).toBe(200);
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Owner dashboard" }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/admin/users")).status()).toBe(403);
  expect(
    (
      await page.request.post(`/api/admin/users/${ordinaryId}/plan`, {
        headers: { Origin: baseURL! },
        data: {
          planName: "Unauthorized",
          planMaxJobs: 100000,
          planMaxTokens: 2000000000,
        },
      })
    ).status(),
  ).toBe(403);
  await page.goto("/overview");
  await expect(page.getByRole("link", { name: "Owner dashboard" })).toHaveCount(
    0,
  );
});
test("owner dashboard supports account controls, job inspection, health, and audit on desktop and mobile", async ({
  page,
  baseURL,
}, info) => {
  expect(
    (
      await page.request.post("/api/auth/login", {
        headers: { Origin: baseURL! },
        data: { email: adminEmail, password: "browser-fixture-password-123" },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Owner dashboard" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Provider connection health" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Administration" })
    .getByRole("button", { name: "Users", exact: true })
    .click();
  await page.getByLabel("Search users").fill(ordinaryEmail);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("table").getByText(ordinaryEmail, { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: ordinaryEmail })
    .getByRole("button", { name: "View account", exact: true })
    .click();
  const detail = page.getByRole("region", { name: "Account details" });
  await expect(
    detail.getByRole("heading", { name: "Ordinary browser fixture" }),
  ).toBeVisible();
  await page.getByLabel("Plan name", { exact: true }).fill("Owner managed");
  await page.getByLabel("Monthly plan job limit").fill("12");
  await page.getByLabel("Monthly plan token limit").fill("50000");
  await page.getByRole("button", { name: "Save plan limits" }).click();
  await expect(
    page.getByText("Plan limits updated.", { exact: true }),
  ).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .getByLabel("Reason for account access change")
    .fill("Browser suspension check");
  await page.getByRole("button", { name: "Suspend account" }).click();
  await expect(
    page.getByRole("button", { name: "Reactivate account" }),
  ).toBeVisible();
  await page
    .getByLabel("Reason for account access change")
    .fill("Browser reactivation check");
  await page.getByRole("button", { name: "Reactivate account" }).click();
  await expect(
    page.getByRole("button", { name: "Suspend account" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Administration" })
    .getByRole("button", { name: "Jobs", exact: true })
    .click();
  const row = page.getByRole("row").filter({ hasText: jobId });
  await row.getByRole("button", { name: "Inspect job" }).click();
  await expect(page.getByRole("region", { name: "Job details" })).toContainText(
    "Browser fixture failure",
  );
  await page.getByRole("button", { name: "Cancel job" }).click();
  await expect(page.getByRole("region", { name: "Job details" })).toContainText(
    "cancelled",
  );
  await page
    .getByRole("navigation", { name: "Administration" })
    .getByRole("button", { name: "Audit log" })
    .click();
  await expect(
    page.getByRole("cell", { name: "account.plan", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "account.suspend", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "job.cancel", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/admin-${info.project.name}.png`,
    fullPage: true,
  });
});
