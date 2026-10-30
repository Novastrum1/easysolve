import "dotenv/config";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { db } from "../lib/db";
import { ai } from "../lib/ai";
import { enqueue, startRuns } from "../lib/queue";
import { hash, requireAdmin, user } from "../lib/security";
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    responses = { create };
  },
}));

const ids: string[] = [];
let adminId = "",
  ordinaryId = "",
  otherId = "",
  jobId = "",
  runId = "";
let token = "";
const origin = "http://localhost:3000";
async function as(id: string) {
  token = `admin-test-${crypto.randomUUID()}`;
  await db.session.create({
    data: {
      id: hash(token),
      userId: id,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
}
async function call(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  requestOrigin = origin,
) {
  return api(
    new Request(`${origin}/api/${path}`, {
      method,
      headers: { Origin: requestOrigin, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split("/"),
  );
}
beforeAll(async () => {
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("OPENAI_API_KEY", "admin-test-private-provider-key");
  vi.mocked(cookies).mockImplementation(
    async () =>
      ({
        get: () => (token ? { value: token } : undefined),
        set: vi.fn(),
        delete: vi.fn(),
      }) as any,
  );
  for (const role of ["ADMIN", "USER", "USER"] as const) {
    ids.push(
      (
        await db.user.create({
          data: {
            email: `admin-test-${crypto.randomUUID()}@example.test`,
            name: "Admin test fixture",
            password: await bcrypt.hash("test-password-admin-123", 4),
            role,
          },
        })
      ).id,
    );
  }
  [adminId, ordinaryId, otherId] = ids;
  const run = await db.run.create({
    data: {
      userId: ordinaryId,
      identityId: "test-fixture",
      repo: "fixture/admin",
      issueIds: [],
      title: "Failed fixture",
      branch: `fixture/${crypto.randomUUID()}`,
      status: "failed",
    },
  });
  runId = run.id;
  jobId = (
    await db.job.create({
      data: {
        userId: ordinaryId,
        kind: "run",
        key: `run:${run.id}`,
        payload: { runId: run.id },
        status: "failed",
        error: "Failed with admin-test-private-provider-key",
      },
    })
  ).id;
});
afterAll(async () => {
  await db.adminAudit.deleteMany({ where: { actorId: { in: ids } } });
  await db.rateLimit.deleteMany({
    where: { OR: ids.map((id) => ({ key: { contains: id } })) },
  });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  vi.unstubAllEnvs();
  await db.$disconnect();
});

it("deletes ordinary users with confirmation, preserving payment receipts and an audit record", async () => {
  const target = await db.user.create({
    data: {
      email: `delete-test-${crypto.randomUUID()}@example.test`,
      name: "Deletion fixture",
      password: "unused",
    },
  });
  ids.push(target.id);
  const body = {
    email: target.email,
    reason: "Remove requested test workspace",
  };
  const path = `admin/users/${target.id}/delete`;
  token = "";
  expect((await call(path, body)).status).toBe(401);
  await as(ordinaryId);
  expect((await call(path, body)).status).toBe(403);
  await as(adminId);
  expect((await call(path, body, "POST", "https://evil.test")).status).toBe(
    403,
  );
  expect((await call(path, { ...body, reason: "" })).status).toBe(422);
  expect(
    (await call(path, { ...body, email: "wrong@example.test" })).status,
  ).toBe(422);
  const admin = await db.user.findUniqueOrThrow({ where: { id: adminId } });
  expect(
    (
      await call(`admin/users/${adminId}/delete`, {
        ...body,
        email: admin.email,
      })
    ).status,
  ).toBe(409);
  const active = await db.job.create({
    data: {
      userId: target.id,
      kind: "sync",
      key: `delete:${crypto.randomUUID()}`,
      payload: {},
      status: "running",
      leaseUntil: new Date(Date.now() + 60000),
    },
  });
  expect((await call(path, body)).status).toBe(409);
  await db.job.update({
    where: { id: active.id },
    data: { status: "cancelled" },
  });
  expect((await call(path, body)).status).toBe(409);
  await db.job.update({
    where: { id: active.id },
    data: { leaseUntil: new Date(0) },
  });
  await db.session.create({
    data: {
      id: hash(`delete-session-${target.id}`),
      userId: target.id,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await db.reset.create({
    data: {
      id: hash(`delete-reset-${target.id}`),
      userId: target.id,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await db.identity.create({
    data: {
      userId: target.id,
      login: "delete-fixture",
      token: "encrypted-fixture",
    },
  });
  await db.repository.create({
    data: {
      userId: target.id,
      identityId: "fixture",
      fullName: "fixture/delete",
    },
  });
  const plan = await db.planVersion.findFirstOrThrow();
  const invoice = await db.invoice.create({
    data: {
      userId: target.id,
      planVersionId: plan.id,
      network: "testnet",
      recipient: "fixture",
      assetCode: "USDC",
      issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "5.0000000",
      memo: crypto.randomUUID().replaceAll("-", "").slice(0, 26),
      terms: {},
      expiresAt: new Date(),
    },
  });
  const receipt = await db.paymentReceipt.create({
    data: {
      network: "testnet",
      operationId: crypto.randomUUID(),
      transactionHash: "fixture",
      invoiceId: invoice.id,
      recipient: "fixture",
      assetCode: "USDC",
      issuer: "fixture",
      amount: "5.0000000",
      ledger: 1,
      paidAt: new Date(),
      status: "verified",
      detail: "Deletion test",
    },
  });
  try {
    await db.entitlementGrant.create({
      data: {
        userId: target.id,
        invoiceId: invoice.id,
        source: "testnet_payment",
        reason: "Test receipt",
      },
    });
    expect((await call(path, body)).status).toBe(200);
    expect(await db.user.findUnique({ where: { id: target.id } })).toBeNull();
    for (const model of [
      db.session,
      db.reset,
      db.identity,
      db.repository,
      db.job,
      db.invoice,
      db.entitlementGrant,
    ] as any[])
      expect(await model.count({ where: { userId: target.id } })).toBe(0);
    expect(
      (await db.paymentReceipt.findUniqueOrThrow({ where: { id: receipt.id } }))
        .invoiceId,
    ).toBeNull();
    const audit = await db.adminAudit.findFirstOrThrow({
      where: { targetId: target.id, action: "account.delete" },
    });
    expect(audit.actorId).toBe(adminId);
    expect(audit.reason).toBe(body.reason);
    expect((await call(path, body)).status).toBe(404);
  } finally {
    await db.paymentReceipt.delete({ where: { id: receipt.id } });
  }
});

it("requires a live admin session for every admin API and the page's authorization helper", async () => {
  token = "";
  expect((await call("admin/overview")).status).toBe(401);
  await expect(requireAdmin()).rejects.toMatchObject({ status: 401 });
  await as(ordinaryId);
  // Provider-test permission is deliberately unrelated to site administration.
  vi.stubEnv("AI_ADMIN_USER_IDS", ordinaryId);
  for (const path of [
    "overview",
    "users",
    `users/${adminId}`,
    "jobs",
    `jobs/${jobId}`,
    "audit",
    "unknown",
  ]) {
    expect((await call(`admin/${path}`)).status, path).toBe(403);
  }
  for (const [path, body] of [
    [`users/${otherId}/status`, { suspended: true, reason: "not authorized" }],
    [
      `users/${ordinaryId}/plan`,
      { planName: "Free", planMaxJobs: 0, planMaxTokens: 0 },
    ],
    [`jobs/${jobId}/cancel`, {}],
    [`jobs/${jobId}/retry`, {}],
  ] as const)
    expect((await call(`admin/${path}`, body)).status).toBe(403);
  await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
  expect(await db.adminAudit.count({ where: { actorId: ordinaryId } })).toBe(0);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: otherId } })).suspendedAt,
  ).toBeNull();
  expect(
    (await db.job.findUniqueOrThrow({ where: { id: jobId } })).status,
  ).toBe("failed");
});

it("does not allow role or plan promotion through profile, settings, or signup", async () => {
  await as(ordinaryId);
  expect(
    (
      await call("profile", {
        name: "Fixture",
        role: "ADMIN",
        planMaxTokens: 2000000000,
      })
    ).status,
  ).toBe(200);
  expect(
    (await call("settings", { role: "ADMIN", planMaxTokens: 2000000000 }))
      .status,
  ).toBe(200);
  const current = await db.user.findUniqueOrThrow({
    where: { id: ordinaryId },
  });
  expect(current.role).toBe("USER");
  expect(current.planMaxTokens).toBeNull();
  const email = `admin-test-${crypto.randomUUID()}@example.test`;
  expect(
    (
      await call("auth/signup", {
        email,
        name: "Signup fixture",
        password: "fixture-password-123",
        role: "ADMIN",
      })
    ).status,
  ).toBe(200);
  const signup = await db.user.findUniqueOrThrow({ where: { email } });
  ids.push(signup.id);
  expect(signup.role).toBe("USER");
});

it("returns bounded account search/details and provider health without credentials", async () => {
  await as(adminId);
  expect((await requireAdmin()).id).toBe(adminId);
  const search = await (await call("admin/users")).json();
  expect(search.items.length).toBeLessThanOrEqual(20);
  const response = await api(
    new Request(`${origin}/api/admin/users?q=${ordinaryId}`),
    ["admin", "users"],
  );
  expect((await response.json()).items.map((u: any) => u.id)).toEqual([
    ordinaryId,
  ]);
  const detail = await (await call(`admin/users/${ordinaryId}`)).json();
  expect(detail.password).toBeUndefined();
  expect(detail.sessions).toBeUndefined();
  expect(detail._count.jobs).toBe(1);
  const health = await (await call("admin/overview")).json();
  expect(health.provider.configured).toBe(true);
  expect(JSON.stringify(health)).not.toContain(
    "admin-test-private-provider-key",
  );
  expect(health.provider.key).toBeUndefined();
  expect(health.provider.fingerprint).toBeUndefined();
  const inspection = await (await call(`admin/jobs/${jobId}`)).json();
  expect(inspection.error).toContain("[redacted]");
  expect(inspection.payload).toBeUndefined();
  expect(inspection.run.id).toBe(runId);
  const invalid = await api(new Request(`${origin}/api/admin/users?page=-1`), [
    "admin",
    "users",
  ]);
  expect(invalid.status).toBe(422);
});

it("enforces CSRF, strict fields, and method checks for admin mutations", async () => {
  await as(adminId);
  const path = `admin/users/${ordinaryId}/plan`;
  expect(
    (
      await call(
        path,
        { planName: "Test", planMaxJobs: 0, planMaxTokens: 0 },
        "POST",
        "https://evil.test",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await call(path, {
        planName: "Test",
        planMaxJobs: 0,
        planMaxTokens: 0,
        role: "ADMIN",
      })
    ).status,
  ).toBe(422);
  expect((await call(path, {}, "DELETE")).status).toBe(405);
  expect(
    (
      await call(`admin/users/${adminId}/status`, {
        suspended: true,
        reason: "self suspension",
      })
    ).status,
  ).toBe(409);
});

it("paginates matching users without overlap and handles empty searches", async () => {
  await as(adminId);
  const prefix = `pagination-${crypto.randomUUID()}`;
  const fixtures = await db.user.createManyAndReturn({
    data: Array.from({ length: 21 }, (_, i) => ({
      email: `${prefix}-${i}@example.test`,
      name: "Pagination fixture",
      password: "no-login-fixture",
    })),
    select: { id: true },
  });
  ids.push(...fixtures.map((u) => u.id));
  const fetchPage = async (page: number, q = prefix) =>
    (
      await api(new Request(`${origin}/api/admin/users?q=${q}&page=${page}`), [
        "admin",
        "users",
      ])
    ).json();
  const first = await fetchPage(1),
    second = await fetchPage(2);
  expect(first.total).toBe(21);
  expect(first.items).toHaveLength(20);
  expect(second.items).toHaveLength(1);
  expect(first.items.some((u: any) => u.id === second.items[0].id)).toBe(false);
  expect(
    (await fetchPage(1, "no-match-" + crypto.randomUUID())).items,
  ).toHaveLength(0);
});

it("persists audited plan limits and enforces them against AI and job admission", async () => {
  await as(adminId);
  expect(
    (
      await call(`admin/users/${ordinaryId}/plan`, {
        reason: "Pause fixture budgets",
        planName: "Paused",
        planMaxJobs: 0,
        planMaxTokens: 0,
      })
    ).status,
  ).toBe(200);
  await expect(ai(ordinaryId, "test", "hello", "reply")).rejects.toThrow(
    "Plan token allowance exhausted",
  );
  expect(create).not.toHaveBeenCalled();
  const issue = await db.issue.create({
    data: {
      userId: ordinaryId,
      identityId: "fixture",
      repo: "fixture/limits",
      number: 1,
      title: "Fixture",
      url: "https://example.test/issue",
    },
  });
  await expect(startRuns(ordinaryId, [issue.id])).rejects.toThrow(
    "Monthly job limit",
  );
  const audit = await db.adminAudit.findFirstOrThrow({
    where: { actorId: adminId, targetId: ordinaryId, action: "account.plan" },
  });
  expect(audit.details).toMatchObject({
    after: { planMaxTokens: 0, planMaxJobs: 0 },
  });
});

it("retries and cancels failed jobs with audit records and run state transitions", async () => {
  await as(adminId);
  expect((await call(`admin/jobs/${jobId}/retry`, {})).status).toBe(200);
  expect(
    (await db.run.findUniqueOrThrow({ where: { id: runId } })).status,
  ).toBe("queued");
  expect((await call(`admin/jobs/${jobId}/retry`, {})).status).toBe(409);
  expect((await call(`admin/jobs/${jobId}/cancel`, {})).status).toBe(200);
  expect(
    (await db.job.findUniqueOrThrow({ where: { id: jobId } })).status,
  ).toBe("cancelled");
  expect(
    (await db.run.findUniqueOrThrow({ where: { id: runId } })).status,
  ).toBe("cancelled");
  expect(
    await db.adminAudit.count({ where: { actorId: adminId, targetId: jobId } }),
  ).toBe(2);
  await db.job.update({
    where: { id: jobId },
    data: { leaseUntil: new Date(Date.now() + 60000) },
  });
  expect((await call(`admin/jobs/${jobId}/retry`, {})).status).toBe(409);
  await db.job.update({ where: { id: jobId }, data: { leaseUntil: null } });
  const publish = await db.job.create({
    data: {
      userId: ordinaryId,
      kind: "publish",
      key: `publish:${runId}`,
      payload: { runId },
      status: "failed",
    },
  });
  expect((await call(`admin/jobs/${publish.id}/retry`, {})).status).toBe(409);
});

it("suspends accounts, revokes sessions, blocks login/background work, and reactivates without restoring sessions", async () => {
  await as(ordinaryId);
  const oldToken = token;
  await db.job.update({ where: { id: jobId }, data: { status: "queued" } });
  await db.run.update({ where: { id: runId }, data: { status: "queued" } });
  await as(adminId);
  expect(
    (
      await call(`admin/users/${ordinaryId}/status`, {
        suspended: true,
        reason: "Suspension test",
      })
    ).status,
  ).toBe(200);
  expect(await db.session.count({ where: { userId: ordinaryId } })).toBe(0);
  expect(
    (await db.job.findUniqueOrThrow({ where: { id: jobId } })).status,
  ).toBe("cancelled");
  await expect(
    enqueue(ordinaryId, "sync", `fixture:${crypto.randomUUID()}`, {}),
  ).rejects.toThrow("suspended");
  await expect(ai(ordinaryId, "test", "hello", "reply")).rejects.toMatchObject({
    status: 403,
  });
  const suspended = await db.user.findUniqueOrThrow({
    where: { id: ordinaryId },
  });
  expect(
    (
      await call("auth/login", {
        email: suspended.email,
        password: "test-password-admin-123",
      })
    ).status,
  ).toBe(403);
  token = oldToken;
  await expect(user()).rejects.toMatchObject({ status: 401 });
  // Even a still-existing session cannot authenticate a suspended account.
  await as(ordinaryId);
  await expect(user()).rejects.toMatchObject({ status: 403 });
  await as(adminId);
  expect((await call(`admin/jobs/${jobId}/retry`, {})).status).toBe(409);
  expect(
    (
      await call(`admin/users/${ordinaryId}/status`, {
        suspended: false,
        reason: "Reactivation test",
      })
    ).status,
  ).toBe(200);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: ordinaryId } }))
      .suspendedAt,
  ).toBeNull();
  token = oldToken;
  await expect(user()).rejects.toMatchObject({ status: 401 });
  await as(adminId);
  const entries = await (await call("admin/audit")).json();
  expect(entries.items.length).toBeLessThanOrEqual(20);
  expect(
    entries.items.some((a: any) => a.action === "account.reactivate"),
  ).toBe(true);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: otherId } })).role,
  ).toBe("USER");
});
