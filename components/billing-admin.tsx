"use client";
import { useEffect, useState } from "react";
import { Badge, Button, Field, Panel, request } from "./ui";
export function UserEntitlementControls({
  userId,
  onSaved,
}: {
  userId: string;
  onSaved: () => void;
}) {
  const [data, setData] = useState<any>(null),
    [reason, setReason] = useState(""),
    [days, setDays] = useState("30"),
    [lifetime, setLifetime] = useState(false),
    [issueLimit, setIssueLimit] = useState(""),
    [githubLimit, setGithubLimit] = useState(""),
    [issueExpiry, setIssueExpiry] = useState(""),
    [githubExpiry, setGithubExpiry] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const load = async () => {
    const d = await request(`admin/users/${userId}`);
    setData(d);
    setIssueLimit(d.entitlements.issueOverride?.toString() ?? "");
    setGithubLimit(d.entitlements.githubOverride?.toString() ?? "");
    const local = (v: string | null) =>
      v
        ? new Date(
            new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000,
          )
            .toISOString()
            .slice(0, 16)
        : "";
    setIssueExpiry(local(d.entitlements.issueOverrideExpiresAt));
    setGithubExpiry(local(d.entitlements.githubOverrideExpiresAt));
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [userId]);
  const act = async (action: string) => {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await request(`admin/entitlements/${userId}`, {
        action,
        reason,
        ...(["grant", "extend"].includes(action)
          ? { lifetime, ...(days ? { days: Number(days) } : {}) }
          : {}),
        ...(action === "limits"
          ? {
              issueLimit: issueLimit === "" ? null : Number(issueLimit),
              githubLimit: githubLimit === "" ? null : Number(githubLimit),
              issueOverrideExpiresAt: issueExpiry
                ? new Date(issueExpiry).toISOString()
                : null,
              githubOverrideExpiresAt: githubExpiry
                ? new Date(githubExpiry).toISOString()
                : null,
            }
          : {}),
      });
      await load();
      onSaved();
      setSuccess(
        action === "grant"
          ? lifetime
            ? "Lifetime Pro granted."
            : `Pro granted for ${days} days from now.`
          : action === "extend"
            ? lifetime
              ? "Lifetime Pro granted."
              : `Pro extended by ${days} days from the current expiry, or from now if expired.`
            : "Entitlements updated.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <p role="status">Loading entitlement details…</p>;
  const e = data.entitlements;
  const validDuration =
    lifetime ||
    (Number.isInteger(Number(days)) &&
      Number(days) >= 1 &&
      Number(days) <= 36500);
  return (
    <section
      style={{
        borderTop: "1px solid var(--border)",
        marginTop: 20,
        paddingTop: 20,
      }}
    >
      <h3>Plan and issue entitlements</h3>
      <p>
        {e.name} ·{" "}
        {e.expiresAt
          ? `Expires ${new Date(e.expiresAt).toLocaleString()}`
          : "No expiry"}
      </p>
      <p>
        {e.successful} successful issues · {e.reserved} reserved ·{" "}
        {e.unlimited ? "Unlimited" : e.remaining} remaining
      </p>
      <p>
        GitHub: {e.connected} distinct accounts, {e.githubLimit} effective
        limit, {e.defaultGithubLimit} plan default
      </p>
      <p>
        Issues: {e.unlimited ? "Unlimited" : e.issueLimit} effective;{" "}
        {e.defaultIssueLimit === null
          ? e.defaultUnlimited
            ? "Unlimited"
            : "Not configured"
          : e.defaultIssueLimit}{" "}
        default. Reset: {e.reset}.
      </p>
      <Field label="Required entitlement change reason">
        <textarea
          placeholder="For example: complimentary access or support adjustment"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={3}
          required
        />
      </Field>
      <p>Enter a reason of at least 3 characters to enable these actions.</p>
      <div className="two-column">
        <Field label="Manual Pro duration in days">
          <input
            type="number"
            min={1}
            max={36500}
            step={1}
            disabled={lifetime}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Field>
        <label>
          <input
            type="checkbox"
            checked={lifetime}
            onChange={(e) => setLifetime(e.target.checked)}
          />
          Explicit lifetime manual grant
        </label>
      </div>
      <p>
        Grant starts Pro access now for the selected number of days. Extend adds
        days to the current expiry, or starts from now when access has expired.
      </p>
      <div className="inline-form">
        {["grant", "extend", "revoke", "reset"].map((action) => (
          <Button
            key={action}
            variant="secondary"
            busy={busy}
            disabled={
              reason.trim().length < 3 ||
              (["grant", "extend"].includes(action) && !validDuration)
            }
            onClick={() => void act(action)}
          >
            {
              (
                {
                  grant: "Grant Pro manually",
                  extend: "Extend Pro manually",
                  revoke: "Revoke Pro",
                  reset: "Reset issue allowance",
                } as any
              )[action]
            }
          </Button>
        ))}
      </div>
      {!validDuration && (
        <p role="alert">Enter a whole number of days from 1 to 36500.</p>
      )}
      {success && <p role="status">{success}</p>}
      <p>
        Manual grants are audited separately and do not create payment receipts.
        Reset changes the allowance window but retains solve history and active
        reservations.
      </p>
      <div className="two-column">
        <Field label="Issue limit override (blank clears override)">
          <input
            type="number"
            min={0}
            value={issueLimit}
            onChange={(e) => setIssueLimit(e.target.value)}
          />
        </Field>
        <Field label="GitHub account override (blank clears override)">
          <input
            type="number"
            min={0}
            value={githubLimit}
            onChange={(e) => setGithubLimit(e.target.value)}
          />
        </Field>
        <Field label="Issue override expires (optional)">
          <input
            type="datetime-local"
            value={issueExpiry}
            onChange={(e) => setIssueExpiry(e.target.value)}
          />
        </Field>
        <Field label="GitHub override expires (optional)">
          <input
            type="datetime-local"
            value={githubExpiry}
            onChange={(e) => setGithubExpiry(e.target.value)}
          />
        </Field>
      </div>
      <Button
        busy={busy}
        disabled={reason.trim().length < 3}
        onClick={() => void act("limits")}
      >
        Save entitlement overrides
      </Button>
      {error && <p role="alert">{error}</p>}
      <h4>Payment history</h4>
      {data.payments.length ? (
        data.payments.map((i: any) => (
          <p key={i.id}>
            {i.network} · {i.amount} USDC · {i.status} · {i.entitlementState} ·
            Invoice {i.id}
          </p>
        ))
      ) : (
        <p>No invoices</p>
      )}
      <h4>Entitlement history</h4>
      {data.grants.map((g: any) => (
        <p key={g.id}>
          {g.source} · {g.reason} ·{" "}
          {g.expiresAt ? new Date(g.expiresAt).toLocaleString() : "No expiry"}
        </p>
      ))}
    </section>
  );
}
export function BillingAdministration() {
  const [plan, setPlan] = useState<any>(null),
    [settings, setSettings] = useState<any>(null),
    [payments, setPayments] = useState<any>(null),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [reason, setReason] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    request("admin/plans")
      .then((p) => {
        setPlan(p);
        setSettings(p.settings);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    request(`admin/payments?page=${page}&status=${encodeURIComponent(status)}`)
      .then(setPayments)
      .catch((e) => setError(e.message));
  }, [status, page]);
  const update = (key: string, value: any) =>
    setSettings((s: any) => ({ ...s, [key]: value }));
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ margin: "24px 0" }}>
      <details>
        <summary style={{ cursor: "pointer", padding: 16, fontWeight: 700 }}>
          Plan settings and Stellar payments
        </summary>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {settings && (
          <Panel
            title={`Versioned plan settings · version ${plan.version}`}
            description="Saving creates a new version. Existing invoices keep their original price, wallet, network and entitlement terms."
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await request("admin/plans", { settings, reason, password });
                  const p = await request("admin/plans");
                  setPlan(p);
                  setSettings(p.settings);
                  setPassword("");
                  setNotice("Plan version saved");
                });
              }}
            >
              <div className="two-column">
                {[
                  ["basicIssueLimit", "Basic successful-issue limit"],
                  ["basicGithubLimit", "Basic GitHub account limit"],
                  ["proGithubLimit", "Pro default GitHub account limit"],
                  ["durationDays", "Pro duration in days"],
                  ["invoiceMinutes", "Invoice expiry in minutes"],
                ].map(([key, label]) => (
                  <Field key={key} label={label}>
                    <input
                      type="number"
                      min={key === "basicIssueLimit" ? 0 : 1}
                      value={settings[key] ?? ""}
                      onChange={(e) =>
                        update(
                          key,
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                    />
                  </Field>
                ))}
                <Field label="Pro issue allowance (blank means unresolved unless unlimited)">
                  <input
                    type="number"
                    min={0}
                    value={settings.proIssueLimit ?? ""}
                    onChange={(e) =>
                      update(
                        "proIssueLimit",
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                  />
                </Field>
                <Field label="Pro price in Stellar USDC">
                  <input
                    value={settings.price}
                    required
                    inputMode="decimal"
                    onChange={(e) => update("price", e.target.value)}
                  />
                </Field>
                <Field label="Billing terms">
                  <select
                    value={settings.billingType}
                    onChange={(e) => update("billingType", e.target.value)}
                  >
                    <option value="unconfirmed">Awaiting confirmation</option>
                    <option value="one_time">One-time upgrade</option>
                    <option value="fixed_days">Fixed number of days</option>
                  </select>
                </Field>
                <Field label="Manual renewal behavior">
                  <select
                    value={settings.renewal}
                    onChange={(e) => update("renewal", e.target.value)}
                  >
                    <option value="unconfirmed">Awaiting confirmation</option>
                    <option value="manual_extend">
                      Add duration after current expiry
                    </option>
                    <option value="manual_restart">
                      Restart duration immediately
                    </option>
                  </select>
                </Field>
                <Field label="Expiry and downgrade">
                  <select
                    value={settings.downgrade}
                    onChange={(e) => update("downgrade", e.target.value)}
                  >
                    <option value="unconfirmed">Awaiting confirmation</option>
                    <option value="basic_keep_data">
                      Return to Basic; retain all data
                    </option>
                  </select>
                </Field>
                {["basicReset", "proReset"].map((key) => (
                  <Field
                    key={key}
                    label={`${key === "basicReset" ? "Basic" : "Pro"} issue reset rule`}
                  >
                    <select
                      value={settings[key]}
                      onChange={(e) => update(key, e.target.value)}
                    >
                      <option value="none">No automatic reset</option>
                      <option value="calendar_month">UTC calendar month</option>
                    </select>
                  </Field>
                ))}
                <Field label="Stellar network">
                  <select
                    disabled={!plan.isOwner}
                    value={settings.network}
                    onChange={(e) => {
                      update("network", e.target.value);
                      update(
                        "receivingAddress",
                        e.target.value === "testnet"
                          ? settings.testnetReceivingAddress
                          : settings.mainnetReceivingAddress,
                      );
                    }}
                  >
                    <option value="testnet">Testnet — test USDC only</option>
                    <option value="mainnet">Mainnet — real USDC</option>
                  </select>
                </Field>
                <Field label="Owner receiving PUBLIC address">
                  <input
                    disabled={!plan.isOwner}
                    value={settings.receivingAddress}
                    onChange={(e) => {
                      update("receivingAddress", e.target.value);
                      update(
                        settings.network === "testnet"
                          ? "testnetReceivingAddress"
                          : "mainnetReceivingAddress",
                        e.target.value,
                      );
                    }}
                    placeholder="G… public address; never a wallet secret"
                  />
                </Field>
              </div>
              <div className="settings-fields">
                {[
                  [
                    "proUnlimited",
                    "Owner explicitly enables unlimited Pro issue solving",
                  ],
                  ["basicResetConfirmed", "Basic reset rule confirmed"],
                  [
                    "termsConfirmed",
                    "Price, duration and renewal terms confirmed",
                  ],
                  [
                    "checkoutEnabled",
                    "Enable checkout only when all required settings are complete",
                  ],
                  [
                    "mainnetEnabled",
                    "Explicitly activate mainnet (also requires server activation)",
                  ],
                ].map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      disabled={key === "mainnetEnabled" && !plan.isOwner}
                      checked={settings[key]}
                      onChange={(e) => update(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <Field label="Required plan change reason">
                <textarea
                  required
                  minLength={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              {plan.isOwner && (
                <Field label="Current owner password (required for wallet/network activation changes)">
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              )}
              <Button type="submit" busy={busy}>
                Save plan version
              </Button>
              <Button
                variant="secondary"
                disabled={!plan.isOwner || !settings.receivingAddress || busy}
                onClick={() =>
                  void act(async () => {
                    await request("admin/wallet/validate", {
                      network: settings.network,
                      address: settings.receivingAddress,
                    });
                    setNotice(
                      "Receiving account has the correct authorized USDC trustline and capacity",
                    );
                  })
                }
              >
                Validate receiving wallet
              </Button>
              <p>
                Mainnet remains disabled unless explicitly activated by the
                owner and STELLAR_MAINNET_ACTIVATION=true is configured
                server-side.
              </p>
              <ul>
                {plan.blockers.map((b: string) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </form>
          </Panel>
        )}
        <Panel title="Invoices, payment verification and refund review">
          <Field label="Payment status filter">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {[
                "pending",
                "verified",
                "expired",
                "underpaid",
                "overpaid",
                "unmatched",
                "failed_verification",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          {!payments ? (
            <p role="status">Loading payment records…</p>
          ) : (
            <>
              <p>
                {payments.total} invoices · Page {payments.page}
              </p>
              <Button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous invoices
              </Button>
              <Button
                disabled={page * 20 >= payments.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next invoices
              </Button>
              {payments.items.map((i: any) => (
                <details
                  key={i.id}
                  style={{
                    padding: 12,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <summary>
                    {i.user.email} · {i.amount} USDC · {i.network} · {i.status}
                  </summary>
                  <p>
                    Invoice {i.id} · Plan version {i.planVersionId} ·
                    Entitlement {i.entitlementState}
                  </p>
                  <p>
                    Memo {i.memo} · Recipient {i.recipient} · Issuer {i.issuer}
                  </p>
                  <p>
                    Created {new Date(i.createdAt).toLocaleString()} · Expires{" "}
                    {new Date(i.expiresAt).toLocaleString()}
                  </p>
                  {i.payments.map((p: any) => (
                    <p key={p.id}>
                      <Badge status={p.status} />
                      {p.detail} · Operation {p.operationId} ·{" "}
                      <a
                        href={`https://stellar.expert/explorer/${p.network === "mainnet" ? "public" : "testnet"}/tx/${p.transactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Transaction
                      </a>
                    </p>
                  ))}
                  {i.submissions.map((s: any) => (
                    <p key={s.id}>
                      {s.status}: {s.error || "Verification scheduled"}
                    </p>
                  ))}
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const reason = window.prompt(
                          "Reason for controlled payment recheck",
                        );
                        if (reason) {
                          await request("admin/payments/recheck", {
                            invoiceId: i.id,
                            reason,
                          });
                          setNotice("Independent recheck queued");
                        }
                      })
                    }
                  >
                    Queue independent recheck
                  </Button>
                  <p>Refund review: {i.refundStatus}</p>
                  {i.refundStatus !== "none" &&
                    ["reviewing", "resolved", "declined"].map(
                      (refundStatus) => (
                        <Button
                          key={refundStatus}
                          variant="secondary"
                          onClick={() =>
                            void act(async () => {
                              const reason = window.prompt(
                                "Refund review reason (no outgoing transfer)",
                              );
                              if (reason) {
                                await request(`admin/refunds/${i.id}`, {
                                  status: refundStatus,
                                  reason,
                                });
                                setPayments(
                                  await request(
                                    `admin/payments?page=${page}&status=${encodeURIComponent(status)}`,
                                  ),
                                );
                                setNotice(
                                  "Refund review record updated; no funds transferred",
                                );
                              }
                            })
                          }
                        >
                          {refundStatus}
                        </Button>
                      ),
                    )}
                </details>
              ))}
              <h4>Payment watcher recovery</h4>
              {payments.watchers?.map((w: any) => (
                <p key={w.id}>
                  {w.network} · Cursor {w.cursor} · Attempts {w.attempts} ·{" "}
                  {w.error || "Watching for payments"}
                  {w.attempts >= 8
                    ? " · Paused: queue a controlled invoice recheck to resume"
                    : ""}
                </p>
              ))}
              <h4>Unmatched on-chain receipts</h4>
              {payments.unmatched.map((p: any) => (
                <p key={p.id}>
                  {p.network} · {p.amount} {p.assetCode} · {p.detail} ·{" "}
                  {p.transactionHash}
                </p>
              ))}
            </>
          )}
        </Panel>
      </details>
    </div>
  );
}
