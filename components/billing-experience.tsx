"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Copy,
  CreditCard,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Badge, Button, Field, Panel, request } from "./ui";
import { PageHead } from "./workspace";
function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="inline-form">
      <code style={{ overflowWrap: "anywhere", minWidth: 0 }}>{value}</code>
      <Button
        variant="secondary"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        }}
      >
        <Copy size={14} />
        {copied ? "Copied" : `Copy ${label}`}
      </Button>
    </div>
  );
}
export function BillingExperience() {
  const [data, setData] = useState<any>(null),
    [invoice, setInvoice] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [hash, setHash] = useState("");
  const load = async () => {
    try {
      setData(await request("billing"));
      const id = new URLSearchParams(window.location.search).get("invoice");
      if (id)
        setInvoice(await request(`billing/invoices/${encodeURIComponent(id)}`));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, []);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return (
      <Panel title="Plans & billing">
        <p role={error ? "alert" : "status"}>{error || "Loading billing…"}</p>
      </Panel>
    );
  const e = data.entitlements,
    s = data.settings;
  const term =
    s.billingType === "fixed_days"
      ? `${s.durationDays} days of access`
      : s.billingType === "one_time"
        ? "one-time upgrade"
        : "Access terms awaiting owner confirmation";
  return (
    <>
      <PageHead
        eyebrow="YOUR WORKSPACE, WITH ROOM TO GROW"
        title="A plan that’s clear about its limits."
        description="Issue allowances, connected accounts and independently verified Stellar payments."
      />
      {data.provider?.connectionFailed && (
        <p role="alert" className="subtle-notice">
          AI generation currently reports a provider failure. Payment grants
          plan access; it does not restore the AI provider. Please consider this
          before purchasing.
        </p>
      )}
      {error && (
        <p role="alert" className="subtle-notice">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="two-column">
        <Panel title="Your current plan">
          <h2>{e.name}</h2>
          <p>
            {e.expiresAt
              ? `Expires ${new Date(e.expiresAt).toLocaleString()}`
              : e.code === "pro"
                ? "No expiry"
                : "One successful issue; no automatic reset"}
          </p>
          <p>
            Issues solved: {e.successful} · Reserved: {e.reserved} · Remaining:{" "}
            {e.unlimited ? "Unlimited (owner-configured)" : e.remaining}
          </p>
          <p>
            GitHub accounts: {e.connected} / {e.githubLimit} · Plan default:{" "}
            {e.defaultGithubLimit}
          </p>
          {e.overLimit && (
            <p role="alert">
              Your saved accounts exceed your plan.{" "}
              <a href="/account">Choose the accounts that remain usable.</a>{" "}
              Your data and tokens are retained.
            </p>
          )}
          <p>
            Issue allowance resets:{" "}
            {e.reset === "none" ? "No automatic reset" : "UTC calendar month"}
          </p>
        </Panel>
        <Panel title="Basic versus EasySolve Pro">
          <div className="two-column">
            <div>
              <h3>Basic</h3>
              <p>
                {s.basicIssueLimit} successfully solved issue
                {s.basicIssueLimit === 1 ? "" : "s"}
              </p>
              <p>{s.basicGithubLimit} GitHub account(s)</p>
              <p>
                {s.basicReset === "none"
                  ? "No automatic issue reset"
                  : "Owner-configured calendar reset"}
              </p>
            </div>
            <div>
              <h3>EasySolve Pro</h3>
              <strong>{s.price.replace(/\.0+$/, "")} USDC</strong>
              <p>{term}</p>
              <p>
                {s.proUnlimited
                  ? "Unlimited issue solving (owner-configured)"
                  : s.proIssueLimit === null
                    ? "Issue allowance awaiting owner confirmation"
                    : `${s.proIssueLimit} successfully solved issues`}
              </p>
              <p>{s.proGithubLimit} distinct GitHub accounts</p>
              <p>Execution and AI token safety budgets still apply.</p>
              <p>
                Wallet payments are manual, never automatic recurring billing.
              </p>
            </div>
          </div>
          <Button
            busy={busy}
            disabled={!data.checkoutReady || busy}
            onClick={() =>
              void act(async () => {
                const i = await request("billing/invoices", {});
                window.location.assign(
                  `/checkout?invoice=${encodeURIComponent(i.id)}`,
                );
              })
            }
          >
            <CreditCard size={16} />
            {e.code === "pro"
              ? "Renew EasySolve Pro"
              : "Upgrade to EasySolve Pro"}
          </Button>
          {!data.checkoutReady && (
            <div role="status">
              <strong>Checkout is disabled</strong>
              <ul>
                {data.blockers.map((b: string) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>
      {invoice && (
        <Panel
          title="Stellar network — USDC"
          description={
            invoice.network === "testnet"
              ? "TESTNET — test USDC has no monetary value. Never send mainnet funds to this invoice."
              : "MAINNET — real USDC. Review every payment detail in your wallet."
          }
        >
          <div className="two-column">
            <div>
              <h2>{invoice.amount} USDC</h2>
              <p>
                Invoice terms: EasySolve Pro ·{" "}
                {invoice.terms.billingType === "fixed_days"
                  ? `${invoice.terms.durationDays} days`
                  : "One-time upgrade"}{" "}
                ·{" "}
                {invoice.terms.renewal === "manual_extend"
                  ? "Manual renewal adds time after current expiry"
                  : "Manual renewal only"}
                . These terms are fixed for this invoice.
              </p>
              <Badge status={invoice.status} />
              <p>Entitlement: {invoice.entitlementState}</p>
              <p>
                Invoice expires {new Date(invoice.expiresAt).toLocaleString()}
              </p>
              <Field label="Receiving PUBLIC address">
                <CopyValue
                  value={invoice.recipient}
                  label="receiving address"
                />
              </Field>
              <Field label="Required memo/reference">
                <CopyValue value={invoice.memo} label="memo" />
              </Field>
              <Field label="Exact USDC issuer">
                <CopyValue value={invoice.issuer} label="issuer" />
              </Field>
              <a className="external" href={invoice.paymentUri}>
                Open a compatible Stellar wallet <ArrowRight size={14} />
              </a>
              <p>
                Your wallet authorizes and signs the payment. EasySolve never
                asks for a wallet secret.
              </p>
            </div>
            <div>
              {invoice.qr && (
                <img
                  width={240}
                  height={240}
                  src={invoice.qr}
                  alt="Stellar payment request QR code"
                />
              )}
              <CopyValue value={invoice.paymentUri} label="payment request" />
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await request(`billing/invoices/${invoice.id}/submit`, {
                  transactionHash: hash,
                });
                setNotice(
                  "Transaction queued for independent verification. Keep this invoice for reference; the watcher continues when your browser is closed.",
                );
              });
            }}
          >
            <Field label="Transaction hash">
              <input
                required
                pattern="[a-fA-F0-9]{64}"
                value={hash}
                onChange={(e) => setHash(e.target.value)}
                placeholder="64-character Stellar transaction hash"
              />
            </Field>
            <Button type="submit" busy={busy}>
              Submit for verification
            </Button>
            <Button variant="secondary" onClick={() => void load()}>
              <RefreshCw size={14} />
              Refresh status
            </Button>
          </form>
          {invoice.submissions?.map((s: any, i: number) => (
            <p key={i} role={s.error ? "alert" : "status"}>
              {s.status}: {s.error || "Verification scheduled"}
            </p>
          ))}
          {invoice.payments.map((p: any) => (
            <p key={p.id}>
              {p.status}: {p.detail} ·{" "}
              <a
                href={`${invoice.transactionBase}${p.transactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction
              </a>
            </p>
          ))}
          <Button
            variant="secondary"
            disabled={busy || invoice.refundStatus !== "none"}
            onClick={() =>
              void act(async () => {
                const reason = window.prompt(
                  "Reason for refund review (no automatic transfers)",
                );
                if (reason)
                  await request(`billing/invoices/${invoice.id}/refund`, {
                    reason,
                  });
              })
            }
          >
            Request refund review
          </Button>
          <p>
            Refund review: {invoice.refundStatus}. No automatic refunds or
            outgoing transfers.
          </p>
        </Panel>
      )}
      <Panel title="Invoice and payment history">
        {!data.invoices.length ? (
          <p>No invoices yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Network</th>
                  <th>Amount</th>
                  <th>Payment</th>
                  <th>Access</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((i: any) => (
                  <tr key={i.id}>
                    <td>{new Date(i.createdAt).toLocaleString()}</td>
                    <td>{i.network}</td>
                    <td>{i.amount} USDC</td>
                    <td>
                      <Badge status={i.status} />
                    </td>
                    <td>{i.entitlementState}</td>
                    <td>
                      <a href={`/checkout?invoice=${i.id}`}>View invoice</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <div className="subtle-notice">
        <ShieldCheck size={18} />A submitted hash, wallet callback or screenshot
        cannot activate Pro. Only an independently verified exact payment can
        activate access.
      </div>
    </>
  );
}
