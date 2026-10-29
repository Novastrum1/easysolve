import "dotenv/config";
import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { db } from "../../lib/db";
import type { Prisma } from "@prisma/client";
const currentPlan = () =>
  db.planVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
const STELLAR = {
  testnet: {
    issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    passphrase: "Test SDF Network ; September 2015",
  },
};
import { PNG } from "pngjs";
import jsQR from "jsqr";
let ownerId = "",
  userId = "",
  invoiceId = "",
  ownerEmail = "",
  email = "",
  bootstrapCreated = false;
const password = "browser-billing-fixture";
const address = "GBT7S5S4TZ7GZEAM5NP7A5M2EZYL2IHWTWNU6T7V5AYGCGIPEUPWKUOY";
test.beforeAll(async () => {
  ownerEmail = `billing-owner-${crypto.randomUUID()}@example.test`;
  email = `billing-user-${crypto.randomUUID()}@example.test`;
  const encoded = await bcrypt.hash(password, 4);
  ownerId = (
    await db.user.create({
      data: {
        email: ownerEmail,
        name: "Billing owner fixture",
        password: encoded,
        role: "ADMIN",
      },
    })
  ).id;
  userId = (
    await db.user.create({
      data: { email, name: "Billing customer fixture", password: encoded },
    })
  ).id;
  const owner = await db.adminBootstrap.findUnique({ where: { id: "owner" } });
  if (owner)
    throw Error(
      "Billing browser tests require an isolated database without an existing owner",
    );
  await db.adminBootstrap.create({ data: { id: "owner", userId: ownerId } });
  bootstrapCreated = true;
  const p = await currentPlan();
  invoiceId = (
    await db.invoice.create({
      data: {
        userId,
        planVersionId: p.id,
        network: "testnet",
        recipient: address,
        issuer: STELLAR.testnet.issuer,
        assetCode: "USDC",
        amount: "5.0000000",
        memo: `ES${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
        terms: p.settings as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 3600000),
      },
    })
  ).id;
});
test.afterAll(async () => {
  await db.adminAudit.deleteMany({
    where: { actorId: { in: [ownerId, userId] } },
  });
  await db.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
  if (bootstrapCreated)
    await db.adminBootstrap.delete({ where: { id: "owner" } });
  await db.planVersion.deleteMany({ where: { actorId: ownerId } });
  await db.$disconnect();
});
async function login(page: any, who: string) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(who);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Let’s move good work forward/ }),
  ).toBeVisible();
}
test("billing and checkout show exact testnet invoice, locally decoded QR, and pending hash verification", async ({
  page,
}) => {
  await login(page, email);
  await page.goto("/billing");
  await expect(
    page.getByText("Checkout is disabled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upgrade to EasySolve Pro" }),
  ).toBeDisabled();
  await expect(
    page.getByText("14 days of access", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Unlimited issue solving (owner-configured)", {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(`/checkout?invoice=${invoiceId}`);
  await expect(
    page.getByRole("heading", { name: "Stellar network — USDC" }),
  ).toBeVisible();
  await expect(page.getByText(/TESTNET — test USDC/)).toBeVisible();
  const qr = page.getByAltText("Stellar payment request QR code");
  await expect(qr).toBeVisible();
  const png = PNG.sync.read(
    Buffer.from((await qr.getAttribute("src"))!.split(",")[1], "base64"),
  );
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(decoded).not.toBeNull();
  const uri = new URL(decoded!.data);
  expect(uri.searchParams.get("destination")).toBe(address);
  expect(uri.searchParams.get("amount")).toBe("5.0000000");
  expect(uri.searchParams.get("asset_issuer")).toBe(STELLAR.testnet.issuer);
  expect(uri.searchParams.get("network_passphrase")).toBe(
    STELLAR.testnet.passphrase,
  );
  expect(uri.searchParams.get("memo")).toBe(
    (await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).memo,
  );
  await expect(
    page.getByRole("button", { name: "Copy receiving address", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy memo", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Transaction hash", { exact: true })
    .fill("a".repeat(64));
  await page.getByRole("button", { name: "Submit for verification" }).click();
  await expect(
    page.getByText(/Transaction queued for independent verification/),
  ).toBeVisible();
  expect(await db.entitlementGrant.count({ where: { invoiceId } })).toBe(0);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: userId } })).membershipPlan,
  ).toBe("basic");
});
test("owner manages audited Pro grants and overrides without fabricating payments", async ({
  page,
}) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email address").fill(ownerEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in to administration" }).click();
  await expect(
    page.getByRole("heading", { name: "Owner dashboard" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByLabel("Search users").fill(email);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: email })
    .getByRole("button", { name: "View account", exact: true })
    .click();
  await page
    .getByLabel("Required entitlement change reason")
    .fill("Browser manual grant verification");
  await page.getByLabel("Manual Pro duration in days").fill("14");
  await page
    .getByRole("button", { name: "Grant Pro manually", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db.user.findUniqueOrThrow({ where: { id: userId } }))
          .membershipPlan,
    )
    .toBe("pro");
  expect(await db.paymentReceipt.count({ where: { invoiceId } })).toBe(0);
  await page
    .getByLabel("GitHub account override (blank clears override)")
    .fill("7");
  await page
    .getByRole("button", { name: "Save entitlement overrides" })
    .click();
  await expect
    .poll(
      async () =>
        (await db.user.findUniqueOrThrow({ where: { id: userId } }))
          .githubLimitOverride,
    )
    .toBe(7);
  await page
    .getByLabel("GitHub account override (blank clears override)")
    .fill("");
  await page
    .getByRole("button", { name: "Save entitlement overrides" })
    .click();
  await expect
    .poll(
      async () =>
        (await db.user.findUniqueOrThrow({ where: { id: userId } }))
          .githubLimitOverride,
    )
    .toBeNull();
  await page
    .getByText("Plan settings and Stellar payments", { exact: true })
    .click();
  await page.getByLabel("Invoice expiry in minutes").fill("45");
  await page
    .getByLabel("Required plan change reason")
    .fill("Browser versioned settings verification");
  await page
    .getByRole("button", { name: "Save plan version", exact: true })
    .click();
  await expect(
    page.getByText("Plan version saved", { exact: true }),
  ).toBeVisible();
  expect(
    (await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).amount,
  ).toBe("5.0000000");
  await page.getByLabel("Payment status filter").selectOption("pending");
  await expect(
    page.getByText(`${email} · 5.0000000 USDC · testnet · pending`, {
      exact: true,
    }),
  ).toBeVisible();
});
