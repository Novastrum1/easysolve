import { StrKey } from "@stellar/stellar-sdk";
import { HttpError } from "./security";
export const STELLAR = {
  testnet: {
    horizon: "https://horizon-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
    issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    explorer: "https://stellar.expert/explorer/testnet",
  },
  mainnet: {
    horizon: "https://horizon.stellar.org",
    passphrase: "Public Global Stellar Network ; September 2015",
    issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    explorer: "https://stellar.expert/explorer/public",
  },
} as const;
export type StellarNetwork = keyof typeof STELLAR;
export function stellarNetwork(value: string): StellarNetwork {
  if (value !== "testnet" && value !== "mainnet")
    throw new HttpError(422, "Unsupported Stellar network");
  return value;
}
export function amountUnits(amount: string): bigint {
  if (!/^\d{1,12}(\.\d{1,7})?$/.test(amount))
    throw new HttpError(422, "Amount must have at most seven decimal places");
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole) * 10000000n + BigInt(fraction.padEnd(7, "0"));
}
export function canonicalAmount(value: string) {
  const n = amountUnits(value);
  return `${n / 10000000n}.${String(n % 10000000n).padStart(7, "0")}`;
}
export function publicAddress(value: string) {
  if (!StrKey.isValidEd25519PublicKey(value))
    throw new HttpError(
      422,
      "Use a valid Stellar G public receiving address (not a secret or muxed account)",
    );
  return value;
}
export async function horizonGet(network: StellarNetwork, path: string) {
  const response = await fetch(STELLAR[network].horizon + path, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new HttpError(
      response.status === 404 ? 422 : 503,
      response.status === 404
        ? "Stellar record not found on the invoice network"
        : "Stellar verification service unavailable; payment is not yet verified",
    );
  return response.json();
}
export async function validateReceiver(
  network: StellarNetwork,
  address: string,
  amount = "5.0000000",
) {
  publicAddress(address);
  const account = await horizonGet(network, `/accounts/${address}`);
  const balance = account.balances?.find(
    (b: any) =>
      b.asset_code === "USDC" && b.asset_issuer === STELLAR[network].issuer,
  );
  if (
    !balance ||
    balance.is_authorized !== true ||
    amountUnits(balance.limit) -
      amountUnits(balance.balance) -
      amountUnits(balance.buying_liabilities ?? "0") <
      amountUnits(amount)
  )
    throw new HttpError(
      422,
      "Receiving account needs an authorized USDC trustline with sufficient capacity on the selected network. Configure it in your own wallet; EasySolve cannot sign for you.",
    );
  return {
    address,
    network,
    asset: "USDC",
    issuer: STELLAR[network].issuer,
    verified: true,
  };
}
export function paymentUri(i: {
  recipient: string;
  amount: string;
  assetCode: string;
  issuer: string;
  memo: string;
  network: string;
}) {
  const params = new URLSearchParams({
    destination: i.recipient,
    amount: canonicalAmount(i.amount),
    asset_code: i.assetCode,
    asset_issuer: i.issuer,
    memo: i.memo,
    memo_type: "MEMO_TEXT",
    msg: "EasySolve Pro",
  });
  if (i.network === "testnet")
    params.set("network_passphrase", STELLAR.testnet.passphrase);
  return `web+stellar:pay?${params.toString().replace(/\+/g, "%20")}`;
}
export function classifyPayment(
  i: {
    recipient: string;
    assetCode: string;
    issuer: string;
    amount: string;
    memo: string;
    createdAt: Date;
    expiresAt: Date;
    network: string;
  },
  tx: any,
  op: any,
  ledger: any,
) {
  if (!tx.successful || !op.transaction_successful)
    return { status: "unmatched", detail: "Transaction failed" };
  if (
    !Number.isSafeInteger(tx.ledger) ||
    tx.ledger < 1 ||
    ledger.sequence !== tx.ledger ||
    !ledger.closed_at
  )
    return {
      status: "unmatched",
      detail: "Transaction is not in a confirmed closed ledger",
    };
  if (op.transaction_hash !== tx.hash)
    return {
      status: "unmatched",
      detail: "Operation does not belong to the transaction",
    };
  if (
    ![
      "payment",
      "path_payment_strict_receive",
      "path_payment_strict_send",
    ].includes(op.type) ||
    op.to !== i.recipient
  )
    return { status: "unmatched", detail: "Wrong payment type or destination" };
  if (
    op.asset_type === "native" ||
    op.asset_code !== i.assetCode ||
    op.asset_issuer !== i.issuer
  )
    return { status: "unmatched", detail: "Wrong asset or issuer" };
  if (tx.memo_type !== "text" || tx.memo !== i.memo)
    return {
      status: "unmatched",
      detail: "Missing or mismatched invoice memo",
    };
  const paidAt = new Date(ledger.closed_at);
  if (!Number.isFinite(paidAt.getTime()) || paidAt < i.createdAt)
    return { status: "unmatched", detail: "Payment predates invoice" };
  if (paidAt > i.expiresAt)
    return {
      status: "expired",
      detail:
        "Payment arrived after invoice expiration; manual review required",
    };
  const amount = amountUnits(op.amount),
    expected = amountUnits(i.amount);
  if (amount < expected)
    return {
      status: "underpaid",
      detail: "Received less than the invoice amount; no entitlement granted",
    };
  if (amount > expected)
    return {
      status: "overpaid",
      detail:
        "Received more than the invoice amount; manual review required; no automatic refund",
    };
  return {
    status: "verified",
    detail: "Exact invoice payment confirmed in a closed ledger",
  };
}
