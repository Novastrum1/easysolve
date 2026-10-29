import { entitlementSummary } from "../lib/entitlements";
import { reconcilePayments } from "../lib/billing";
import "../lib/load-env";
import { AIProviderError } from "../lib/providers/openai";
import { AllowanceError } from "../lib/ai";
import { db } from "../lib/db";
import { syncIssues, syncRepositoryStats } from "../lib/github";
import { settings } from "../lib/policy";
import { claimJob, enqueue } from "../lib/queue";
import { executeRun, publish } from "./agent";
import { recordProviderRuntime } from "../lib/provider-runtime";
let stopped = false;
process.on("SIGTERM", () => (stopped = true));
process.on("SIGINT", () => (stopped = true));
async function tick() {
  await reconcilePayments();
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.reset.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.rateLimit.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const identities = await db.identity.findMany({
    where: {
      active: true,
      usable: true,
      user: { suspendedAt: null },
      OR: [
        { syncedAt: null },
        { syncedAt: { lt: new Date(Date.now() - 15 * 60000) } },
      ],
    },
    include: { user: true },
  });
  for (const i of identities)
    if (
      settings(i.user.settings).autosync &&
      !(await entitlementSummary(i.userId)).selectionRequired
    )
      await enqueue(
        i.userId,
        "sync",
        `sync:${i.id}:${Math.floor(Date.now() / 900000)}`,
        { identityId: i.id },
      );
  const repositories = await db.repository.findMany({
    where: { user: { suspendedAt: null } },
    include: { user: true },
  });
  for (const r of repositories)
    if (
      settings(r.user.settings).autosync &&
      (await db.identity.count({
        where: {
          id: r.identityId,
          userId: r.userId,
          active: true,
          usable: true,
        },
      })) &&
      !(await entitlementSummary(r.userId)).selectionRequired
    )
      await enqueue(
        r.userId,
        "repository_sync",
        `repo-sync:${r.id}:${Math.floor(Date.now() / 900000)}`,
        { repositoryId: r.id },
      );
}
async function main() {
  await recordProviderRuntime("worker");
  let last = 0;
  console.log(
    "EasySolve worker online; PostgreSQL durable queue, concurrency=1",
  );
  while (!stopped) {
    try {
      if (Date.now() - last > 60000) {
        await tick();
        last = Date.now();
      }
      const job = await claimJob();
      if (!job) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const heartbeat = setInterval(() => {
        void db.job
          .updateMany({
            where: { id: job.id, status: "running", attempts: job.attempts },
            data: { leaseUntil: new Date(Date.now() + 120000) },
          })
          .catch(() => {});
      }, 30000);
      try {
        const account = await db.user.findUniqueOrThrow({
          where: { id: job.userId },
        });
        if (account.suspendedAt) throw new Error("Account suspended");
        const p = job.payload as {
          runId: string;
          identityId: string;
          repositoryId: string;
        };
        if (job.kind === "run") await executeRun(job.userId, p.runId);
        else if (job.kind === "publish") await publish(job.userId, p.runId);
        else if (job.kind === "repository_sync")
          await syncRepositoryStats(job.userId, p.repositoryId);
        else if (job.kind === "sync")
          await syncIssues(job.userId, p.identityId);
        else throw Error("Unknown job kind");
        await db.job.updateMany({
          where: { id: job.id, status: "running", attempts: job.attempts },
          data: { status: "completed", leaseUntil: null, error: null },
        });
      } catch (e) {
        const current = await db.job.findUnique({ where: { id: job.id } });
        if (current?.status !== "running" || current.attempts !== job.attempts)
          continue;
        const allowance = e instanceof AllowanceError;
        await db.job.updateMany({
          where: { id: job.id, status: "running", attempts: job.attempts },
          data: {
            status:
              allowance ||
              ((!(e instanceof AIProviderError) || e.retryable) &&
                job.attempts < 3)
                ? "queued"
                : "failed",
            leaseUntil: null,
            availableAt: allowance
              ? e.reset
              : new Date(Date.now() + job.attempts * 30000),
            error: allowance
              ? "Allowance exhausted"
              : e instanceof Error
                ? e.message.slice(0, 2000)
                : "Job failed",
          },
        });
        if (allowance && job.kind === "run")
          await db.run.updateMany({
            where: {
              id: (job.payload as any).runId,
              userId: job.userId,
              status: { not: "cancelled" },
            },
            data: { status: "queued", error: "Waiting for allowance reset" },
          });
        if (job.kind === "publish")
          await db.run.updateMany({
            where: {
              id: (job.payload as { runId: string }).runId,
              userId: job.userId,
              status: "awaiting_review",
            },
            data: {
              error:
                e instanceof Error
                  ? e.message.slice(0, 2000)
                  : "Publication failed",
            },
          });
        console.error(
          "Job did not complete",
          job.id,
          allowance
            ? "allowance exhausted"
            : e instanceof Error
              ? e.message.slice(0, 500)
              : "failure",
        );
      } finally {
        clearInterval(heartbeat);
      }
    } catch {
      console.error("Worker database unavailable; retrying in 5 seconds");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await db.$disconnect();
}
void main();
