import { releaseRun, reserveIssues } from "./entitlements";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { HttpError } from "./security";

// Only fixed, explicitly selected fields may be returned to the admin UI.
export const accountSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  suspendedAt: true,
  createdAt: true,
  planName: true,
  planMaxJobs: true,
  planMaxTokens: true,
} satisfies Prisma.UserSelect;

export function redactDiagnostic(value: string | null) {
  if (!value) return value;
  let text = value;
  for (const [name, secret] of Object.entries(process.env)) {
    if (
      /KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL/.test(name) &&
      secret &&
      secret.length >= 8
    )
      text = text.split(secret).join("[redacted]");
  }
  return text
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/Bearer\s+[^\s"<>]+/gi, "Bearer [redacted]")
    .slice(0, 10000);
}

export async function adminTransaction<T>(
  actorId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return db.$transaction(
    async (tx) => {
      // Serializes admin mutations with bootstrap, including suspension checks.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('easysolve:admin'))`;
      const actor = await tx.user.findUnique({ where: { id: actorId } });
      if (!actor || actor.role !== "ADMIN" || actor.suspendedAt)
        throw new HttpError(403, "Administrator access required");
      return operation(tx);
    },
    { timeout: 130000 },
  );
}

export class AdminBootstrapError extends Error {}

export async function bootstrapAdmin(selector: {
  email?: string;
  userId?: string;
}) {
  if (!!selector.email === !!selector.userId)
    throw new AdminBootstrapError("Specify exactly one --email or --user-id.");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('easysolve:admin'))`;
    if (
      (await tx.adminBootstrap.findUnique({ where: { id: "owner" } })) ||
      (await tx.user.count({ where: { role: "ADMIN" } }))
    )
      throw new AdminBootstrapError(
        "Owner bootstrap has already been used or an administrator already exists.",
      );
    const account = await tx.user.findUnique({
      where: selector.userId
        ? { id: selector.userId }
        : { email: selector.email!.trim().toLowerCase() },
    });
    if (!account)
      throw new AdminBootstrapError(
        "Existing account not found. Register normally before bootstrapping.",
      );
    if (account.suspendedAt)
      throw new AdminBootstrapError("Cannot bootstrap a suspended account.");
    await tx.user.update({
      where: { id: account.id },
      data: { role: "ADMIN" },
    });
    await tx.adminBootstrap.create({
      data: { id: "owner", userId: account.id },
    });
    await tx.adminAudit.create({
      data: {
        actorId: account.id,
        targetId: account.id,
        action: "owner.bootstrap",
        reason: "Trusted server operator promoted an existing account",
        oldValues: { role: "USER" },
        newValues: { role: "ADMIN" },
        details: { from: "USER", to: "ADMIN", source: "server-cli" },
      },
    });
    return account.id;
  });
}

export async function adminJobAction(
  tx: Prisma.TransactionClient,
  jobId: string,
  action: "cancel" | "retry",
) {
  const job = await tx.job.findUnique({
    where: { id: jobId },
    include: { user: true },
  });
  if (!job) throw new HttpError(404, "Job not found");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${job.userId}))`;
  const payload = job.payload as Record<string, unknown>;
  const runId = typeof payload?.runId === "string" ? payload.runId : null;
  if ((job.kind === "run" || job.kind === "publish") && !runId)
    throw new HttpError(409, "Job is missing its run reference");
  if (runId)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`run:${runId}`}))`;
  // Conditional update below also protects against a worker claiming this job.
  const current = await tx.job.findUniqueOrThrow({ where: { id: job.id } });
  const run = runId
    ? await tx.run.findFirst({ where: { id: runId, userId: job.userId } })
    : null;
  if (action === "cancel") {
    if (!["queued", "running", "failed"].includes(current.status))
      throw new HttpError(409, "Job cannot be cancelled in this state");
    if (
      run &&
      !["queued", "running", "failed", "awaiting_review"].includes(run.status)
    )
      throw new HttpError(409, "Run cannot be cancelled in this state");
    const updated = await tx.job.updateMany({
      where: { id: job.id, status: current.status, attempts: current.attempts },
      data: { status: "cancelled" },
    });
    if (!updated.count)
      throw new HttpError(409, "Job changed; refresh before trying again");
    if (run) {
      await releaseRun(run.id, tx);
      await tx.run.update({
        where: { id: run.id },
        data: {
          status: "cancelled",
          approvedSha: null,
          finishedAt: new Date(),
        },
      });
      await tx.job.updateMany({
        where: {
          userId: job.userId,
          key: { in: [`run:${run.id}`, `publish:${run.id}`] },
          status: { in: ["queued", "running", "failed"] },
        },
        data: { status: "cancelled" },
      });
      await tx.issue.updateMany({
        where: { userId: job.userId, id: { in: run.issueIds as string[] } },
        data: { status: "ready" },
      });
    }
  } else {
    if (job.user.suspendedAt)
      throw new HttpError(409, "Reactivate this account before retrying jobs");
    if (!["failed", "cancelled"].includes(current.status))
      throw new HttpError(409, "Only failed or cancelled jobs can be retried");
    if (current.leaseUntil && current.leaseUntil > new Date())
      throw new HttpError(
        409,
        "Wait for the previous worker lease to expire before retrying",
      );
    if (!["run", "publish", "sync", "repository_sync"].includes(job.kind))
      throw new HttpError(409, "Unsupported job kind");
    if (job.kind === "publish") {
      if (
        !run ||
        run.status !== "awaiting_review" ||
        !run.headSha ||
        run.approvedSha !== run.headSha ||
        run.mode === "plan"
      )
        throw new HttpError(
          409,
          "Publication needs the user's current patch approval",
        );
    } else if (job.kind === "run") {
      if (!run || !["failed", "cancelled"].includes(run.status))
        throw new HttpError(409, "Run cannot be retried in this state");
      const ids = run.issueIds as string[];
      if (run.mode !== "plan") await reserveIssues(tx, job.userId, run.id, ids);
      const others = await tx.run.findMany({
        where: {
          userId: job.userId,
          id: { not: run.id },
          status: { in: ["queued", "running", "awaiting_review", "published"] },
        },
      });
      if (
        others.some((r) =>
          (r.issueIds as string[]).some((id) => ids.includes(id)),
        )
      )
        throw new HttpError(409, "Another run already owns these issues");
      await tx.run.update({
        where: { id: run.id },
        data: {
          status: "queued",
          error: null,
          approvedSha: null,
          headSha: null,
          finishedAt: null,
        },
      });
      await tx.issue.updateMany({
        where: { userId: job.userId, id: { in: ids } },
        data: { status: "in_progress" },
      });
    }
    const updated = await tx.job.updateMany({
      where: { id: job.id, status: current.status, attempts: current.attempts },
      data: {
        status: "queued",
        attempts: 0,
        availableAt: new Date(),
        leaseUntil: null,
        error: null,
      },
    });
    if (!updated.count)
      throw new HttpError(409, "Job changed; refresh before trying again");
  }
  return {
    before: current.status,
    after: action === "cancel" ? "cancelled" : "queued",
    kind: job.kind,
  };
}
