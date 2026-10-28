import { db } from "./db";
import { groups,monthStart,settings } from "./policy";
import { HttpError } from "./security";
export async function enqueue(
  userId: string,
  kind: string,
  key: string,
  payload: any,
) {
  return db.job.upsert({
    where: { key },
    create: { userId, kind, key, payload },
    update: {},
  });
}
export async function startRuns(userId: string, ids: string[]) {
  if (!ids.length || ids.length > 40)
    throw new HttpError(422, "Select between 1 and 40 issues");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const config = settings(u.settings);
    const count = await tx.run.count({
      where: { userId, createdAt: { gte: monthStart() } },
    });
    const issues = await tx.issue.findMany({
      where: {
        id: { in: ids },
        userId,
        state: "open",
        status: { in: ["ready", "failed"] },
      },
    });
    if (issues.length !== new Set(ids).size)
      throw new HttpError(
        409,
        "Some issues are unavailable or already have a run",
      );
    const priorRuns = await tx.run.findMany({
      where: {
        userId,
        status: {
          in: ["queued", "running", "awaiting_review", "published", "failed"],
        },
      },
    });
    const pendingJobs = await tx.job.findMany({
      where: { userId, kind: "run", status: { in: ["queued", "running"] } },
    });
    const pendingKeys = new Set(pendingJobs.map((j) => j.key));
    if (
      priorRuns.some(
        (r) =>
          (r.status !== "failed" || pendingKeys.has(`run:${r.id}`)) &&
          (r.issueIds as string[]).some((id) => ids.includes(id)),
      )
    )
      throw new HttpError(
        409,
        "Some issues already belong to an active run or retry",
      );
    const batches = groups(issues);
    if (
      count + batches.length >
      Math.min(config.monthlyJobs, Number(process.env.PLAN_MAX_JOBS || 50))
    )
      throw new HttpError(403, "Monthly job limit reached");
    const runs = [];
    for (const batch of batches) {
      const run = await tx.run.create({
        data: {
          userId,
          identityId: batch[0].identityId,
          repo: batch[0].repo,
          issueIds: batch.map((i) => i.id),
          title: batch.map((i) => `#${i.number} ${i.title}`).join(" · "),
          branch: `easysolve/${crypto.randomUUID()}`,
          mode: config.mode,
        },
      });
      await tx.issue.updateMany({
        where: { id: { in: batch.map((i) => i.id) }, userId },
        data: { status: "in_progress" },
      });
      await tx.job.create({
        data: {
          userId,
          kind: "run",
          key: `run:${run.id}`,
          payload: { runId: run.id },
        },
      });
      runs.push(run);
    }
    return runs;
  });
}
export async function claimJob() {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('easysolve:claim'))`;
    const active = await tx.job.count({
      where: { status: "running", leaseUntil: { gt: new Date() } },
    });
    if (active >= Number(process.env.WORKER_CONCURRENCY || 1)) return null;
    const jobs = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "Job" WHERE ((status='queued' AND "availableAt"<=NOW()) OR (status='running' AND "leaseUntil"<NOW())) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!jobs.length) return null;
    return tx.job.update({
      where: { id: jobs[0].id },
      data: {
        status: "running",
        attempts: { increment: 1 },
        leaseUntil: new Date(Date.now() + 120000),
      },
    });
  });
}

export async function approveRun(userId: string, runId: string, sha: string) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`run:${runId}`}))`;
    const run = await tx.run.findFirst({ where: { id: runId, userId } });
    if (
      !run ||
      run.mode === "plan" ||
      run.status !== "awaiting_review" ||
      run.headSha !== sha
    )
      throw new HttpError(409, "Patch changed or run is not awaiting review");
    await tx.run.update({
      where: { id: runId },
      data: { approvedSha: sha, error: null },
    });
    return tx.job.upsert({
      where: { key: `publish:${runId}` },
      create: {
        userId,
        kind: "publish",
        key: `publish:${runId}`,
        payload: { runId },
      },
      update: {
        status: "queued",
        attempts: 0,
        availableAt: new Date(),
        leaseUntil: null,
        error: null,
      },
    });
  });
}
