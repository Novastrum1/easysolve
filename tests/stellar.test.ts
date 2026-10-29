import { expect, it, vi } from "vitest";
vi.mock("../lib/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import QRCode from "qrcode";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import {
  amountUnits,
  canonicalAmount,
  classifyPayment,
  paymentUri,
  STELLAR,
  publicAddress,
} from "../lib/stellar";
const recipient = "GBT7S5S4TZ7GZEAM5NP7A5M2EZYL2IHWTWNU6T7V5AYGCGIPEUPWKUOY";
const invoice = {
  recipient,
  amount: "5.0000000",
  assetCode: "USDC",
  issuer: STELLAR.testnet.issuer,
  memo: "ES123456789012345678901234",
  network: "testnet",
  createdAt: new Date("2026-10-29T12:00:00Z"),
  expiresAt: new Date("2026-10-29T12:30:00Z"),
};
const tx = {
  hash: "a".repeat(64),
  successful: true,
  ledger: 42,
  memo_type: "text",
  memo: invoice.memo,
};
const op = {
  id: "100",
  type: "payment",
  to: recipient,
  transaction_successful: true,
  transaction_hash: tx.hash,
  asset_type: "credit_alphanum4",
  asset_code: "USDC",
  asset_issuer: invoice.issuer,
  amount: "5.0000000",
};
const ledger = { sequence: 42, closed_at: "2026-10-29T12:10:00Z" };
it("uses exact seven-decimal integer arithmetic without float rounding", () => {
  expect(amountUnits("5")).toBe(50000000n);
  expect(canonicalAmount("5.0000000")).toBe("5.0000000");
  expect(amountUnits("0.0000001")).toBe(1n);
  expect(() => amountUnits("4.99999999")).toThrow();
  expect(() => amountUnits("5e0")).toThrow();
  expect(() => amountUnits("-5")).toThrow();
});
it("validates the owner's public receiving address, rejecting secrets and invalid checksums", () => {
  expect(publicAddress(recipient)).toBe(recipient);
  expect(() => publicAddress("S" + "A".repeat(55))).toThrow();
  expect(() => publicAddress(recipient.slice(0, -1) + "A")).toThrow();
});
it.each(["testnet", "mainnet"] as const)(
  "locally encodes and decodes the full documented SEP-7 %s request",
  async (network) => {
    const i = { ...invoice, network, issuer: STELLAR[network].issuer };
    const uri = paymentUri(i);
    const data = await QRCode.toDataURL(uri, {
      width: 600,
      errorCorrectionLevel: "M",
    });
    const png = PNG.sync.read(Buffer.from(data.split(",")[1], "base64"));
    const decoded = jsQR(
      new Uint8ClampedArray(png.data),
      png.width,
      png.height,
    );
    expect(decoded?.data).toBe(uri);
    const url = new URL(decoded!.data);
    expect(url.protocol).toBe("web+stellar:");
    expect(url.pathname).toBe("pay");
    expect(url.searchParams.get("destination")).toBe(recipient);
    expect(url.searchParams.get("amount")).toBe("5.0000000");
    expect(url.searchParams.get("asset_code")).toBe("USDC");
    expect(url.searchParams.get("asset_issuer")).toBe(STELLAR[network].issuer);
    expect(url.searchParams.get("memo")).toBe(invoice.memo);
    expect(url.searchParams.get("memo_type")).toBe("MEMO_TEXT");
    expect(url.searchParams.get("network_passphrase")).toBe(
      network === "testnet" ? STELLAR.testnet.passphrase : null,
    );
    expect(Buffer.byteLength(invoice.memo)).toBeLessThanOrEqual(28);
  },
);
it("verifies only exact on-chain payment details in a closed ledger", () =>
  expect(classifyPayment(invoice, tx, op, ledger).status).toBe("verified"));
it.each([
  ["wrong recipient", { to: STELLAR.testnet.issuer }, "unmatched"],
  ["wrong issuer", { asset_issuer: STELLAR.mainnet.issuer }, "unmatched"],
  ["wrong asset", { asset_code: "USD" }, "unmatched"],
  ["native asset", { asset_type: "native" }, "unmatched"],
  ["underpaid", { amount: "4.9999999" }, "underpaid"],
  ["overpaid", { amount: "5.0000001" }, "overpaid"],
  ["failed operation", { transaction_successful: false }, "unmatched"],
  ["foreign operation", { transaction_hash: "b".repeat(64) }, "unmatched"],
])("rejects %s", (_, change, status) =>
  expect(
    classifyPayment(invoice, tx, { ...op, ...change }, ledger).status,
  ).toBe(status),
);
it("rejects missing or foreign memos, failed transactions, unconfirmed, early and late payments", () => {
  expect(
    classifyPayment(invoice, { ...tx, memo: undefined }, op, ledger).status,
  ).toBe("unmatched");
  expect(
    classifyPayment(invoice, { ...tx, memo: "other" }, op, ledger).status,
  ).toBe("unmatched");
  expect(
    classifyPayment(invoice, { ...tx, successful: false }, op, ledger).status,
  ).toBe("unmatched");
  expect(
    classifyPayment(invoice, tx, op, { ...ledger, sequence: 43 }).status,
  ).toBe("unmatched");
  expect(
    classifyPayment(invoice, tx, op, {
      ...ledger,
      closed_at: "2026-10-29T11:59:59Z",
    }).status,
  ).toBe("unmatched");
  expect(
    classifyPayment(invoice, tx, op, {
      ...ledger,
      closed_at: "2026-10-29T12:30:01Z",
    }).status,
  ).toBe("expired");
});
