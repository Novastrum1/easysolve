import { releaseRun, reserveIssues } from "../entitlements";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "../db";
import { approveRun, startRuns } from "../queue";
import { HttpError } from "../security";
import type { RouteContext } from "./types";
const id = z.string().min(1).max(100);
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });
export async function handleRuns({
  request,
  path,
  body,
  url,
  u,
}: RouteContext) {
  const route = path.join("/");
  const method = request.method;
  if (route === "runs" && method === "POST")
    return json(
      await startRuns(u.id, z.array(id).min(1).max(40).parse(body.issueIds)),
    );
  if (path[0] === "runs" && path[1]) {
    const run = await db.run.findFirst({
      where: { id: path[1], userId: u.id },
    });
    if (!run) throw new HttpError(404, "Run not found");
    if (method === "GET") {
      const usage = await db.usage.aggregate({
        where: { userId: u.id, runId: run.id },
        _sum: { input: true, cached: true, output: true, total: true },
        _count: true,
      });
      return json({ ...run, usage });
    }
    if (path[2] === "cancel") {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${u.id}))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`run:${run.id}`}))`;
        const current = await tx.run.findUniqueOrThrow({
          where: { id: run.id },
        });
        if (
          !["queued", "running", "awaiting_review", "failed"].includes(
            current.status,
          )
        )
          throw new HttpError(409, "This run can no longer be cancelled");
        await releaseRun(run.id, tx);
        await tx.run.update({
          where: { id: run.id },
          data: { status: "cancelled", finishedAt: new Date() },
        });
        await tx.job.updateMany({
          where: {
            userId: u.id,
            key: { in: [`run:${run.id}`, `publish:${run.id}`] },
          },
          data: { status: "cancelled" },
        });
        await tx.issue.updateMany({
          where: { userId: u.id, id: { in: run.issueIds as string[] } },
          data: { status: "ready" },
        });
      });
      return json({ ok: true });
    }
    if (path[2] === "approve") {
      await approveRun(u.id, run.id, z.string().parse(body.sha));
      return json({ message: "Publication queued" });
    }
    if (path[2] === "retry" || path[2] === "changes") {
      if (!["failed", "awaiting_review", "cancelled"].includes(run.status))
        throw new HttpError(409, "Run cannot be retried in this state");
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${u.id}))`;
        if (run.mode !== "plan")
          await reserveIssues(tx, u.id, run.id, run.issueIds as string[]);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${u.id}))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`run:${run.id}`}))`;
        const current = await tx.run.findUniqueOrThrow({
          where: { id: run.id },
        });
        if (
          !["failed", "awaiting_review", "cancelled"].includes(current.status)
        )
          throw new HttpError(409, "Run changed during retry");
        const ids = run.issueIds as string[];
        if (run.mode !== "plan") await reserveIssues(tx, u.id, run.id, ids);
        const others = await tx.run.findMany({
          where: {
            userId: u.id,
            id: { not: run.id },
            status: {
              in: ["queued", "running", "awaiting_review", "published"],
            },
          },
        });
        if (
          others.some((r) =>
            (r.issueIds as string[]).some((i) => ids.includes(i)),
          )
        )
          throw new HttpError(409, "Another run already owns these issues");
        await tx.run.update({
          where: { id: run.id },
          data: {
            status: "queued",
            approvedSha: null,
            headSha: null,
            error: null,
            feedback: body.feedback
              ? z.string().max(10000).parse(body.feedback)
              : "",
          },
        });
        await tx.issue.updateMany({
          where: { userId: u.id, id: { in: ids } },
          data: { status: "in_progress" },
        });
        await tx.job.upsert({
          where: { key: `run:${run.id}` },
          create: {
            userId: u.id,
            key: `run:${run.id}`,
            kind: "run",
            payload: { runId: run.id },
          },
          update: {
            status: "queued",
            attempts: 0,
            availableAt: new Date(),
            leaseUntil: null,
          },
        });
      });
      return json({ ok: true });
    }
  }
  return undefined;
}
