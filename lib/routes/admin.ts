import { entitlementSummary, releaseRun } from "../entitlements";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  accountSelect,
  adminJobAction,
  adminTransaction,
  redactDiagnostic,
} from "../admin";
import { db } from "../db";
import { monthStart, planLimits, settings } from "../policy";
import { providerStatus } from "../provider-status";
import { HttpError, requireAdmin } from "../security";
import type { RouteContext } from "./types";

const id = z.string().min(1).max(100);
const json = (data: unknown) =>
  NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
const jobSelect = {
  id: true,
  userId: true,
  kind: true,
  status: true,
  attempts: true,
  availableAt: true,
  leaseUntil: true,
  error: true,
  createdAt: true,
  updatedAt: true,
} as const;
function pagination(url: URL) {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(1000000)
    .parse(url.searchParams.get("page") || 1);
  return { page, take: 20, skip: (page - 1) * 20 };
}

export async function handleAdmin({ request, path, body, url }: RouteContext) {
  if (path[0] !== "admin") return;
  // Do not trust client state, environment provider allowlists, or the route context role.
  const actor = await requireAdmin();
  const route = path.slice(1).join("/");
  const { page, take, skip } = pagination(url);
  if (request.method === "GET") {
    if (route === "overview") {
      const [
        users,
        suspended,
        repositories,
        runs,
        jobs,
        usage,
        monthUsage,
        providerUsage,
        recentRepositories,
      ] = await Promise.all([
        db.user.count(),
        db.user.count({ where: { suspendedAt: { not: null } } }),
        db.repository.count(),
        db.run.count(),
        db.job.groupBy({ by: ["status"], _count: true }),
        db.usage.aggregate({
          _sum: {
            input: true,
            cached: true,
            output: true,
            reasoning: true,
            total: true,
          },
          _count: true,
        }),
        db.usage.aggregate({
          where: { createdAt: { gte: monthStart() } },
          _sum: { total: true },
          _count: true,
        }),
        db.usage.groupBy({
          by: ["provider", "model"],
          _sum: { total: true },
          _count: true,
        }),
        db.repository.findMany({
          take: 10,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            userId: true,
            fullName: true,
            health: true,
            createdAt: true,
          },
        }),
      ]);
      let provider;
      try {
        provider = await providerStatus();
      } catch {
        provider = {
          configured: false,
          verified: false,
          error:
            "Provider configuration or health is unavailable. Check server configuration.",
        };
      }
      const activePro = await db.user.count({
        where: {
          membershipPlan: "pro",
          OR: [{ proLifetime: true }, { proExpiresAt: { gt: new Date() } }],
        },
      });
      const successfulSolves = await db.solveClaim.count({
        where: { status: "successful" },
      });
      const paymentGroups = await db.paymentReceipt.groupBy({
        by: ["network", "status"],
        _count: true,
      });
      const invoiceGroups = await db.invoice.groupBy({
        by: ["status"],
        _count: true,
      });
      const revenueReceipts = await db.paymentReceipt.findMany({
        where: { network: "mainnet", status: "verified" },
        select: { amount: true },
      });
      const verifiedRevenueUnits = revenueReceipts.reduce(
        (n, r) => n + BigInt(r.amount.replace(".", "")),
        0n,
      );
      return json({
        basicUsers: users - activePro,
        activePro,
        successfulSolves,
        paymentGroups,
        invoiceGroups,
        verifiedRevenue: `${verifiedRevenueUnits / 10000000n}.${String(verifiedRevenueUnits % 10000000n).padStart(7, "0")}`,
        users,
        workspaces: users,
        suspended,
        repositories,
        runs,
        jobs,
        usage,
        monthUsage,
        providerUsage,
        recentRepositories,
        provider,
      });
    }
    if (route === "users") {
      const q = z
        .string()
        .max(254)
        .parse(url.searchParams.get("q") || "");
      const where = q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" as const } },
              { name: { contains: q, mode: "insensitive" as const } },
              { id: q },
            ],
          }
        : {};
      const [items, total] = await Promise.all([
        db.user.findMany({
          where,
          select: accountSelect,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take,
          skip,
        }),
        db.user.count({ where }),
      ]);
      return json({ items, total, page, pageSize: take });
    }
    if (path[1] === "users" && path.length === 3) {
      const account = await db.user.findUnique({
        where: { id: id.parse(path[2]) },
        select: {
          ...accountSelect,
          settings: true,
          _count: {
            select: {
              repos: true,
              issues: true,
              runs: true,
              jobs: true,
              identities: true,
              sessions: true,
            },
          },
        },
      });
      if (!account) throw new HttpError(404, "Account not found");
      const [usage, repositories] = await Promise.all([
        db.usage.aggregate({
          where: { userId: account.id, createdAt: { gte: monthStart() } },
          _sum: { total: true, input: true, output: true },
          _count: true,
        }),
        db.repository.findMany({
          where: { userId: account.id },
          take: 20,
          orderBy: { createdAt: "desc" },
          select: { id: true, fullName: true, health: true },
        }),
      ]);
      return json({
        entitlements: await entitlementSummary(account.id),
        membership: await db.user.findUnique({
          where: { id: account.id },
          select: {
            membershipPlan: true,
            proLifetime: true,
            proExpiresAt: true,
          },
        }),
        payments: await db.invoice.findMany({
          where: { userId: account.id },
          take: 30,
          orderBy: { createdAt: "desc" },
          include: { payments: true },
        }),
        grants: await db.entitlementGrant.findMany({
          where: { userId: account.id },
          take: 30,
          orderBy: { createdAt: "desc" },
        }),
        ...account,
        settings: settings(account.settings),
        limits: planLimits(account),
        usage,
        repositories,
      });
    }
    if (route === "jobs") {
      const status = z
        .enum(["queued", "running", "failed", "completed", "cancelled"])
        .optional()
        .parse(url.searchParams.get("status") || undefined);
      const where = status ? { status } : {};
      const [items, total] = await Promise.all([
        db.job.findMany({
          where,
          select: jobSelect,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take,
          skip,
        }),
        db.job.count({ where }),
      ]);
      return json({
        items: items.map((j) => ({ ...j, error: redactDiagnostic(j.error) })),
        total,
        page,
        pageSize: take,
      });
    }
    if (path[1] === "jobs" && path.length === 3) {
      const job = await db.job.findUnique({
        where: { id: id.parse(path[2]) },
        select: { ...jobSelect, payload: true },
      });
      if (!job) throw new HttpError(404, "Job not found");
      const payload = job.payload as Record<string, unknown>;
      const run =
        typeof payload?.runId === "string"
          ? await db.run.findFirst({
              where: { id: payload.runId, userId: job.userId },
              select: {
                id: true,
                repo: true,
                status: true,
                error: true,
                attempts: true,
                startedAt: true,
                finishedAt: true,
              },
            })
          : null;
      const { payload: _, ...safeJob } = job;
      return json({
        ...safeJob,
        error: redactDiagnostic(job.error),
        run: run && { ...run, error: redactDiagnostic(run.error) },
      });
    }
    if (route === "audit") {
      const [items, total] = await Promise.all([
        db.adminAudit.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take,
          skip,
        }),
        db.adminAudit.count(),
      ]);
      return json({ items, total, page, pageSize: take });
    }
    throw new HttpError(404, "Admin endpoint not found");
  }
  if (request.method !== "POST")
    throw new HttpError(405, "Use POST for admin changes");
  if (path[1] === "users" && path.length === 4) {
    const targetId = id.parse(path[2]);
    if (path[3] === "status") {
      const input = z
        .object({
          suspended: z.boolean(),
          reason: z.string().trim().min(3).max(500),
        })
        .strict()
        .parse(body);
      await adminTransaction(actor.id, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${targetId}))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`usage:${targetId}`}))`;
        const target = await tx.user.findUnique({
          where: { id: targetId },
          select: accountSelect,
        });
        if (!target) throw new HttpError(404, "Account not found");
        if (target.role === "ADMIN")
          throw new HttpError(
            409,
            "Administrator accounts cannot be suspended here",
          );
        await tx.user.update({
          where: { id: targetId },
          data: { suspendedAt: input.suspended ? new Date() : null },
        });
        if (input.suspended) {
          await tx.session.deleteMany({ where: { userId: targetId } });
          await tx.reset.deleteMany({ where: { userId: targetId } });
          const runs = await tx.run.findMany({
            where: {
              userId: targetId,
              status: {
                in: ["queued", "running", "awaiting_review", "failed"],
              },
            },
            select: { id: true, issueIds: true },
          });
          for (const run of runs) {
            await releaseRun(run.id, tx);
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`run:${run.id}`}))`;
            // Publishing holds this lock; never rewrite a run that published while waiting.
            const cancelled = await tx.run.updateMany({
              where: {
                id: run.id,
                status: {
                  in: ["queued", "running", "awaiting_review", "failed"],
                },
              },
              data: {
                status: "cancelled",
                approvedSha: null,
                finishedAt: new Date(),
              },
            });
            if (cancelled.count)
              await tx.issue.updateMany({
                where: {
                  userId: targetId,
                  id: { in: run.issueIds as string[] },
                },
                data: { status: "ready" },
              });
          }
          await tx.job.updateMany({
            where: { userId: targetId, status: { in: ["queued", "running"] } },
            data: { status: "cancelled" },
          });
        }
        await tx.adminAudit.create({
          data: {
            actorId: actor.id,
            targetId,
            action: input.suspended ? "account.suspend" : "account.reactivate",
            reason: input.reason,
            oldValues: { suspended: !!target.suspendedAt },
            newValues: { suspended: input.suspended },
            details: {
              reason: redactDiagnostic(input.reason),
              previouslySuspended: !!target.suspendedAt,
            },
          },
        });
      });
      return json({ ok: true });
    }
    if (path[3] === "plan") {
      const input = z
        .object({
          reason: z.string().trim().min(3).max(1000),
          planName: z.string().trim().min(1).max(80).nullable(),
          planMaxJobs: z.number().int().min(0).max(100000).nullable(),
          planMaxTokens: z.number().int().min(0).max(2000000000).nullable(),
        })
        .strict()
        .parse(body);
      await adminTransaction(actor.id, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${targetId}))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`usage:${targetId}`}))`;
        const before = await tx.user.findUnique({
          where: { id: targetId },
          select: { planName: true, planMaxJobs: true, planMaxTokens: true },
        });
        if (!before) throw new HttpError(404, "Account not found");
        const { reason: _, ...changes } = input;
        await tx.user.update({ where: { id: targetId }, data: changes });
        await tx.adminAudit.create({
          data: {
            actorId: actor.id,
            targetId,
            action: "account.plan",
            reason: input.reason,
            oldValues: before,
            newValues: {
              planName: input.planName,
              planMaxJobs: input.planMaxJobs,
              planMaxTokens: input.planMaxTokens,
            },
            details: { before, after: input },
          },
        });
      });
      return json({ ok: true });
    }
  }
  if (
    path[1] === "jobs" &&
    path.length === 4 &&
    ["cancel", "retry"].includes(path[3])
  ) {
    const targetId = id.parse(path[2]);
    z.object({}).strict().parse(body);
    await adminTransaction(actor.id, async (tx) => {
      const details = await adminJobAction(
        tx,
        targetId,
        path[3] as "cancel" | "retry",
      );
      await tx.adminAudit.create({
        data: {
          actorId: actor.id,
          targetId,
          action: `job.${path[3]}`,
          reason: `Administrator requested job ${path[3]}`,
          oldValues: { status: details.before },
          newValues: { status: details.after },
          details,
        },
      });
    });
    return json({ ok: true });
  }
  throw new HttpError(404, "Admin endpoint not found");
}
