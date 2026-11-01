import "../lib/load-env";
import { db } from "../lib/db";

const limit = Math.min(100, Math.max(1, Number(process.argv[2] || 20)));
const runs = await db.run.findMany({
  where: {
    status: {
      in: ["awaiting_review", "published", "completed", "failed", "blocked"],
    },
  },
  orderBy: { createdAt: "desc" },
  take: limit,
  select: {
    id: true,
    status: true,
    stage: true,
    createdAt: true,
    queueWaitMs: true,
    executionMs: true,
    validationMs: true,
    toolRounds: true,
    tokenBudget: true,
  },
});
const usage = await db.usage.groupBy({
  by: ["runId"],
  where: { runId: { in: runs.map((run) => run.id) } },
  _sum: { total: true },
});
const totals = new Map(usage.map((row) => [row.runId, row._sum.total ?? 0]));
const values = (key: "queueWaitMs" | "executionMs" | "validationMs") =>
  runs
    .map((run) => run[key])
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
const median = (items: number[]) =>
  items.length ? items[Math.floor((items.length - 1) / 2)] : null;
const report = {
  sampleSize: runs.length,
  measuredRuns: runs.map((run) => ({
    id: run.id,
    status: run.status,
    stage: run.stage,
    queueMs: run.queueWaitMs,
    executionMs: run.executionMs,
    validationMs: run.validationMs,
    toolRounds: run.toolRounds,
    actualTokens: totals.get(run.id) ?? 0,
    tokenBudget: run.tokenBudget,
  })),
  medianMs: {
    queue: median(values("queueWaitMs")),
    execution: median(values("executionMs")),
    validation: median(values("validationMs")),
  },
  slowestMs: {
    queue: values("queueWaitMs").at(-1) ?? null,
    execution: values("executionMs").at(-1) ?? null,
    validation: values("validationMs").at(-1) ?? null,
  },
};
console.log(JSON.stringify(report, null, 2));
await db.$disconnect();
