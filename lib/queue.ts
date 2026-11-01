import { entitlementSummary, reserveIssues } from "./entitlements";
import { db } from "./db";
import { monthStart, settings, planLimits } from "./policy";
import { HttpError } from "./security";

export type RunSelectionOptions = {
  grouped?: boolean;
  requireWorker?: boolean;
};

type SelectionIssue = {
  id: string;
  identityId: string;
  repo: string;
  number: number;
  title: string;
  status: string;
  state: string;
  assignees: unknown;
};

export type RunSelectionPreview = {
  selected: string[];
  eligible: SelectionIssue[];
  skipped: { id: string; reason: string }[];
  groups: string[][];
  grouped: boolean;
  allowance: { available: number | null; requested: number; limit: number };
  repositories: string[];
  identities: string[];
  estimated: { seconds: null; tokens: null };
  worker: { available: boolean; reason?: string };
  sandbox: { available: boolean; reason?: string };
};

function assignedToIssue(issue: SelectionIssue, login: string) {
  const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
  return (
    assignees.length === 0 ||
    assignees.some(
      (value) => String(value).toLowerCase() === login.toLowerCase(),
    )
  );
}

function compatibleGroups(issues: SelectionIssue[]) {
  const map = new Map<string, SelectionIssue[]>();
  for (const issue of issues) {
    const key = issue.repo + ":" + issue.identityId;
    const same = map.get(key) ?? [];
    same.push(issue);
    map.set(key, same);
  }
  return [...map.values()].flatMap((items) =>
    Array.from({ length: Math.ceil(items.length / 4) }, (_, index) =>
      items.slice(index * 4, index * 4 + 4),
    ),
  );
}

async function selectionPreview(
  tx: any,
  userId: string,
  ids: string[],
  options: RunSelectionOptions = {},
): Promise<RunSelectionPreview> {
  const unique = [...new Set(ids)];
  const account = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if (account.suspendedAt) throw new HttpError(403, "Account suspended");
  const config = settings(account.settings);
  const identityIds = [
    ...new Set(
      (
        await tx.issue.findMany({
          where: { id: { in: unique }, userId },
          select: { identityId: true },
        })
      ).map((i: { identityId: string }) => i.identityId),
    ),
  ];
  const identities = await tx.identity.findMany({
    where: { userId, id: { in: identityIds } },
    select: { id: true, login: true, active: true, usable: true },
  });
  const byIdentity = new Map<string, any>(
    identities.map((i: any) => [i.id, i]),
  );
  const issues = await tx.issue.findMany({
    where: { id: { in: unique }, userId },
    select: {
      id: true,
      identityId: true,
      repo: true,
      number: true,
      title: true,
      status: true,
      state: true,
      assignees: true,
    },
  });
  if (issues.length !== unique.length)
    throw new HttpError(
      409,
      "Some selected issues are unavailable or not in this workspace",
    );
  const activeRuns = await tx.run.findMany({
    where: {
      userId,
      status: { in: ["queued", "running", "awaiting_review", "published"] },
    },
    select: { issueIds: true },
  });
  const owned = new Set(activeRuns.flatMap((r: any) => r.issueIds as string[]));
  const eligible: SelectionIssue[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const issue of issues as SelectionIssue[]) {
    if (owned.has(issue.id)) {
      skipped.push({ id: issue.id, reason: "Already has an active run" });
      continue;
    }
    if (issue.state !== "open" || !["ready", "failed"].includes(issue.status)) {
      skipped.push({
        id: issue.id,
        reason: `Issue is ${issue.state}/${issue.status}`,
      });
      continue;
    }
    const identity = byIdentity.get(issue.identityId);
    if (!identity?.active || !identity.usable) {
      skipped.push({
        id: issue.id,
        reason: "Required GitHub identity is unavailable",
      });
      continue;
    }
    if (!assignedToIssue(issue, identity.login)) {
      skipped.push({
        id: issue.id,
        reason: `GitHub identity @${identity.login} is not assigned`,
      });
      continue;
    }
    eligible.push(issue);
  }
  const plan = await entitlementSummary(userId, tx);
  const groupsToRun = options.grouped
    ? compatibleGroups(eligible)
    : eligible.map((i) => [i]);
  const requested = groupsToRun.length;
  const monthly = await tx.run.count({
    where: { userId, createdAt: { gte: monthStart() } },
  });
  const available = plan.unlimited
    ? null
    : Math.max(
        0,
        Math.min(
          plan.issueLimit - plan.successful - plan.reserved,
          planLimits(account).jobs - monthly,
        ),
      );
  if (available !== null && eligible.length > available)
    skipped.push(
      ...eligible.slice(available).map((i) => ({
        id: i.id,
        reason: "Plan allowance or monthly job limit reached",
      })),
    );
  const allowed = available === null ? eligible : eligible.slice(0, available);
  const allowedGroups = options.grouped
    ? compatibleGroups(allowed)
    : allowed.map((i) => [i]);
  return {
    selected: unique,
    eligible: allowed,
    skipped,
    groups: allowedGroups.map((g) => g.map((i) => i.id)),
    grouped: !!options.grouped,
    allowance: { available, requested, limit: plan.issueLimit },
    repositories: [...new Set(allowed.map((i) => i.repo))],
    identities: [
      ...new Set(
        allowed.map((i) => byIdentity.get(i.identityId)?.login ?? "unknown"),
      ),
    ],
    estimated: {
      seconds: null,
      tokens: null,
    },
    worker:
      process.env.WORKER_DISABLED === "true"
        ? { available: false, reason: "Worker execution is disabled" }
        : { available: true },
    sandbox:
      process.env.SANDBOX_DISABLED === "true"
        ? { available: false, reason: "Sandbox execution is disabled" }
        : { available: true },
  };
}

async function workerAvailable(tx: any) {
  if (process.env.WORKER_DISABLED === "true") return false;
  const row = await tx.workerHeartbeat.findFirst({
    where: { lastSeen: { gt: new Date(Date.now() - 90000) } },
    select: { id: true },
  });
  return !!row;
}

export async function previewRuns(
  userId: string,
  ids: string[],
  options: RunSelectionOptions = {},
) {
  if (!ids.length || ids.length > 40)
    throw new HttpError(422, "Select between 1 and 40 issues");
  return db.$transaction(async (tx) => {
    const result = await selectionPreview(tx, userId, ids, options);
    if (!(await workerAvailable(tx)))
      result.worker = {
        available: false,
        reason:
          "No healthy production worker heartbeat is available. Try again shortly.",
      };
    return result;
  });
}

export async function startRunsDetailed(
  userId: string,
  ids: string[],
  options: RunSelectionOptions = {},
) {
  const preview = await selectionPreview(db, userId, ids, options);
  if (options.requireWorker && !(await workerAvailable(db)))
    throw new HttpError(
      503,
      "No healthy production worker heartbeat is available. Try again shortly.",
    );
  if (!preview.worker.available || !preview.sandbox.available)
    throw new HttpError(
      503,
      preview.worker.reason ??
        preview.sandbox.reason ??
        "Execution unavailable",
    );
  if (!preview.eligible.length) return { runs: [], skipped: preview.skipped };
  const config = settings(
    (
      await db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { settings: true },
      })
    ).settings,
  );
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const current = await selectionPreview(
      tx,
      userId,
      preview.eligible.map((i) => i.id),
      options,
    );
    const runs = [];
    for (const batchIds of current.groups) {
      const batch = current.eligible.filter((i) => batchIds.includes(i.id));
      const run = await tx.run.create({
        data: {
          userId,
          identityId: batch[0].identityId,
          repo: batch[0].repo,
          issueIds: batch.map((i) => i.id),
          title: batch.map((i) => `#${i.number} ${i.title}`).join(" · "),
          branch: `fix/${crypto.randomUUID()}`,
          mode: config.mode,
          stage: "queued",
          maxRepairAttempts: config.maxRepairAttempts,
        },
      });
      if (run.mode !== "plan")
        await reserveIssues(
          tx,
          userId,
          run.id,
          batch.map((i) => i.id),
        );
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
    return { runs, skipped: current.skipped };
  });
}
export async function enqueue(
  userId: string,
  kind: string,
  key: string,
  payload: any,
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const account = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (account.suspendedAt) throw new HttpError(403, "Account suspended");
    return tx.job.upsert({
      where: { key },
      create: { userId, kind, key, payload },
      update: {},
    });
  });
}
export async function startRuns(
  userId: string,
  ids: string[],
  options: RunSelectionOptions = {},
) {
  if (!ids.length || ids.length > 40)
    throw new HttpError(422, "Select between 1 and 40 issues");
  const result = await startRunsDetailed(userId, ids, options);
  return result.runs;
  /* return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (u.suspendedAt) throw new HttpError(403, "Account suspended");
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
      Math.min(config.monthlyJobs, planLimits(u).jobs)
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
          branch: `fix/${crypto.randomUUID()}`,
          mode: config.mode,
          stage: "queued",
          maxRepairAttempts: config.maxRepairAttempts,
        },
      });
      if (run.mode !== "plan")
        await reserveIssues(
          tx,
          userId,
          run.id,
          batch.map((i) => i.id),
        );
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
  }); */
}
export async function claimJob() {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('easysolve:claim'))`;
    const globalLimit = Math.min(
      50,
      Math.max(1, Number(process.env.WORKER_CONCURRENCY || 10)),
    );
    const accountLimit = Math.min(
      20,
    // One active job per account keeps shared AI/GitHub limits coordinated.
    // Owners can raise this deliberately when their upstream limits allow it.
    Math.max(1, Number(process.env.WORKER_ACCOUNT_CONCURRENCY || 1)),
    );
    const active = await tx.job.count({
      where: { status: "running", leaseUntil: { gt: new Date() } },
    });
    if (active >= globalLimit) return null;
    const jobs = await tx.$queryRaw<{ id: string }[]>`SELECT j.id
       FROM "Job" j
       JOIN "User" u ON u.id=j."userId"
       WHERE u."suspendedAt" IS NULL
         AND ((j.status='queued' AND j."availableAt"<=NOW()) OR (j.status='running' AND j."leaseUntil"<NOW()))
         AND (
           SELECT COUNT(*)
           FROM "Job" active_job
           WHERE active_job."userId" = j."userId"
             AND active_job.status = 'running'
             AND active_job."leaseUntil" > NOW()
         ) < ${accountLimit}
       AND (
         j."kind" <> 'run' OR NOT EXISTS (
           SELECT 1
           FROM "Job" earlier_run
           WHERE earlier_run."userId" = j."userId"
             AND earlier_run."kind" = 'run'
             AND earlier_run.status IN ('queued', 'running')
             AND earlier_run."createdAt" < j."createdAt"
         )
       )
       ORDER BY j."createdAt"
       FOR UPDATE OF j SKIP LOCKED
       LIMIT 1`;
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
      data: {
        approvedSha: sha,
        error: null,
        stage: "publishing",
        lastProgressAt: new Date(),
      },
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
