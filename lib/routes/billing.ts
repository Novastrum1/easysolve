import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { db } from "../db";
import { adminTransaction, accountSelect } from "../admin";
import {
  currentPlan,
  entitlementSummary,
  planSettingsSchema,
} from "../entitlements";
import {
  billingSummary,
  checkoutBlockers,
  createInvoice,
  reconcilePayments,
  submitTransaction,
} from "../billing";
import {
  paymentUri,
  stellarNetwork,
  STELLAR,
  validateReceiver,
  publicAddress,
  amountUnits,
} from "../stellar";
import { HttpError, rateLimit, requireAdmin } from "../security";
import type { RouteContext } from "./types";
const json = (data: unknown) =>
  NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
const reason = z.string().trim().min(3).max(1000);
const id = z.string().min(1).max(100);
async function owner(actorId: string) {
  const bootstrap = await db.adminBootstrap.findUnique({
    where: { id: "owner" },
  });
  if (bootstrap?.userId !== actorId)
    throw new HttpError(
      403,
      "Only the bootstrapped owner may change payment destinations or activate mainnet",
    );
}
export async function handleBilling({
  request,
  path,
  body,
  u,
  url,
}: RouteContext) {
  const route = path.join("/");
  const method = request.method;
  if (route === "billing" && method === "GET")
    return json({
      ...(await billingSummary(u.id)),
      entitlements: await entitlementSummary(u.id),
    });
  if (route === "billing/invoices" && method === "POST") {
    await rateLimit(`invoice:${u.id}`, 5, 3600);
    return json(await createInvoice(u.id));
  }
  if (path[0] === "billing" && path[1] === "invoices" && path[2]) {
    const invoice = await db.invoice.findFirst({
      where: { id: id.parse(path[2]), userId: u.id },
      include: {
        payments: true,
        submissions: { select: { status: true, error: true, attempts: true } },
        grants: true,
      },
    });
    if (!invoice) throw new HttpError(404, "Invoice not found");
    if (method === "GET")
      return json({
        ...invoice,
        paymentUri: paymentUri(invoice),
        qr: await QRCode.toDataURL(paymentUri(invoice)),
        transactionBase: `${STELLAR[stellarNetwork(invoice.network)].explorer}/tx/`,
      });
    if (path[3] === "submit" && method === "POST") {
      await rateLimit(`payment-submit:${u.id}`, 5, 3600);
      const s = await submitTransaction(
        u.id,
        invoice.id,
        z
          .string()
          .regex(/^[a-fA-F0-9]{64}$/)
          .parse(body.transactionHash),
      );
      return json({
        id: s.id,
        status: s.status,
        message:
          "Queued for independent server verification. A transaction hash alone never grants Pro.",
      });
    }
    if (path[3] === "refund" && method === "POST") {
      const input = z.object({ reason }).strict().parse(body);
      await db.invoice.update({
        where: { id: invoice.id },
        data: { refundRequestedAt: new Date(), refundStatus: "requested" },
      });
      await db.adminAudit.create({
        data: {
          actorId: u.id,
          targetId: invoice.id,
          action: "refund.request",
          reason: input.reason,
          details: { userId: u.id },
        },
      });
      return json({
        status: "requested",
        message: "Owner review required; no funds transferred",
      });
    }
  }
  const ownAdmin =
    path[0] === "admin" &&
    ["plans", "payments", "wallet", "entitlements", "refunds"].includes(
      path[1],
    );
  if (!ownAdmin) return;
  const actor = await requireAdmin();
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .parse(url.searchParams.get("page") || 1);
  const take = 20,
    skip = (page - 1) * take;
  if (route === "admin/plans" && method === "GET") {
    const p = await currentPlan();
    return json({
      ...p,
      blockers: checkoutBlockers(p.settings),
      isOwner:
        (await db.adminBootstrap.findUnique({ where: { id: "owner" } }))
          ?.userId === actor.id,
      versions: await db.planVersion.findMany({
        orderBy: { version: "desc" },
        take: 20,
      }),
    });
  }
  if (route === "admin/plans" && method === "POST") {
    const input = z
      .object({
        settings: planSettingsSchema,
        reason,
        password: z.string().optional(),
      })
      .strict()
      .parse(body);
    input.settings.receivingAddress =
      input.settings.network === "testnet"
        ? input.settings.testnetReceivingAddress
        : input.settings.mainnetReceivingAddress;
    const old = await currentPlan();
    const sensitive =
      old.settings.receivingAddress !== input.settings.receivingAddress ||
      old.settings.testnetReceivingAddress !==
        input.settings.testnetReceivingAddress ||
      old.settings.mainnetReceivingAddress !==
        input.settings.mainnetReceivingAddress ||
      old.settings.network !== input.settings.network ||
      old.settings.mainnetEnabled !== input.settings.mainnetEnabled;
    if (sensitive) {
      await owner(actor.id);
      if (
        !input.password ||
        !(await bcrypt.compare(input.password, actor.password))
      )
        throw new HttpError(
          403,
          "Reauthenticate with your current owner password to change wallet/network activation",
        );
    }
    if (amountUnits(input.settings.price) <= 0n)
      throw new HttpError(422, "Pro price must be positive");
    if (
      input.settings.checkoutEnabled &&
      checkoutBlockers(input.settings).length
    )
      throw new HttpError(409, checkoutBlockers(input.settings).join("; "));
    for (const address of [
      input.settings.testnetReceivingAddress,
      input.settings.mainnetReceivingAddress,
    ])
      if (address) publicAddress(address);
    if (input.settings.receivingAddress && input.settings.checkoutEnabled)
      await validateReceiver(
        input.settings.network,
        input.settings.receivingAddress,
        input.settings.price,
      );
    return json(
      await adminTransaction(actor.id, async (tx) => {
        const fresh = await currentPlan(tx);
        if (fresh.id !== old.id)
          throw new HttpError(409, "Settings changed; refresh before saving");
        const row = await tx.planVersion.create({
          data: {
            version: fresh.version + 1,
            settings: input.settings,
            actorId: actor.id,
          },
        });
        await tx.adminAudit.create({
          data: {
            actorId: actor.id,
            targetId: row.id,
            action: "plan.version",
            reason: input.reason,
            oldValues: fresh.settings,
            newValues: input.settings,
            details: { version: row.version },
          },
        });
        return row;
      }),
    );
  }
  if (route === "admin/wallet/validate" && method === "POST") {
    await owner(actor.id);
    const input = z
      .object({
        network: z.enum(["testnet", "mainnet"]),
        address: z.string().max(56),
      })
      .strict()
      .parse(body);
    await rateLimit(`wallet-validate:${actor.id}`, 5);
    return json(await validateReceiver(input.network, input.address));
  }
  if (path[1] === "entitlements" && path[2] && method === "POST") {
    const targetId = id.parse(path[2]);
    const input = z
      .object({
        action: z.enum(["grant", "extend", "revoke", "limits", "reset"]),
        reason,
        days: z.number().int().min(1).max(36500).optional(),
        lifetime: z.boolean().optional(),
        expiresAt: z.iso.datetime().optional(),
        issueLimit: z.number().int().min(0).max(1000000).nullable().optional(),
        githubLimit: z.number().int().min(0).max(100).nullable().optional(),
        issueOverrideExpiresAt: z.iso.datetime().nullable().optional(),
        githubOverrideExpiresAt: z.iso.datetime().nullable().optional(),
      })
      .strict()
      .parse(body);
    return json(
      await adminTransaction(actor.id, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${targetId}))`;
        const old = await tx.user.findUniqueOrThrow({
          where: { id: targetId },
        });
        let update: any = {};
        if (input.action === "reset") update.allowanceResetAt = new Date();
        if (input.action === "limits")
          update = {
            ...(input.issueLimit !== undefined
              ? { issueLimitOverride: input.issueLimit }
              : {}),
            ...(input.githubLimit !== undefined
              ? { githubLimitOverride: input.githubLimit }
              : {}),
            ...(input.issueOverrideExpiresAt !== undefined
              ? {
                  issueOverrideExpiresAt: input.issueOverrideExpiresAt
                    ? new Date(input.issueOverrideExpiresAt)
                    : null,
                }
              : {}),
            ...(input.githubOverrideExpiresAt !== undefined
              ? {
                  githubOverrideExpiresAt: input.githubOverrideExpiresAt
                    ? new Date(input.githubOverrideExpiresAt)
                    : null,
                }
              : {}),
          };
        if (input.action === "revoke")
          update = {
            membershipPlan: "basic",
            proLifetime: false,
            proExpiresAt: null,
          };
        if (input.action === "grant" || input.action === "extend") {
          const now = new Date();
          const start =
            input.action === "extend" &&
            old.proExpiresAt &&
            old.proExpiresAt > now
              ? old.proExpiresAt
              : now;
          const expiry = input.expiresAt
            ? new Date(input.expiresAt)
            : input.days
              ? new Date(start.getTime() + input.days * 86400000)
              : null;
          if (!input.lifetime && (!expiry || expiry <= now))
            throw new HttpError(
              422,
              "Specify an explicit future expiry/duration or an explicit lifetime grant",
            );
          update = {
            membershipPlan: "pro",
            proLifetime: input.lifetime === true,
            proExpiresAt: input.lifetime ? null : expiry,
          };
          await tx.entitlementGrant.create({
            data: {
              userId: targetId,
              actorId: actor.id,
              source: "manual",
              reason: input.reason,
              expiresAt: update.proExpiresAt,
            },
          });
        }
        const fresh = await tx.user.update({
          where: { id: targetId },
          data: update,
        });
        const select = (v: any) => ({
          membershipPlan: v.membershipPlan,
          proLifetime: v.proLifetime,
          proExpiresAt: v.proExpiresAt?.toISOString() ?? null,
          issueLimit: v.issueLimitOverride,
          githubLimit: v.githubLimitOverride,
          issueOverrideExpiresAt:
            v.issueOverrideExpiresAt?.toISOString() ?? null,
          githubOverrideExpiresAt:
            v.githubOverrideExpiresAt?.toISOString() ?? null,
          allowanceResetAt: v.allowanceResetAt.toISOString(),
        });
        await tx.adminAudit.create({
          data: {
            actorId: actor.id,
            targetId,
            action: `entitlement.${input.action}`,
            reason: input.reason,
            oldValues: select(old),
            newValues: select(fresh),
          },
        });
        return {
          user: await tx.user.findUnique({
            where: { id: targetId },
            select: accountSelect,
          }),
          entitlements: await entitlementSummary(targetId, tx),
        };
      }),
    );
  }
  if (route === "admin/payments" && method === "GET") {
    const status = z
      .enum([
        "pending",
        "verified",
        "expired",
        "underpaid",
        "overpaid",
        "unmatched",
        "failed_verification",
      ])
      .optional()
      .parse(url.searchParams.get("status") || undefined);
    const where = status ? { status } : {};
    const [items, total, unmatched] = await Promise.all([
      db.invoice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        include: {
          payments: true,
          submissions: true,
          user: { select: { id: true, email: true } },
          grants: true,
        },
      }),
      db.invoice.count({ where }),
      db.paymentReceipt.findMany({
        where: { status: "unmatched" },
        take: 20,
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return json({
      items,
      total,
      page,
      pageSize: take,
      unmatched,
      watchers: await db.paymentCursor.findMany({
        take: 30,
        orderBy: { updatedAt: "desc" },
      }),
    });
  }
  if (route === "admin/payments/recheck" && method === "POST") {
    const input = z.object({ invoiceId: id, reason }).strict().parse(body);
    await rateLimit(`payment-recheck:${actor.id}`, 5);
    const i = await db.invoice.findUniqueOrThrow({
      where: { id: input.invoiceId },
      include: { submissions: true, payments: true },
    });
    for (const hash of new Set([
      ...i.submissions.map((s) => s.transactionHash),
      ...i.payments.map((p) => p.transactionHash),
    ]))
      await submitTransaction(i.userId, i.id, hash);
    await db.paymentCursor.updateMany({
      where: { network: i.network, recipient: i.recipient },
      data: { availableAt: new Date(), attempts: 0, error: null },
    });
    await db.adminAudit.create({
      data: {
        actorId: actor.id,
        targetId: i.id,
        action: "payment.recheck",
        reason: input.reason,
      },
    });
    return json({
      status: "queued",
      message: "Recheck queued; watcher retains its durable cursor",
    });
  }
  if (path[1] === "refunds" && path[2] && method === "POST") {
    const input = z
      .object({ status: z.enum(["reviewing", "resolved", "declined"]), reason })
      .strict()
      .parse(body);
    const i = await db.invoice.findUniqueOrThrow({ where: { id: path[2] } });
    await adminTransaction(actor.id, async (tx) => {
      await tx.invoice.update({
        where: { id: i.id },
        data: { refundStatus: input.status },
      });
      await tx.adminAudit.create({
        data: {
          actorId: actor.id,
          targetId: i.id,
          action: "refund.review",
          reason: input.reason,
          oldValues: { status: i.refundStatus },
          newValues: { status: input.status },
        },
      });
    });
    return json({
      status: input.status,
      message: "Administrative record updated; no transfer executed",
    });
  }
  throw new HttpError(404, "Billing endpoint not found");
}
