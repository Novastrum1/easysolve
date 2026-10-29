import "../lib/load-env";
import { parseArgs } from "node:util";
import { db } from "../lib/db";
import { currentPlan } from "../lib/entitlements";
import { checkoutBlockers } from "../lib/billing";
import {
  amountUnits,
  horizonGet,
  STELLAR,
  validateReceiver,
} from "../lib/stellar";
const { values } = parseArgs({
  options: { "confirm-live": { type: "boolean" }, reason: { type: "string" } },
  strict: true,
  allowPositionals: false,
});
try {
  if (
    !values["confirm-live"] ||
    !values.reason ||
    values.reason.trim().length < 3
  )
    throw Error(
      "Use --confirm-live --reason with the owner's explicit authorization. No changes made.",
    );
  if (process.env.STELLAR_MAINNET_ACTIVATION !== "true")
    throw Error(
      "Set STELLAR_MAINNET_ACTIVATION=true privately before activating the plan version.",
    );
  const p = await currentPlan();
  const recipient =
    p.settings.mainnetReceivingAddress ||
    (p.settings.network === "mainnet" ? p.settings.receivingAddress : "");
  if (!recipient)
    throw Error(
      "No saved mainnet receiving PUBLIC address. Configure it with owner authorization first.",
    );
  const root = await horizonGet("mainnet", "/");
  if (root.network_passphrase !== STELLAR.mainnet.passphrase)
    throw Error("Mainnet Horizon network identity does not match.");
  const wallet = await validateReceiver("mainnet", recipient, p.settings.price);
  if (
    amountUnits(p.settings.price) !== 50000000n ||
    p.settings.durationDays !== 14 ||
    p.settings.billingType !== "fixed_days" ||
    p.settings.renewal !== "manual_extend" ||
    !p.settings.proUnlimited ||
    p.settings.proGithubLimit !== 4 ||
    p.settings.basicIssueLimit !== 1 ||
    p.settings.basicReset !== "none" ||
    p.settings.downgrade !== "basic_keep_data"
  )
    throw Error(
      "Saved terms differ from the confirmed 5 USDC / 14-day terms. Review settings explicitly; no terms were changed.",
    );
  const settings = {
    ...p.settings,
    network: "mainnet" as const,
    receivingAddress: recipient,
    mainnetEnabled: true,
    checkoutEnabled: true,
  };
  const blockers = checkoutBlockers(settings);
  if (blockers.length) throw Error(blockers.join("; "));
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('easysolve:admin'))`;
    const current = await currentPlan(tx);
    if (current.id !== p.id)
      throw Error(
        "Plan changed during validation. Review and retry explicitly.",
      );
    const bootstrap = await tx.adminBootstrap.findUnique({
      where: { id: "owner" },
    });
    const actorId = bootstrap?.userId ?? "trusted-server-owner-operator";
    // Trusted server CLI is a separate operator boundary; it never promotes or creates an administrator.
    const row = await tx.planVersion.create({
      data: { version: p.version + 1, settings, actorId },
    });
    await tx.adminAudit.create({
      data: {
        actorId,
        targetId: row.id,
        action: "checkout.mainnet.activate",
        reason: values.reason!,
        oldValues: p.settings,
        newValues: settings,
        details: {
          source: "trusted-server-cli",
          walletValidated: true,
          circleIssuer: STELLAR.mainnet.issuer,
          ownerBootstrapPresent: !!bootstrap,
        },
      },
    });
    return {
      version: row.version,
      checkoutEnabled: true,
      network: settings.network,
      recipient,
      price: settings.price,
      durationDays: settings.durationDays,
      renewal: settings.renewal,
      proUnlimited: settings.proUnlimited,
      proGithubLimit: settings.proGithubLimit,
      ownerBootstrapPresent: !!bootstrap,
    };
  });
  console.log(
    JSON.stringify({
      activation: result,
      wallet,
      mainnetNetworkVerified: true,
      noFundsSent: true,
    }),
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Mainnet activation failed; no payment was made.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
