import { randomBytes } from "node:crypto";
import { db } from "./db";
import { HttpError } from "./security";
import {
  currentPlan,
  planSettingsSchema,
  type PlanSettings,
} from "./entitlements";
import {
  amountUnits,
  canonicalAmount,
  classifyPayment,
  horizonGet,
  paymentUri,
  STELLAR,
  stellarNetwork,
  validateReceiver,
} from "./stellar";
import type { Prisma } from "@prisma/client";
export function checkoutBlockers(s: PlanSettings) {
  const reasons: string[] = [];
  if (!s.checkoutEnabled) reasons.push("Owner has not enabled checkout");
  if (!s.termsConfirmed || !s.basicResetConfirmed)
    reasons.push("Owner must confirm Basic reset and Pro terms");
  if (!s.proUnlimited && s.proIssueLimit === null)
    reasons.push("Pro issue allowance must be defined");
  if (
    s.billingType === "unconfirmed" ||
    (s.billingType === "fixed_days" &&
      (!s.durationDays ||
        s.renewal === "unconfirmed" ||
        s.downgrade === "unconfirmed"))
  )
    reasons.push("Pro duration, renewal and downgrade rules must be confirmed");
  if (!s.receivingAddress) reasons.push("Receiving PUBLIC address is required");
  if (
    s.network === "mainnet" &&
    (!s.mainnetEnabled || process.env.STELLAR_MAINNET_ACTIVATION !== "true")
  )
    reasons.push(
      "Mainnet requires explicit owner activation and server activation",
    );
  return reasons;
}
export async function billingSummary(userId: string) {
  const p = await currentPlan();
  const {
    receivingAddress: _,
    testnetReceivingAddress: _test,
    mainnetReceivingAddress: _main,
    ...safeSettings
  } = p.settings;
  return {
    version: p.version,
    settings: safeSettings,
    checkoutReady: !checkoutBlockers(p.settings).length,
    blockers: checkoutBlockers(p.settings),
    invoices: await db.invoice.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { payments: true },
    }),
  };
}
export async function createInvoice(userId: string) {
  const p = await currentPlan();
  const s = p.settings;
  const blockers = checkoutBlockers(s);
  if (blockers.length)
    throw new HttpError(409, `Checkout disabled: ${blockers.join("; ")}`);
  if (amountUnits(s.price) <= 0n)
    throw new HttpError(409, "Price must be positive");
  await validateReceiver(s.network, s.receivingAddress, s.price);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (u.suspendedAt) throw new HttpError(403, "Account suspended");
    if (u.membershipPlan === "pro" && u.proLifetime)
      throw new HttpError(
        409,
        "This account already has non-expiring Pro access and does not need renewal",
      );
    const latest = await currentPlan(tx);
    if (latest.id !== p.id)
      throw new HttpError(
        409,
        "Payment terms changed; review them before creating an invoice",
      );
    const memo = `ES${randomBytes(12).toString("hex")}`; // 26 ASCII bytes, below Stellar MEMO_TEXT's 28-byte maximum.
    const invoice = await tx.invoice.create({
      data: {
        userId,
        planVersionId: p.id,
        network: s.network,
        recipient: s.receivingAddress,
        assetCode: "USDC",
        issuer: STELLAR[s.network].issuer,
        amount: canonicalAmount(s.price),
        memo,
        terms: s,
        expiresAt: new Date(Date.now() + s.invoiceMinutes * 60000),
      },
    });
    await tx.paymentCursor.upsert({
      where: { id: `${invoice.network}:${invoice.recipient}` },
      create: {
        id: `${invoice.network}:${invoice.recipient}`,
        network: invoice.network,
        recipient: invoice.recipient,
      },
      update: {},
    });
    return { ...invoice, paymentUri: paymentUri(invoice) };
  });
}
export async function activateInvoice(
  tx: Prisma.TransactionClient,
  invoiceId: string,
) {
  const i = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (i.entitlementState === "activated") return;
  const receipt = await tx.paymentReceipt.findFirst({
    where: {
      invoiceId: i.id,
      network: i.network,
      status: "verified",
      amount: i.amount,
      recipient: i.recipient,
      issuer: i.issuer,
      assetCode: i.assetCode,
    },
  });
  if (!receipt)
    throw new HttpError(
      409,
      "Independent on-chain verification is required before activating Pro",
    );
  const terms = planSettingsSchema.parse(i.terms);
  if (
    !terms.termsConfirmed ||
    (!terms.proUnlimited && terms.proIssueLimit === null) ||
    terms.billingType === "unconfirmed"
  )
    throw new HttpError(409, "Invoice has incomplete entitlement terms");
  const u = await tx.user.findUniqueOrThrow({ where: { id: i.userId } });
  const now = new Date();
  const lifetime = terms.billingType === "one_time";
  const start =
    terms.renewal === "manual_extend" && u.proExpiresAt && u.proExpiresAt > now
      ? u.proExpiresAt
      : now;
  const expiresAt = lifetime
    ? null
    : new Date(start.getTime() + terms.durationDays! * 86400000);
  await tx.entitlementGrant.create({
    data: {
      userId: i.userId,
      source: i.network === "testnet" ? "testnet_payment" : "verified_payment",
      reason: `Verified ${i.network} invoice payment`,
      invoiceId: i.id,
      expiresAt,
    },
  });
  // A lifetime entitlement is never shortened by a later fixed-duration invoice.
  await tx.user.update({
    where: { id: i.userId },
    data: {
      membershipPlan: "pro",
      proLifetime: u.proLifetime || lifetime,
      proExpiresAt: u.proLifetime ? null : expiresAt,
    },
  });
  await tx.invoice.update({
    where: { id: i.id },
    data: {
      status: "verified",
      entitlementState: "activated",
      verifiedAt: now,
    },
  });
}
export async function verifyTransaction(
  networkValue: string,
  hash: string,
  requestedInvoiceId?: string,
) {
  const network = stellarNetwork(networkValue);
  if (!/^[a-fA-F0-9]{64}$/.test(hash))
    throw new HttpError(422, "Use a 64-character Stellar transaction hash");
  hash = hash.toLowerCase();
  const root = await horizonGet(network, "/");
  if (root.network_passphrase !== STELLAR[network].passphrase)
    throw new HttpError(503, "Stellar verifier network identity mismatch");
  const transaction = await horizonGet(network, `/transactions/${hash}`);
  if (transaction.hash !== hash)
    throw new HttpError(422, "Stellar transaction hash mismatch");
  if (
    !transaction.successful ||
    !Number.isSafeInteger(transaction.ledger) ||
    transaction.ledger < 1
  )
    throw new HttpError(422, "Transaction failed or is not in a closed ledger");
  const ledger = await horizonGet(network, `/ledgers/${transaction.ledger}`);
  const payments = await horizonGet(
    network,
    `/transactions/${hash}/payments?limit=200&order=asc`,
  );
  if (!Array.isArray(payments._embedded?.records))
    throw new HttpError(503, "Stellar verification response is invalid");
  const result = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('easysolve:payments'))`;
      const requested = requestedInvoiceId
        ? await tx.invoice.findUniqueOrThrow({
            where: { id: requestedInvoiceId },
          })
        : null;
      const matched =
        typeof transaction.memo === "string"
          ? await tx.invoice.findUnique({ where: { memo: transaction.memo } })
          : null;
      const invoice = matched?.network === network ? matched : null;
      if (invoice)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoice.userId}))`;
      const records = [];
      for (const op of payments._embedded.records) {
        if (typeof op.id !== "string" || !/^\d+$/.test(op.id))
          throw new HttpError(503, "Invalid Stellar operation identity");
        const existing = await tx.paymentReceipt.findUnique({
          where: { network_operationId: { network, operationId: op.id } },
        });
        if (existing) {
          records.push(existing);
          continue;
        }
        // Do not store unrelated outputs in a transaction. Known historical receiving wallets remain watched.
        const known = await tx.paymentCursor.findUnique({
          where: { id: `${network}:${op.to}` },
        });
        if (
          !known &&
          op.to !== requested?.recipient &&
          op.to !== invoice?.recipient
        )
          continue;
        const verdict = invoice
          ? classifyPayment(invoice, transaction, op, ledger)
          : {
              status: "unmatched",
              detail:
                "No matching invoice on this network; missing or unknown memo",
            };
        const currentInvoice = invoice
          ? await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
          : null;
        const status =
          verdict.status === "verified" &&
          currentInvoice?.entitlementState === "activated"
            ? "unmatched"
            : verdict.status;
        const record = await tx.paymentReceipt.create({
          data: {
            network,
            operationId: op.id,
            transactionHash: hash,
            invoiceId: invoice?.id,
            recipient: op.to ?? "",
            assetCode: op.asset_code ?? "XLM",
            issuer: op.asset_issuer ?? "",
            amount: canonicalAmount(op.amount ?? "0"),
            memo: transaction.memo ?? null,
            ledger: transaction.ledger,
            paidAt: new Date(ledger.closed_at),
            status,
            detail:
              status !== verdict.status
                ? "Invoice already credited; additional payment needs manual review"
                : verdict.detail,
          },
        });
        records.push(record);
        if (invoice && status === "verified")
          await activateInvoice(tx, invoice.id);
        else if (invoice && invoice.entitlementState !== "activated")
          await tx.invoice.updateMany({
            where: { id: invoice.id, entitlementState: { not: "activated" } },
            data: { status },
          });
      }
      if (
        requested &&
        requested.entitlementState !== "activated" &&
        !records.some((r: any) => r.invoiceId === requested.id)
      )
        await tx.invoice.update({
          where: { id: requested.id },
          data: { status: "unmatched" },
        });
      return records;
    },
    { timeout: 20000 },
  );
  return result;
}
export async function submitTransaction(
  userId: string,
  invoiceId: string,
  hash: string,
) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, userId },
  });
  if (!invoice) throw new HttpError(404, "Invoice not found");
  if (!/^[a-fA-F0-9]{64}$/.test(hash))
    throw new HttpError(422, "Use a valid Stellar transaction hash");
  return db.paymentSubmission.upsert({
    where: {
      invoiceId_transactionHash: {
        invoiceId,
        transactionHash: hash.toLowerCase(),
      },
    },
    create: { invoiceId, transactionHash: hash.toLowerCase() },
    update: {
      status: "queued",
      attempts: 0,
      availableAt: new Date(),
      error: null,
    },
  });
}
// Durable bounded reconciliation. PostgreSQL lease prevents concurrent workers from advancing a cursor out of order.
export async function reconcilePayments() {
  const deadline = Date.now() + 25000;
  const batch = Math.max(
    1,
    Math.min(100, Number(process.env.PAYMENT_WATCH_BATCH) || 20),
  );
  const cursors = await db.paymentCursor.findMany({
    where: { availableAt: { lte: new Date() }, attempts: { lt: 8 } },
    take: 2,
  });
  for (const candidate of cursors) {
    if (Date.now() > deadline) break;
    const leaseUntil = new Date(Date.now() + 120000);
    const lease = await db.paymentCursor.updateMany({
      where: { id: candidate.id, availableAt: { lte: new Date() } },
      data: { availableAt: leaseUntil },
    });
    if (!lease.count) continue;
    try {
      const network = stellarNetwork(candidate.network);
      const page = await horizonGet(
        network,
        `/accounts/${candidate.recipient}/payments?cursor=${encodeURIComponent(candidate.cursor)}&order=asc&limit=${batch}`,
      );
      for (const op of page._embedded?.records ?? []) {
        if (Date.now() > deadline) break;
        if (!/^\d+$/.test(op.paging_token ?? ""))
          throw new Error("Invalid watcher cursor");
        if (op.to === candidate.recipient && op.transaction_successful)
          await verifyTransaction(network, op.transaction_hash);
        const advanced = await db.paymentCursor.updateMany({
          where: { id: candidate.id, availableAt: leaseUntil },
          data: { cursor: op.paging_token },
        });
        if (!advanced.count) break;
      }
      await db.paymentCursor.updateMany({
        where: { id: candidate.id, availableAt: leaseUntil },
        data: {
          attempts: 0,
          error: null,
          availableAt: new Date(Date.now() + 15000),
        },
      });
    } catch {
      const attempts = candidate.attempts + 1;
      await db.paymentCursor.updateMany({
        where: { id: candidate.id, availableAt: leaseUntil },
        data: {
          attempts,
          error:
            "Payment watcher could not verify the next ledger record; cursor retained. Administrator recheck available.",
          availableAt: new Date(
            Date.now() + Math.min(3600000, 15000 * 2 ** Math.min(attempts, 8)),
          ),
        },
      });
    }
  }
  const submissions = await db.paymentSubmission.findMany({
    where: {
      status: "queued",
      availableAt: { lte: new Date() },
      attempts: { lt: 5 },
    },
    include: { invoice: true },
    take: 10,
  });
  for (const s of submissions) {
    if (Date.now() > deadline) break;
    const leaseUntil = new Date(Date.now() + 120000);
    const lease = await db.paymentSubmission.updateMany({
      where: {
        id: s.id,
        status: "queued",
        availableAt: { lte: new Date() },
        attempts: s.attempts,
      },
      data: {
        availableAt: leaseUntil,
        attempts: { increment: 1 },
      },
    });
    if (!lease.count) continue;
    try {
      await verifyTransaction(
        s.invoice.network,
        s.transactionHash,
        s.invoiceId,
      );
      await db.paymentSubmission.updateMany({
        where: { id: s.id, availableAt: leaseUntil, attempts: s.attempts + 1 },
        data: { status: "checked", error: null },
      });
    } catch (error) {
      const last = s.attempts >= 4;
      const updated = await db.paymentSubmission.updateMany({
        where: { id: s.id, availableAt: leaseUntil, attempts: s.attempts + 1 },
        data: {
          status: last ? "failed_verification" : "queued",
          availableAt: new Date(Date.now() + 30000 * 2 ** s.attempts),
          error:
            error instanceof HttpError
              ? error.message
              : "Verification unavailable; no entitlement granted",
        },
      });
      if (updated.count)
        await db.invoice.updateMany({
          where: { id: s.invoiceId, entitlementState: { not: "activated" } },
          data: { status: last ? "failed_verification" : "pending" },
        });
    }
  }
  await db.invoice.updateMany({
    where: {
      expiresAt: { lt: new Date() },
      status: "pending",
      entitlementState: "pending",
    },
    data: { status: "expired" },
  });
}
