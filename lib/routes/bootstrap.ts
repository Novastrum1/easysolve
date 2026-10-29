import { entitlementSummary } from "../entitlements";
import { NextResponse } from "next/server";
import { z } from "zod";
import { providerStatus, isProviderAdmin } from "../provider-status";
import { db } from "../db";
import {
  allowanceWindow,
  monthStart,
  nextMonth,
  settings,
  planLimits,
} from "../policy";
import type { RouteContext } from "./types";
const id = z.string().min(1).max(100);
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });
export async function handleBootstrap({
  request,
  path,
  body,
  url,
  u,
}: RouteContext) {
  const route = path.join("/");
  const method = request.method;
  if (route === "bootstrap") {
    const [
      identities,
      repositories,
      issues,
      runs,
      messages,
      usage,
      applications,
      proposals,
      jobs,
    ] = await Promise.all([
      db.identity.findMany({
        where: { userId: u.id },
        select: {
          id: true,
          login: true,
          active: true,
          usable: true,
          status: true,
          syncedAt: true,
        },
      }),
      db.repository.findMany({ where: { userId: u.id } }),
      db.issue.findMany({
        where: { userId: u.id },
        orderBy: { createdAt: "desc" },
      }),
      db.run.findMany({
        where: { userId: u.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          repo: true,
          title: true,
          status: true,
          branch: true,
          prUrl: true,
          prNumber: true,
          createdAt: true,
          startedAt: true,
          finishedAt: true,
          mode: true,
          error: true,
        },
      }),
      db.message.findMany({
        where: { userId: u.id },
        orderBy: { createdAt: "asc" },
      }),
      db.usage.findMany({
        where: { userId: u.id, createdAt: { gte: monthStart() } },
        orderBy: { createdAt: "desc" },
      }),
      db.application.findMany({
        where: { userId: u.id },
        orderBy: { createdAt: "desc" },
      }),
      db.proposal.findMany({
        where: { userId: u.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      db.job.findMany({
        where: {
          userId: u.id,
          status: { in: ["queued", "running", "failed"] },
        },
        select: {
          id: true,
          kind: true,
          status: true,
          error: true,
          availableAt: true,
        },
      }),
    ]);
    const window = allowanceWindow(settings(u.settings));
    const cycleUsage = await db.usage.aggregate({
      where: { userId: u.id, createdAt: { gte: window.start } },
      _sum: { total: true },
    });
    const provider = await providerStatus();
    const entitlements = await entitlementSummary(u.id);
    return json({
      allowance: {
        start: window.start,
        reset: window.reset,
        total: cycleUsage._sum.total ?? 0,
      },
      user: {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        providerAdmin: isProviderAdmin(u.id),
      },
      identities,
      repositories,
      issues,
      runs,
      messages,
      usage,
      applications,
      proposals,
      jobs,
      settings: settings(u.settings),
      health: {
        ai: provider.configured,
        provider,
        encryption: !!process.env.TOKEN_ENCRYPTION_KEY,
      },
      limits: {
        jobs: planLimits(u).jobs,
        tokens: planLimits(u).tokens,
        reset: nextMonth(),
      },
      plan: entitlements.name,
      entitlements,
    });
  }
  return undefined;
}
