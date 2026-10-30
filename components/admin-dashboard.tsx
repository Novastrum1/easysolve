"use client";
import Link from "next/link";
import {
  BillingAdministration,
  UserEntitlementControls,
} from "./billing-admin";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, request } from "./ui";
import styles from "./admin-dashboard.module.css";

type Account = {
  id: string;
  email: string;
  name: string;
  role: string;
  suspendedAt: string | null;
  createdAt: string;
  planName: string | null;
  planMaxJobs: number | null;
  planMaxTokens: number | null;
};
type AccountDetail = Account & {
  _count: Record<string, number>;
  limits: { name: string; jobs: number; tokens: number };
  settings: { monthlyJobs: number; monthlyTokens: number };
  usage: { _sum: { total: number | null }; _count: number };
  repositories: { id: string; fullName: string; health: string }[];
};
type Job = {
  id: string;
  userId: string;
  kind: string;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  availableAt: string;
  leaseUntil: string | null;
};
type JobDetail = Job & {
  run: {
    id: string;
    repo: string;
    status: string;
    error: string | null;
    attempts: number;
  } | null;
};
type Audit = {
  id: string;
  actorId: string;
  targetId: string;
  action: string;
  reason: string;
  oldValues: unknown;
  newValues: unknown;
  details: unknown;
  createdAt: string;
};
type List<T> = { items: T[]; total: number; page: number; pageSize: number };
type Overview = {
  basicUsers: number;
  activePro: number;
  successfulSolves: number;
  verifiedRevenue: string;
  invoiceGroups: { status: string; _count: number }[];
  paymentGroups: { network: string; status: string; _count: number }[];
  users: number;
  workspaces: number;
  suspended: number;
  repositories: number;
  runs: number;
  jobs: { status: string; _count: number }[];
  usage: { _sum: { total: number | null }; _count: number };
  monthUsage: { _sum: { total: number | null }; _count: number };
  providerUsage: {
    provider: string;
    model: string;
    _sum: { total: number | null };
    _count: number;
  }[];
  provider: {
    region?: string | null;
    name?: string;
    model?: string;
    configured: boolean;
    verified: boolean;
    verifiedAt?: string | null;
    error?: string;
  };
  recentRepositories: {
    id: string;
    userId: string;
    fullName: string;
    health: string;
  }[];
};
const date = (value: string) => new Date(value).toLocaleString();
const number = (value: number | null | undefined) =>
  (value ?? 0).toLocaleString();
function Pages({
  list,
  change,
  busy,
}: {
  list: { page: number; pageSize: number; total: number };
  change: (page: number) => void;
  busy: boolean;
}) {
  return (
    <div className={styles.actions}>
      <Button
        disabled={busy || list.page <= 1}
        onClick={() => change(list.page - 1)}
      >
        Previous
      </Button>
      <span>
        Page {list.page} · {number(list.total)} results
      </span>
      <Button
        disabled={busy || list.page * list.pageSize >= list.total}
        onClick={() => change(list.page + 1)}
      >
        Next
      </Button>
    </div>
  );
}

export function AdminDashboard({ ownerName }: { ownerName: string }) {
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<List<Account> | null>(null);
  const [jobs, setJobs] = useState<List<Job> | null>(null);
  const [audit, setAudit] = useState<List<Audit> | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("failed");
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [planName, setPlanName] = useState("");
  const [planJobs, setPlanJobs] = useState("");
  const [planTokens, setPlanTokens] = useState("");
  const [reason, setReason] = useState("");
  const [deleteEmail, setDeleteEmail] = useState("");
  const [deleteReason, setDeleteReason] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const endpoint =
      tab === "overview"
        ? "overview"
        : tab === "users"
          ? `users?page=${page}&q=${encodeURIComponent(search)}`
          : tab === "jobs"
            ? `jobs?page=${page}&status=${status}`
            : `audit?page=${page}`;
    request(`admin/${endpoint}`)
      .then((data) => {
        if (!active) return;
        if (tab === "overview") setOverview(data);
        if (tab === "users") setUsers(data);
        if (tab === "jobs") setJobs(data);
        if (tab === "audit") setAudit(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, page, search, status, version]);

  const openAccount = useCallback(async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const value: AccountDetail = await request(
        `admin/users/${encodeURIComponent(id)}`,
      );
      setAccount(value);
      setDeleteEmail("");
      setDeleteReason("");
      setReason("");
      setPlanName(value.planName ?? "");
      setPlanJobs(value.planMaxJobs?.toString() ?? "");
      setPlanTokens(value.planMaxTokens?.toString() ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  async function openJob(id: string) {
    setBusy(true);
    setError("");
    try {
      setJob(await request(`admin/jobs/${encodeURIComponent(id)}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function change(path: string, body: unknown, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(`admin/${path}`, body, "POST");
      if (path.endsWith("/delete")) {
        setAccount(null);
        setDeleteEmail("");
        setDeleteReason("");
        setPage(1);
      } else if (account) {
        const value: AccountDetail = await request(
          `admin/users/${encodeURIComponent(account.id)}`,
        );
        setAccount(value);
        if (path.endsWith("/status")) setReason("");
      }
      if (job)
        setJob(await request(`admin/jobs/${encodeURIComponent(job.id)}`));
      setVersion((v) => v + 1);
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function switchTab(value: string) {
    setTab(value);
    setPage(1);
    setAccount(null);
    setJob(null);
    setError("");
    setNotice("");
  }

  return (
    <main className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>EasySolve administration</p>
          <h1>Owner dashboard</h1>
          <p>Signed in as {ownerName}. Administrative changes are recorded.</p>
        </div>
        <Link className="button" href="/overview">
          Back to workspace
        </Link>
      </header>
      <nav className={styles.actions} aria-label="Administration">
        {["overview", "users", "jobs", "audit"].map((value) => (
          <Button
            key={value}
            disabled={busy}
            aria-current={tab === value ? "page" : undefined}
            variant={tab === value ? "primary" : ""}
            onClick={() => switchTab(value)}
          >
            {value === "audit"
              ? "Audit log"
              : value[0].toUpperCase() + value.slice(1)}
          </Button>
        ))}
        <Button
          disabled={busy || loading}
          onClick={() => setVersion((v) => v + 1)}
        >
          Refresh
        </Button>
      </nav>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      <BillingAdministration />
      {loading && <p role="status">Loading administration…</p>}
      {tab === "overview" && overview && (
        <>
          <p>
            Verified mainnet revenue: {overview.verifiedRevenue} USDC · Testnet
            receipts are not revenue.
          </p>
          <p>
            {overview.paymentGroups
              ?.map((g) => `${g.network} ${g.status}: ${g._count}`)
              .join(" · ")}
          </p>
          <p>
            Invoices:{" "}
            {overview.invoiceGroups
              ?.map((g) => `${g.status}: ${g._count}`)
              .join(" · ")}
          </p>
          <section className={styles.grid} aria-label="Service summaries">
            {[
              ["Users", overview.users],
              ["Basic users", overview.basicUsers],
              ["Active EasySolve Pro", overview.activePro],
              ["Successfully solved issues", overview.successfulSolves],
              ["Workspaces", overview.workspaces],
              ["Suspended accounts", overview.suspended],
              ["Repositories", overview.repositories],
              ["Runs", overview.runs],
              ["Tokens this UTC month", overview.monthUsage._sum.total],
              ["Tokens all time", overview.usage._sum.total],
            ].map(([title, value]) => (
              <div className={styles.panel} key={title}>
                <p>{title}</p>
                <strong className={styles.metric}>
                  {number(value as number)}
                </strong>
              </div>
            ))}
          </section>
          <section className={styles.panel}>
            <h2>Provider connection health</h2>
            <p>
              {overview.provider.name ?? "Provider"} ·{" "}
              {overview.provider.model || "Model not selected"}
              {overview.provider.region && ` · ${overview.provider.region}`}
            </p>
            <p>
              {overview.provider.configured
                ? "Credential configured"
                : "Setup required"}{" "}
              ·{" "}
              {overview.provider.verified
                ? "Connection verified within 24 hours"
                : "Connection unverified"}
            </p>
            {overview.provider.verifiedAt && (
              <p>Last verified: {date(overview.provider.verifiedAt)}</p>
            )}
            {overview.provider.error && <p>{overview.provider.error}</p>}
            <p>
              Health uses existing connection receipts. Refresh makes no paid AI
              request.
            </p>
          </section>
          <section className={styles.panel}>
            <h2>Jobs</h2>
            <div className={styles.actions}>
              {overview.jobs.map((group) => (
                <span key={group.status}>
                  {group.status}: {number(group._count)}
                </span>
              ))}
            </div>
            {!overview.jobs.length && <p>No jobs recorded.</p>}
          </section>
          <section className={styles.panel}>
            <h2>Usage by provider and model</h2>
            {overview.providerUsage.length ? (
              <div className={styles.scroll}>
                <table>
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Model</th>
                      <th>Requests</th>
                      <th>Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.providerUsage.map((item) => (
                      <tr key={`${item.provider}:${item.model}`}>
                        <td>{item.provider}</td>
                        <td>{item.model}</td>
                        <td>{number(item._count)}</td>
                        <td>{number(item._sum.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No usage recorded.</p>
            )}
          </section>
          <section className={styles.panel}>
            <h2>Recent repositories</h2>
            <p>Each account currently has one personal workspace.</p>
            {overview.recentRepositories.map((repo) => (
              <div className={styles.row} key={repo.id}>
                <span>
                  {repo.fullName} · {repo.health}
                </span>
                <Button
                  disabled={busy}
                  onClick={() => {
                    switchTab("users");
                    void openAccount(repo.userId);
                  }}
                >
                  View owner
                </Button>
              </div>
            ))}
          </section>
        </>
      )}
      {tab === "users" && (
        <>
          <form
            className={styles.actions}
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setSearch(query);
            }}
          >
            <Field label="Search users">
              <input
                value={query}
                maxLength={254}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Email, name, or exact user ID"
              />
            </Field>
            <Button type="submit">Search</Button>
          </form>
          {users && (
            <section className={styles.panel}>
              <h2>Users and workspaces</h2>
              <div className={styles.scroll}>
                <table>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Access</th>
                      <th>Plan</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.items.map((u) => (
                      <tr key={u.id}>
                        <td>
                          {u.name}
                          <br />
                          {u.email}
                        </td>
                        <td>
                          {u.role} · {u.suspendedAt ? "Suspended" : "Active"}
                        </td>
                        <td>{u.planName || "Server default"}</td>
                        <td>
                          <Button
                            disabled={busy}
                            onClick={() => void openAccount(u.id)}
                          >
                            View account
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!users.items.length && <p>No matching accounts.</p>}
              <Pages list={users} change={setPage} busy={loading} />
            </section>
          )}
          {account && (
            <UserEntitlementControls
              userId={account.id}
              onSaved={() => void openAccount(account.id)}
            />
          )}
          {account && (
            <section className={styles.panel} aria-label="Account details">
              <h2>{account.name}</h2>
              <p>
                {account.email} · {account.id}
              </p>
              <p>
                {account.role} ·{" "}
                {account.suspendedAt
                  ? `Suspended ${date(account.suspendedAt)}`
                  : "Active"}{" "}
                · Joined {date(account.createdAt)}
              </p>
              <p>
                {Object.entries(account._count)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(" · ")}
              </p>
              <p>
                UTC month usage: {number(account.usage._sum.total)} tokens in{" "}
                {number(account.usage._count)} requests.
              </p>
              <p>
                Plan ceilings: {number(account.limits.jobs)} jobs and{" "}
                {number(account.limits.tokens)} tokens. Personal limits:{" "}
                {number(account.settings.monthlyJobs)} jobs and{" "}
                {number(account.settings.monthlyTokens)} tokens. The lower
                applicable limit is enforced.
              </p>
              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  void change(
                    `users/${account.id}/plan`,
                    {
                      planName: planName.trim() || null,
                      planMaxJobs: planJobs === "" ? null : Number(planJobs),
                      reason,
                      planMaxTokens:
                        planTokens === "" ? null : Number(planTokens),
                    },
                    "Plan limits updated.",
                  );
                }}
              >
                <h3>Plan and usage ceilings</h3>
                <p>
                  Leave a field blank to inherit its server default. Zero
                  disables new jobs or AI usage. Existing usage is retained.
                </p>
                <Field label="Plan name">
                  <input
                    value={planName}
                    maxLength={80}
                    onChange={(e) => setPlanName(e.target.value)}
                  />
                </Field>
                <Field label="Monthly plan job limit">
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    step="1"
                    value={planJobs}
                    onChange={(e) => setPlanJobs(e.target.value)}
                  />
                </Field>
                <Field label="Monthly plan token limit">
                  <input
                    type="number"
                    min="0"
                    max="2000000000"
                    step="1"
                    value={planTokens}
                    onChange={(e) => setPlanTokens(e.target.value)}
                  />
                </Field>
                <Field label="Budget change reason">
                  <input
                    required
                    minLength={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <Button type="submit" busy={busy}>
                  Save plan limits
                </Button>
              </form>
              {account.role !== "ADMIN" && (
                <form
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (
                      window.confirm(
                        `${account.suspendedAt ? "Reactivate" : "Suspend"} ${account.email}?${account.suspendedAt ? " Cancelled jobs remain cancelled." : " Sessions will be revoked and active jobs cancelled."}`,
                      )
                    )
                      void change(
                        `users/${account.id}/status`,
                        { suspended: !account.suspendedAt, reason },
                        account.suspendedAt
                          ? "Account reactivated."
                          : "Account suspended.",
                      );
                  }}
                >
                  <h3>Account access</h3>
                  <Field label="Reason for account access change">
                    <input
                      required
                      minLength={3}
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" busy={busy}>
                    {account.suspendedAt
                      ? "Reactivate account"
                      : "Suspend account"}
                  </Button>
                </form>
              )}
              {account.role !== "ADMIN" && (
                <form
                  className={styles.form}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (deleteEmail !== account.email) return;
                    if (
                      window.confirm(
                        `Permanently delete ${account.email} and their workspace data? This cannot be undone. On-chain payment receipts and audit history will be retained. GitHub repositories and pull requests will remain on GitHub.`,
                      )
                    )
                      void change(
                        `users/${account.id}/delete`,
                        { email: deleteEmail, reason: deleteReason },
                        "User and workspace deleted.",
                      );
                  }}
                >
                  <h3>Delete user</h3>
                  <p>
                    Permanently removes this account, sessions, connected
                    credentials and workspace data. Active work must stop first.
                    Payment receipts and audit history are retained.
                  </p>
                  <Field label="Email to confirm user deletion">
                    <input
                      required
                      autoComplete="off"
                      value={deleteEmail}
                      onChange={(event) => setDeleteEmail(event.target.value)}
                      placeholder={account.email}
                    />
                  </Field>
                  <Field label="Reason for user deletion">
                    <input
                      required
                      minLength={3}
                      maxLength={500}
                      value={deleteReason}
                      onChange={(event) => setDeleteReason(event.target.value)}
                    />
                  </Field>
                  <Button
                    type="submit"
                    busy={busy}
                    disabled={
                      busy ||
                      deleteEmail !== account.email ||
                      deleteReason.trim().length < 3
                    }
                  >
                    Delete user permanently
                  </Button>
                </form>
              )}
              <h3>Recent repositories</h3>
              {account.repositories.map((r) => (
                <p key={r.id}>
                  {r.fullName} · {r.health}
                </p>
              ))}
            </section>
          )}
        </>
      )}
      {tab === "jobs" && (
        <>
          <Field label="Job status">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
                setJob(null);
              }}
            >
              <option value="">All jobs</option>
              {["failed", "queued", "running", "completed", "cancelled"].map(
                (s) => (
                  <option key={s}>{s}</option>
                ),
              )}
            </select>
          </Field>
          {jobs && (
            <section className={styles.panel}>
              <h2>Background jobs</h2>
              <div className={styles.scroll}>
                <table>
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Account ID</th>
                      <th>Status</th>
                      <th>Attempts</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.items.map((j) => (
                      <tr key={j.id}>
                        <td>
                          {j.kind}
                          <br />
                          <code>{j.id}</code>
                        </td>
                        <td>
                          <code>{j.userId}</code>
                        </td>
                        <td>
                          <Badge status={j.status} />
                        </td>
                        <td>{j.attempts}</td>
                        <td>
                          <Button
                            disabled={busy}
                            onClick={() => void openJob(j.id)}
                          >
                            Inspect job
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!jobs.items.length && <p>No matching jobs.</p>}
              <Pages list={jobs} change={setPage} busy={loading} />
            </section>
          )}
          {job && (
            <section className={styles.panel} aria-label="Job details">
              <h2>Job inspection</h2>
              <p>
                {job.id} · {job.kind} · {job.status}
              </p>
              <p>
                Owner: {job.userId} · Attempts: {job.attempts}
              </p>
              <p>
                Created {date(job.createdAt)} · Available{" "}
                {date(job.availableAt)}
              </p>
              {job.leaseUntil && (
                <p>Worker lease until {date(job.leaseUntil)}</p>
              )}
              <pre>{job.error || "No error recorded."}</pre>
              {job.run && (
                <>
                  <h3>Associated run</h3>
                  <p>
                    {job.run.repo} · {job.run.id} · {job.run.status}
                  </p>
                  <pre>{job.run.error || "No run error recorded."}</pre>
                </>
              )}
              <p>
                Cancellation is cooperative. An operation already sent to an
                external service may finish. Retrying publication requires the
                user's current patch approval.
              </p>
              <div className={styles.actions}>
                {["queued", "running", "failed"].includes(job.status) && (
                  <Button
                    busy={busy}
                    onClick={() => {
                      if (window.confirm(`Cancel job ${job.id}?`))
                        void change(
                          `jobs/${job.id}/cancel`,
                          {},
                          "Job cancellation recorded.",
                        );
                    }}
                  >
                    Cancel job
                  </Button>
                )}
                {["failed", "cancelled"].includes(job.status) && (
                  <Button
                    busy={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Retry job ${job.id}? This can consume tokens or repeat an approved external action.`,
                        )
                      )
                        void change(
                          `jobs/${job.id}/retry`,
                          {},
                          "Job queued for retry.",
                        );
                    }}
                  >
                    Retry job
                  </Button>
                )}
              </div>
            </section>
          )}
        </>
      )}
      {tab === "audit" && audit && (
        <section className={styles.panel}>
          <h2>Administrative audit log</h2>
          <p>
            Mutation records are written in the same transaction as the change.
            This interface cannot edit or delete them.
          </p>
          <div className={styles.scroll}>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Actor / target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {audit.items.map((entry) => (
                  <tr key={entry.id}>
                    <td>{date(entry.createdAt)}</td>
                    <td>{entry.action}</td>
                    <td>
                      <code>
                        {entry.actorId}
                        <br />
                        {entry.targetId}
                      </code>
                    </td>
                    <td>
                      <details>
                        <summary>View change details</summary>
                        <pre>
                          {JSON.stringify(
                            {
                              reason: entry.reason,
                              oldValues: entry.oldValues,
                              newValues: entry.newValues,
                              details: entry.details,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!audit.items.length && <p>No administrative actions recorded.</p>}
          <Pages list={audit} change={setPage} busy={loading} />
        </section>
      )}
    </main>
  );
}
