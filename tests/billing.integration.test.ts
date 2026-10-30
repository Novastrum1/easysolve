import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
const cookie = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookie.token ? { value: cookie.token } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));
import { db } from "../lib/db";
import { api } from "../lib/api";
import { hash } from "../lib/security";
import { startRuns } from "../lib/queue";
import { executeRun } from "../worker/agent";
import {
  reserveRun,
  releaseRun,
  creditMergedRun,
  entitlementSummary,
  planSettingsSchema,
  currentPlan,
  assertIdentityAccess,
} from "../lib/entitlements";
import {
  connectGithubAccount,
  chooseGithubAccounts,
} from "../lib/github-accounts";
import {
  createInvoice,
  verifyTransaction,
  reconcilePayments,
  submitTransaction,
  activateInvoice,
  checkoutBlockers,
} from "../lib/billing";
import { STELLAR } from "../lib/stellar";
import bcrypt from "bcryptjs";
let owner = "",
  basic = "",
  other = "",
  originalSettings: any,
  ownedBootstrap = false;
const actors: string[] = [];
const operationIds: string[] = [];
const address = "GBT7S5S4TZ7GZEAM5NP7A5M2EZYL2IHWTWNU6T7V5AYGCGIPEUPWKUOY";
const password = "billing-fixture-password";
const mockData = new Map<string, any>();
let serial = 0;
const fetchMock = vi.fn(async (input: any, options: any) => {
  expect(options?.method ?? "GET").toBe("GET");
  const url = String(input);
  if (url.endsWith("/"))
    return Response.json({
      network_passphrase: url.startsWith(STELLAR.testnet.horizon)
        ? STELLAR.testnet.passphrase
        : STELLAR.mainnet.passphrase,
    });
  if (url.includes("/accounts/") && !url.includes("/payments")) {
    const network = url.startsWith(STELLAR.mainnet.horizon)
      ? "mainnet"
      : "testnet";
    return Response.json({
      balances: [
        {
          asset_code: "USDC",
          asset_issuer: STELLAR[network].issuer,
          balance: "0.0000000",
          limit: "1000000.0000000",
          is_authorized: true,
        },
      ],
    });
  }
  return Response.json(mockData.get(url) ?? {}, {
    status: mockData.has(url) ? 200 : 404,
  });
});
async function user(role: "USER" | "ADMIN" = "USER") {
  const u = await db.user.create({
    data: {
      email: `billing-${crypto.randomUUID()}@example.test`,
      name: "Billing fixture",
      password: await bcrypt.hash(password, 4),
      role,
    },
  });
  actors.push(u.id);
  return u.id;
}
async function login(id: string) {
  cookie.token = crypto.randomUUID();
  await db.session.create({
    data: {
      id: hash(cookie.token),
      userId: id,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
}
async function call(
  path: string,
  body?: any,
  method = body === undefined ? "GET" : "POST",
) {
  return api(
    new Request(`http://localhost/api/${path}`, {
      method,
      headers: {
        Origin: process.env.APP_URL || "http://localhost",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    path.split("/"),
  );
}
async function plan(changes: any = {}) {
  const p = await currentPlan();
  return db.planVersion.create({
    data: {
      actorId: owner,
      version: p.version + 1,
      settings: { ...p.settings, ...changes },
    },
  });
}
async function issue(userId: string) {
  return db.issue.create({
    data: {
      userId,
      identityId: "fixture",
      repo: "billing/project",
      number: ++serial,
      title: "Fix issue",
      url: "https://example.test/issue",
    },
  });
}
function transaction(invoice: any, overrides: any = {}) {
  const txHash = crypto.randomUUID().replaceAll("-", "").repeat(2),
    operationId = String(Date.now()) + String(++serial).padStart(5, "0");
  operationIds.push(operationId);
  const tx = {
    hash: txHash,
    successful: true,
    ledger: 42,
    memo_type: "text",
    memo: invoice.memo,
    ...overrides.tx,
  };
  const op = {
    id: operationId,
    paging_token: operationId,
    type: "payment",
    to: invoice.recipient,
    from: STELLAR.testnet.issuer,
    transaction_successful: true,
    transaction_hash: txHash,
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: invoice.issuer,
    amount: invoice.amount,
    ...overrides.op,
  };
  const root = STELLAR[invoice.network as "testnet" | "mainnet"].horizon;
  mockData.set(`${root}/transactions/${txHash}`, tx);
  mockData.set(`${root}/ledgers/42`, {
    sequence: 42,
    closed_at: new Date(invoice.createdAt.getTime() + 1000).toISOString(),
    ...overrides.ledger,
  });
  mockData.set(`${root}/transactions/${txHash}/payments?limit=200&order=asc`, {
    _embedded: { records: [op] },
  });
  return { hash: txHash, op };
}
beforeAll(async () => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  owner = await user("ADMIN");
  basic = await user();
  other = await user();
  originalSettings = (await currentPlan()).settings;
  const bootstrap = await db.adminBootstrap.findUnique({
    where: { id: "owner" },
  });
  if (bootstrap)
    throw Error("Use a dedicated empty billing test database for owner tests");
  await db.adminBootstrap.create({ data: { id: "owner", userId: owner } });
  ownedBootstrap = true;
  vi.stubGlobal("fetch", fetchMock);
  await plan({
    basicIssueLimit: 1,
    basicReset: "none",
    basicResetConfirmed: true,
    proUnlimited: true,
    proGithubLimit: 4,
    termsConfirmed: true,
    billingType: "fixed_days",
    durationDays: 14,
    renewal: "manual_extend",
    downgrade: "basic_keep_data",
    network: "testnet",
    receivingAddress: address,
    testnetReceivingAddress: address,
    mainnetReceivingAddress: address,
    checkoutEnabled: true,
    mainnetEnabled: false,
    price: "5.0000000",
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  cookie.token = "";
  await db.paymentReceipt.deleteMany({
    where: { operationId: { in: operationIds } },
  });
  await db.adminAudit.deleteMany({ where: { actorId: { in: actors } } });
  await db.user.deleteMany({ where: { id: { in: actors } } });
  if (ownedBootstrap)
    await db.adminBootstrap.delete({ where: { id: "owner" } });
  await db.paymentCursor.deleteMany({ where: { recipient: address } });
  await db.planVersion.deleteMany({ where: { actorId: owner } });
  await db.$disconnect();
  vi.unstubAllEnvs();
});
it("denies every new admin API to ordinary users and prevents privilege/entitlement escalation", async () => {
  await login(basic);
  for (const path of [
    "admin/plans",
    "admin/payments",
    "admin/overview",
    "admin/audit",
    "admin/users",
    "admin/jobs",
  ]) {
    expect((await call(path)).status).toBe(403);
  }
  for (const [path, body] of [
    ["admin/plans", { settings: {} }],
    [
      `admin/entitlements/${basic}`,
      { action: "grant", lifetime: true, reason: "escalate" },
    ],
    ["admin/wallet/validate", { network: "testnet", address }],
    ["admin/payments/recheck", { invoiceId: "foreign", reason: "attempt" }],
    ["admin/refunds/foreign", { status: "resolved", reason: "attempt" }],
  ] as const)
    expect((await call(path, body)).status).toBe(403);
  await call("settings", {
    role: "ADMIN",
    membershipPlan: "pro",
    issueLimitOverride: 999,
  });
  const current = await db.user.findUniqueOrThrow({ where: { id: basic } });
  expect(current.role).toBe("USER");
  expect(current.membershipPlan).toBe("basic");
  expect(current.issueLimitOverride).toBeNull();
});
it("reserves Basic allowance atomically per individual issue across API and concurrent batches", async () => {
  const a = await issue(basic),
    b = await issue(basic);
  await login(basic);
  expect((await call("runs", { issueIds: [a.id, b.id] })).status).toBe(403);
  expect(await db.run.count({ where: { userId: basic } })).toBe(0);
  const attempts = await Promise.allSettled([
    startRuns(basic, [a.id]),
    startRuns(basic, [b.id]),
  ]);
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  const run = await db.run.findFirstOrThrow({ where: { userId: basic } });
  expect((await entitlementSummary(basic)).reserved).toBe(1);
  expect((await call("runs", { issueIds: [a.id, b.id] })).status).toBe(409);
  await call(`runs/${run.id}/cancel`, {});
  expect((await entitlementSummary(basic)).remaining).toBe(1);
  const otherIssue =
    run.issueIds instanceof Array && run.issueIds.includes(a.id) ? b : a;
  const [retry] = await startRuns(basic, [otherIssue.id]);
  await releaseRun(retry.id);
  await db.run.update({ where: { id: retry.id }, data: { status: "failed" } });
  expect((await entitlementSummary(basic)).remaining).toBe(1);
  await reserveRun(basic, retry.id);
  await creditMergedRun(basic, retry.id);
  const at = (
    await db.solveClaim.findFirstOrThrow({ where: { runId: retry.id } })
  ).succeededAt;
  await creditMergedRun(basic, retry.id);
  expect(
    (await db.solveClaim.findFirstOrThrow({ where: { runId: retry.id } }))
      .succeededAt,
  ).toEqual(at);
  expect((await entitlementSummary(basic)).remaining).toBe(0);
  const fresh = await issue(basic);
  expect((await call("runs", { issueIds: [fresh.id] })).status).toBe(403);
  const bypass = await db.run.create({
    data: {
      userId: basic,
      identityId: "fixture",
      repo: "billing/project",
      issueIds: [fresh.id],
      title: "Bypass",
      branch: crypto.randomUUID(),
    },
  });
  await expect(reserveRun(basic, bypass.id)).rejects.toMatchObject({
    status: 403,
  });
  await expect(executeRun(basic, bypass.id)).rejects.toMatchObject({
    status: 403,
  });
  expect(
    (await db.run.findUniqueOrThrow({ where: { id: bypass.id } })).status,
  ).toBe("failed");
  const preview = await db.message.create({
    data: {
      userId: basic,
      role: "assistant",
      content: "Confirm solve",
      activity: [
        {
          type: "confirmation",
          action: "start_run",
          ids: [fresh.id],
          label: "Start selected coding runs",
        },
      ],
    },
  });
  expect((await call("chat/confirm", { messageId: preview.id })).status).toBe(
    403,
  );
});
it("enforces four distinct Pro accounts under concurrent connections and replacement tokens", async () => {
  await db.user.update({
    where: { id: other },
    data: {
      membershipPlan: "pro",
      proExpiresAt: new Date(Date.now() + 86400000),
    },
  });
  const attempts = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      connectGithubAccount(
        other,
        { id: 100 + i, login: `fixture-${i}` },
        `private-fixture-token-${i}`,
      ),
    ),
  );
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(4);
  expect(await db.identity.count({ where: { userId: other } })).toBe(4);
  const identity = await db.identity.findFirstOrThrow({
    where: { userId: other },
  });
  await connectGithubAccount(
    other,
    { id: identity.githubAccountId!, login: identity.login },
    "replacement-private-fixture",
  );
  expect(await db.identity.count({ where: { userId: other } })).toBe(4);
  await db.identity.update({
    where: { id: identity.id },
    data: { active: false, usable: false },
  });
  await expect(
    connectGithubAccount(
      other,
      { id: 999, login: "new-identity" },
      "private-fixture-new-token",
    ),
  ).rejects.toMatchObject({ status: 403 });
  await db.user.update({
    where: { id: other },
    data: { proExpiresAt: new Date(Date.now() - 1000) },
  });
  expect((await entitlementSummary(other)).githubLimit).toBe(1);
  expect((await entitlementSummary(other)).overLimit).toBe(true);
  expect(await db.identity.count({ where: { userId: other } })).toBe(4);
  await chooseGithubAccounts(other, [identity.id]);
  await expect(assertIdentityAccess(other, identity.id)).resolves.toMatchObject(
    { id: identity.id },
  );
  await db.user.update({
    where: { id: other },
    data: {
      githubLimitOverride: 8,
      githubOverrideExpiresAt: new Date(Date.now() + 10000),
    },
  });
  expect((await entitlementSummary(other)).githubLimit).toBe(8);
  await db.user.update({
    where: { id: other },
    data: { githubOverrideExpiresAt: new Date(Date.now() - 1) },
  });
  expect((await entitlementSummary(other)).githubLimit).toBe(1);
});
it("requires owner reauthentication for destination changes and audits manual grants without receipts", async () => {
  await login(owner);
  const p = await currentPlan();
  const modified = {
    ...p.settings,
    testnetReceivingAddress: STELLAR.testnet.issuer,
  };
  expect(
    (
      await call("admin/plans", {
        settings: modified,
        reason: "Wallet replacement",
      })
    ).status,
  ).toBe(403);
  const before = await db.paymentReceipt.count();
  expect(
    (
      await call(`admin/entitlements/${basic}`, {
        action: "grant",
        days: 14,
        reason: "Support accommodation",
      })
    ).status,
  ).toBe(200);
  expect(await db.paymentReceipt.count()).toBe(before);
  expect(
    await db.entitlementGrant.findFirst({
      where: { userId: basic, source: "manual" },
    }),
  ).not.toBeNull();
  expect(
    (
      await call(`admin/entitlements/${basic}`, {
        action: "limits",
        githubLimit: 7,
        issueLimit: 3,
        reason: "Individual entitlement override",
      })
    ).status,
  ).toBe(200);
  expect((await entitlementSummary(basic)).githubLimit).toBe(7);
  expect(
    (
      await call(`admin/entitlements/${basic}`, {
        action: "limits",
        githubLimit: null,
        issueLimit: null,
        reason: "Return to plan defaults",
      })
    ).status,
  ).toBe(200);
  expect((await entitlementSummary(basic)).githubOverride).toBeNull();
  expect(
    (
      await call(`admin/entitlements/${basic}`, {
        action: "reset",
        reason: "Explicit allowance reset",
      })
    ).status,
  ).toBe(200);
  expect(
    await db.adminAudit.count({
      where: { targetId: basic, reason: { not: "" } },
    }),
  ).toBeGreaterThan(2);
});
it("owns invoices by session and snapshots versions; no hash submission alone grants access", async () => {
  const purchaser = await user();
  await login(purchaser);
  const response = await call("billing/invoices", {});
  expect(response.status).toBe(200);
  const i = await response.json();
  expect(i.userId).toBe(purchaser);
  expect(i.amount).toBe("5.0000000");
  expect(Buffer.byteLength(i.memo)).toBeLessThanOrEqual(28);
  await login(other);
  expect((await call(`billing/invoices/${i.id}`)).status).toBe(404);
  expect(
    (
      await call(`billing/invoices/${i.id}/submit`, {
        transactionHash: "a".repeat(64),
      })
    ).status,
  ).toBe(404);
  await login(purchaser);
  expect(
    (
      await call(`billing/invoices/${i.id}/submit`, {
        transactionHash: "a".repeat(64),
      })
    ).status,
  ).toBe(200);
  expect((await entitlementSummary(purchaser)).code).toBe("basic");
  await plan({
    price: "6.0000000",
    receivingAddress: STELLAR.testnet.issuer,
    testnetReceivingAddress: STELLAR.testnet.issuer,
  });
  const original = await db.invoice.findUniqueOrThrow({ where: { id: i.id } });
  expect(original.amount).toBe("5.0000000");
  expect(original.recipient).toBe(address);
  await plan({
    price: "5.0000000",
    receivingAddress: address,
    testnetReceivingAddress: address,
  });
});
it("verifies and activates testnet Pro exactly once under concurrent replay and extends by 14 days", async () => {
  const purchaser = await user();
  const invoice = await createInvoice(purchaser);
  const t = transaction(invoice);
  await Promise.all([
    verifyTransaction("testnet", t.hash, invoice.id),
    verifyTransaction("testnet", t.hash, invoice.id),
  ]);
  expect(
    await db.entitlementGrant.count({ where: { invoiceId: invoice.id } }),
  ).toBe(1);
  expect((await entitlementSummary(purchaser)).code).toBe("pro");
  const first = (await db.user.findUniqueOrThrow({ where: { id: purchaser } }))
    .proExpiresAt!;
  await verifyTransaction("testnet", t.hash, invoice.id);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: purchaser } }))
      .proExpiresAt,
  ).toEqual(first);
  const second = await createInvoice(purchaser);
  const next = transaction(second);
  await verifyTransaction("testnet", next.hash, second.id);
  expect(
    (
      await db.user.findUniqueOrThrow({ where: { id: purchaser } })
    ).proExpiresAt!.getTime(),
  ).toBe(first.getTime() + 14 * 86400000);
  const foreign = await createInvoice(other);
  await verifyTransaction("testnet", t.hash, foreign.id);
  expect(
    await db.entitlementGrant.count({ where: { invoiceId: foreign.id } }),
  ).toBe(0);
});
it("rejects wrong networks, failed transactions, under/overpayments, wrong destination/issuer/memo and late payments", async () => {
  const purchaser = await user();
  for (const changes of [
    { tx: { successful: false } },
    { op: { amount: "4.0000000" } },
    { op: { amount: "6.0000000" } },
    { op: { to: STELLAR.testnet.issuer } },
    { op: { asset_issuer: STELLAR.mainnet.issuer } },
    { tx: { memo: undefined } },
    { ledger: { closed_at: new Date(Date.now() + 3600000).toISOString() } },
  ]) {
    const invoice = await createInvoice(purchaser);
    const t = transaction(invoice, changes);
    try {
      await verifyTransaction("testnet", t.hash, invoice.id);
    } catch (error) {
      expect((error as any).status).toBe(422);
    }
    expect(
      await db.entitlementGrant.count({ where: { invoiceId: invoice.id } }),
    ).toBe(0);
  }
  const invoice = await createInvoice(purchaser);
  const t = transaction(invoice);
  await expect(
    verifyTransaction("mainnet", t.hash, invoice.id),
  ).rejects.toBeDefined();
  expect((await entitlementSummary(purchaser)).code).toBe("basic");
});
it("recovers watcher processing after a restart without duplicating payment activation", async () => {
  await db.paymentSubmission.deleteMany({});
  const purchaser = await user();
  const invoice = await createInvoice(purchaser);
  const t = transaction(invoice);
  const cursor = await db.paymentCursor.findUniqueOrThrow({
    where: { id: `testnet:${address}` },
  });
  const url = `${STELLAR.testnet.horizon}/accounts/${address}/payments?cursor=${cursor.cursor}&order=asc&limit=20`;
  mockData.set(url, { _embedded: { records: [t.op] } });
  await db.paymentCursor.update({
    where: { id: cursor.id },
    data: { availableAt: new Date(0) },
  });
  await reconcilePayments();
  expect(
    (await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } }))
      .entitlementState,
  ).toBe("activated");
  expect(
    (await db.paymentCursor.findUniqueOrThrow({ where: { id: cursor.id } }))
      .cursor,
  ).toBe(t.op.paging_token);
  // Simulate a process dying after receipt commit but before cursor commit.
  await db.paymentCursor.update({
    where: { id: cursor.id },
    data: { cursor: cursor.cursor, availableAt: new Date(0) },
  });
  await reconcilePayments();
  expect(
    await db.entitlementGrant.count({ where: { invoiceId: invoice.id } }),
  ).toBe(1);
});

it("bounds failed verification retries and leaves entitlements pending", async () => {
  const purchaser = await user(),
    invoice = await createInvoice(purchaser);
  await db.paymentSubmission.deleteMany({});
  await db.paymentCursor.updateMany({
    data: { availableAt: new Date(Date.now() + 86400000) },
  });
  const submission = await submitTransaction(
    purchaser,
    invoice.id,
    "f".repeat(64),
  );
  for (let n = 0; n < 5; n++) {
    await db.paymentSubmission.update({
      where: { id: submission.id },
      data: { availableAt: new Date(0) },
    });
    await reconcilePayments();
  }
  expect(
    await db.paymentSubmission.findUnique({ where: { id: submission.id } }),
  ).toMatchObject({ status: "failed_verification", attempts: 5 });
  expect(
    await db.invoice.findUnique({ where: { id: invoice.id } }),
  ).toMatchObject({
    status: "failed_verification",
    entitlementState: "pending",
  });
  expect(
    await db.entitlementGrant.count({ where: { invoiceId: invoice.id } }),
  ).toBe(0);
});

it("requires a verified receipt for activation and rejects issued invoice/plan term mutations", async () => {
  const purchaser = await user(),
    invoice = await createInvoice(purchaser);
  await expect(
    db.$transaction((tx) => activateInvoice(tx, invoice.id)),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    db.invoice.update({
      where: { id: invoice.id },
      data: { amount: "6.0000000" },
    }),
  ).rejects.toThrow("immutable");
  const p = await currentPlan();
  await expect(
    db.planVersion.update({
      where: { id: p.id },
      data: { settings: { ...p.settings, price: "1.0000000" } },
    }),
  ).rejects.toThrow();
  expect(
    (await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).amount,
  ).toBe("5.0000000");
});
it("requires the mainnet server gate and verifies a mainnet ledger fixture exactly once", async () => {
  vi.stubEnv("STELLAR_MAINNET_ACTIVATION", "false");
  const p = await currentPlan();
  expect(
    checkoutBlockers({
      ...p.settings,
      network: "mainnet",
      mainnetEnabled: true,
      checkoutEnabled: true,
    }),
  ).toContain(
    "Mainnet requires explicit owner activation and server activation",
  );
  vi.stubEnv("STELLAR_MAINNET_ACTIVATION", "true");
  await plan({
    network: "mainnet",
    mainnetEnabled: true,
    checkoutEnabled: true,
    receivingAddress: address,
  });
  const purchaser = await user(),
    invoice = await createInvoice(purchaser);
  expect(invoice.issuer).toBe(STELLAR.mainnet.issuer);
  const t = transaction(invoice);
  await Promise.all([
    verifyTransaction("mainnet", t.hash, invoice.id),
    verifyTransaction("mainnet", t.hash, invoice.id),
  ]);
  expect(
    await db.entitlementGrant.count({
      where: { invoiceId: invoice.id, source: "verified_payment" },
    }),
  ).toBe(1);
  expect(
    (await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } }))
      .entitlementState,
  ).toBe("activated");
  await login(purchaser);
  expect(
    (
      await call(`billing/invoices/${invoice.id}/refund`, {
        reason: "Fixture refund review",
      })
    ).status,
  ).toBe(200);
  await login(owner);
  expect(
    (
      await call(`admin/refunds/${invoice.id}`, {
        status: "resolved",
        reason: "Documented off-platform resolution; no automated transfer",
      })
    ).status,
  ).toBe(200);
  expect(
    await db.entitlementGrant.count({ where: { invoiceId: invoice.id } }),
  ).toBe(1);
  await plan({ network: "testnet", mainnetEnabled: false });
  vi.unstubAllEnvs();
});
