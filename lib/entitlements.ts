import { z } from "zod";
import type { Prisma, User } from "@prisma/client";
import { db } from "./db";
import { HttpError } from "./security";
export const planSettingsSchema = z
  .object({
    basicIssueLimit: z.number().int().min(0).max(100000).default(1),
    basicReset: z.enum(["none", "calendar_month"]).default("none"),
    basicResetConfirmed: z.boolean().default(false),
    basicGithubLimit: z.number().int().min(1).max(100).default(1),
    proUnlimited: z.boolean().default(false),
    proIssueLimit: z
      .number()
      .int()
      .min(0)
      .max(1000000)
      .nullable()
      .default(null),
    proReset: z.enum(["none", "calendar_month"]).default("none"),
    proGithubLimit: z.number().int().min(1).max(100).default(4),
    price: z
      .string()
      .regex(/^\d{1,9}(\.\d{1,7})?$/)
      .default("5.0000000"),
    billingType: z
      .enum(["unconfirmed", "one_time", "fixed_days"])
      .default("unconfirmed"),
    durationDays: z.number().int().min(1).max(36500).nullable().default(null),
    renewal: z
      .enum(["unconfirmed", "manual_extend", "manual_restart"])
      .default("unconfirmed"),
    downgrade: z
      .enum(["unconfirmed", "basic_keep_data"])
      .default("unconfirmed"),
    termsConfirmed: z.boolean().default(false),
    network: z.enum(["testnet", "mainnet"]).default("testnet"),
    receivingAddress: z.string().max(56).default(""),
    testnetReceivingAddress: z.string().max(56).default(""),
    mainnetReceivingAddress: z.string().max(56).default(""),
    checkoutEnabled: z.boolean().default(false),
    mainnetEnabled: z.boolean().default(false),
    invoiceMinutes: z.number().int().min(5).max(1440).default(30),
  })
  .strict();
export type PlanSettings = z.infer<typeof planSettingsSchema>;
export async function currentPlan(tx: Prisma.TransactionClient = db) {
  const row = await tx.planVersion.findFirst({ orderBy: { version: "desc" } });
  if (!row)
    throw new HttpError(
      503,
      "Plan settings are not installed. Apply database migrations.",
    );
  return { ...row, settings: planSettingsSchema.parse(row.settings) };
}
export function effectivePlan(u: User, s: PlanSettings, now = new Date()) {
  const pro =
    u.membershipPlan === "pro" &&
    (u.proLifetime || (!!u.proExpiresAt && u.proExpiresAt > now));
  const issueOverride =
    u.issueLimitOverride !== null &&
    (!u.issueOverrideExpiresAt || u.issueOverrideExpiresAt > now);
  const accountOverride =
    u.githubLimitOverride !== null &&
    (!u.githubOverrideExpiresAt || u.githubOverrideExpiresAt > now);
  const defaultIssueLimit = pro ? s.proIssueLimit : s.basicIssueLimit;
  const defaultGithubLimit = pro ? s.proGithubLimit : s.basicGithubLimit;
  const reset = pro
    ? s.proReset
    : s.basicResetConfirmed
      ? s.basicReset
      : "none";
  const start =
    reset === "calendar_month"
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      : new Date(0);
  return {
    code: pro ? "pro" : "basic",
    name: pro ? "EasySolve Pro" : "Basic",
    expiresAt: pro && !u.proLifetime ? u.proExpiresAt : null,
    unlimited: pro && s.proUnlimited && !issueOverride,
    issueLimit: issueOverride
      ? u.issueLimitOverride!
      : (defaultIssueLimit ?? 0),
    defaultIssueLimit,
    defaultUnlimited: pro && s.proUnlimited,
    githubLimit: accountOverride ? u.githubLimitOverride! : defaultGithubLimit,
    defaultGithubLimit,
    issueOverride: issueOverride ? u.issueLimitOverride : null,
    githubOverride: accountOverride ? u.githubLimitOverride : null,
    issueOverrideExpiresAt: u.issueOverrideExpiresAt,
    githubOverrideExpiresAt: u.githubOverrideExpiresAt,
    reset,
    windowStart: u.allowanceResetAt > start ? u.allowanceResetAt : start,
    proAllowanceConfigured: s.proUnlimited || s.proIssueLimit !== null,
  };
}
export async function entitlementSummary(
  userId: string,
  tx: Prisma.TransactionClient = db,
) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const plan = await currentPlan(tx);
  const effective = effectivePlan(user, plan.settings);
  const [successful, reserved, connected, usable] = await Promise.all([
    tx.solveClaim.count({
      where: {
        userId,
        status: "successful",
        succeededAt: { gte: effective.windowStart },
      },
    }),
    tx.solveClaim.count({ where: { userId, status: "reserved" } }),
    tx.identity.count({ where: { userId } }),
    tx.identity.count({ where: { userId, active: true, usable: true } }),
  ]);
  return {
    ...effective,
    successful,
    reserved,
    remaining: effective.unlimited
      ? null
      : Math.max(0, effective.issueLimit - successful - reserved),
    connected,
    usable,
    overLimit: connected > effective.githubLimit,
    selectionRequired: usable > effective.githubLimit,
    planVersion: plan.version,
  };
}
export async function reserveIssues(
  tx: Prisma.TransactionClient,
  userId: string,
  runId: string,
  ids: string[],
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.suspendedAt) throw new HttpError(403, "Account suspended");
  const summary = await entitlementSummary(userId, tx);
  const claims = await tx.solveClaim.findMany({
    where: { userId, issueId: { in: ids } },
  });
  if (claims.some((c) => c.status === "successful"))
    throw new HttpError(
      409,
      "An issue in this request has already been successfully solved.",
    );
  if (claims.some((c) => c.status === "reserved" && c.runId !== runId))
    throw new HttpError(409, "An issue is already reserved by another run.");
  const need = ids.filter(
    (id) =>
      !claims.some(
        (c) => c.issueId === id && c.status === "reserved" && c.runId === runId,
      ),
  );
  if (
    summary.remaining !== null &&
    (need.length > summary.remaining ||
      summary.successful + summary.reserved > summary.issueLimit)
  )
    throw new HttpError(
      403,
      `${summary.name} issue allowance reached (${summary.issueLimit} issues; ${summary.successful} solved, ${summary.reserved} reserved). Review your plan or ask the owner to adjust your allowance.`,
    );
  for (const issueId of need)
    await tx.solveClaim.upsert({
      where: { userId_issueId: { userId, issueId } },
      create: { userId, issueId, runId },
      update: { runId, status: "reserved", succeededAt: null },
    });
}
export async function reserveRun(userId: string, runId: string) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const run = await tx.run.findFirstOrThrow({ where: { id: runId, userId } });
    if (run.mode !== "plan")
      await reserveIssues(tx, userId, runId, run.issueIds as string[]);
  });
}
export async function releaseRun(
  runId: string,
  tx: Prisma.TransactionClient = db,
) {
  await tx.solveClaim.updateMany({
    where: { runId, status: "reserved" },
    data: { status: "released" },
  });
}
export async function creditMergedRun(userId: string, runId: string) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const run = await tx.run.findFirstOrThrow({ where: { id: runId, userId } });
    for (const issueId of run.issueIds as string[]) {
      const existing = await tx.solveClaim.findUnique({
        where: { userId_issueId: { userId, issueId } },
      });
      if (existing?.status === "successful") continue;
      await tx.solveClaim.upsert({
        where: { userId_issueId: { userId, issueId } },
        create: {
          userId,
          issueId,
          runId,
          status: "successful",
          succeededAt: new Date(),
        },
        update: { status: "successful", succeededAt: new Date() },
      });
    }
    await tx.run.update({
      where: { id: runId },
      data: { status: "completed", finishedAt: new Date() },
    });
  });
}
export async function assertIdentityAccess(userId: string, identityId: string) {
  const i = await db.identity.findFirst({
    where: { id: identityId, userId, active: true, usable: true },
  });
  if (!i)
    throw new HttpError(
      422,
      "Select an active GitHub identity that is usable under your plan",
    );
  const s = await entitlementSummary(userId);
  if (s.selectionRequired)
    throw new HttpError(
      403,
      "Your active GitHub identities exceed your plan. Select which accounts remain usable in Account.",
    );
  return i;
}
