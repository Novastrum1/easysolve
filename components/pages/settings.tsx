"use client";
import {
  ArrowRight,
  CreditCard,
  FolderGit2,
  Github,
  KeyRound,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Zap,
} from "lucide-react";
import { useState } from "react";
import {
  Badge,
  Button,
  Empty,
  External,
  Field,
  Modal,
  Panel,
  label,
} from "../ui";
import type { Context } from "../workspace";
import { Identity, PageHead } from "../workspace";
export function RepositoriesPage(c: Context) {
  const [repo, setRepo] = useState(""),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState<any>(null);
  return (
    <>
      <PageHead
        eyebrow="YOUR PROJECTS, CONNECTED"
        title="A considered home for your repositories."
        description="Manage contributions across projects without giving up control."
      />
      <Panel
        title="Connect a repository"
        description="EasySolve verifies your admin or maintain permission on the server."
      >
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await c.act("repositories", { repo, identityId: c.identity });
              setRepo("");
              c.notify("Repository connected. Management permission verified.");
            } catch {
            } finally {
              setBusy(false);
            }
          }}
        >
          <Identity {...c} />
          <input
            aria-label="Repository name or GitHub URL"
            required
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repository or GitHub URL"
          />
          <Button type="submit" busy={busy} disabled={!c.identity}>
            <Plus size={16} />
            Connect repository
          </Button>
        </form>
      </Panel>
      {c.data.identities.map((identity: any) => {
        const repos = c.data.repositories.filter(
          (r: any) => r.identityId === identity.id,
        );
        return repos.length ? (
          <Panel
            key={identity.id}
            title={`@${identity.login}`}
            description={`${repos.length} managed repositories`}
          >
            {repos.map((r: any) => (
              <div className="repository-row" key={r.id}>
                <div className="row-icon">
                  <FolderGit2 size={21} />
                </div>
                <div>
                  <External href={`https://github.com/${r.fullName}`}>
                    <strong>{r.fullName}</strong>
                  </External>
                  <small>
                    {
                      c.data.issues.filter(
                        (i: any) => i.repo === r.fullName && i.state === "open",
                      ).length
                    }{" "}
                    synced open issues ·{" "}
                    {
                      c.data.runs.filter(
                        (run: any) => run.repo === r.fullName && run.prUrl,
                      ).length
                    }{" "}
                    agent PRs · {r.defaultBranch}
                  </small>
                </div>
                <Button
                  variant="secondary small"
                  onClick={() =>
                    void c
                      .act(`repositories/${r.id}/sync`, {})
                      .then((r) => c.notify(r.message))
                      .catch(() => {})
                  }
                >
                  <RefreshCw size={14} />
                  Sync health
                </Button>
                <Badge status={r.health} />
                <button
                  className="icon-button"
                  title="Remove from EasySolve"
                  aria-label={`Remove ${r.fullName} from EasySolve`}
                  onClick={() => setRemove(r)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </Panel>
        ) : null;
      })}
      {!c.data.repositories.length && (
        <Panel title="Your project portfolio">
          <Empty title="Bring your first project on board.">
            Connect a repository to sync pull requests, coordinate assignments,
            and review contributions.
          </Empty>
        </Panel>
      )}
      <div className="subtle-notice">
        <ShieldCheck size={16} />
        High-risk automation is disabled. Repository removal only disconnects
        EasySolve.
      </div>
      {remove && (
        <Modal title="Disconnect repository?" onClose={() => setRemove(null)}>
          <p>
            Remove {remove.fullName} from EasySolve? Your GitHub repository and
            its contents remain in place.
          </p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setRemove(null)}>
              Keep connected
            </Button>
            <Button
              onClick={() =>
                void c
                  .act(`repositories/${remove.id}`, {}, "DELETE")
                  .then(() => setRemove(null))
                  .catch(() => {})
              }
            >
              Disconnect
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function UsagePage(c: Context) {
  const u = c.data.usage;
  const sum = (key: string) => u.reduce((n: number, v: any) => n + v[key], 0);
  const config = c.data.settings;
  const cost = u.reduce(
    (n: number, v: any) =>
      n +
      (v.provider === "openai"
        ? ((v.input - v.cached) * config.inputPrice +
            v.cached * config.cachedPrice +
            v.output * config.outputPrice) /
          1000000
        : 0),
    0,
  );
  const days = Array.from({ length: new Date().getUTCDate() }, (_, i) => {
    const date = new Date();
    date.setUTCDate(i + 1);
    return {
      day: i + 1,
      total: u
        .filter((v: any) => new Date(v.createdAt).getUTCDate() === i + 1)
        .reduce((n: number, v: any) => n + v.total, 0),
    };
  });
  const max = Math.max(1, ...days.map((d) => d.total));
  return (
    <>
      <PageHead
        eyebrow="EVERY TOKEN, ACCOUNTED FOR"
        title="A clear view of your AI usage."
        description="Actual provider-reported tokens. Transparent estimates. Your allowance, under your control."
      />
      <div className="stat-grid">
        {[
          ["Input tokens", sum("input")],
          ["Cached input", sum("cached")],
          ["Output tokens", sum("output")],
          ["Total tokens", sum("total")],
        ].map(([t, n]) => (
          <div className="stat-card" key={t}>
            <div>
              <span>{t}</span>
              <Zap size={17} />
            </div>
            <strong>{Number(n).toLocaleString()}</strong>
            <small>This calendar month · UTC</small>
          </div>
        ))}
      </div>
      <div className="two-column">
        <Panel
          title="Daily token usage"
          description="Actual requests recorded this month."
        >
          <div
            className="usage-chart"
            role="img"
            aria-label={`Daily usage: ${days.map((d) => `${d.day}: ${d.total}`).join(", ")}`}
          >
            {days.map((d) => (
              <div
                key={d.day}
                title={`Day ${d.day}: ${d.total.toLocaleString()} tokens`}
              >
                <span style={{ height: `${(d.total / max) * 145 + 2}px` }} />
                <small>{d.day % 5 === 0 || d.day === 1 ? d.day : ""}</small>
              </div>
            ))}
          </div>
        </Panel>
        <Panel
          title="Monthly allowance"
          description={`User allowance resets ${new Date(c.data.allowance.reset).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`}
        >
          <div className="allowance">
            <strong>
              {c.data.allowance.total.toLocaleString()}
              <span>
                {" "}
                /{" "}
                {Math.min(
                  config.monthlyTokens,
                  c.data.limits.tokens,
                ).toLocaleString()}
              </span>
            </strong>
            <progress
              max={Math.min(config.monthlyTokens, c.data.limits.tokens)}
              value={c.data.allowance.total}
            />
            <p>
              When the allowance is exhausted, agent jobs wait in the queue
              until the next reset.
            </p>
            <div>
              <span>Requests</span>
              <strong>{u.length}</strong>
            </div>
            <div>
              <span>Direct OpenAI estimate</span>
              <strong>
                {config.inputPrice || config.outputPrice
                  ? `$${cost.toFixed(4)}`
                  : "Pricing not configured"}
              </strong>
            </div>
            <small>
              Estimate covers OpenAI records only at your configured prices per
              million tokens; it is not an invoice.
            </small>
          </div>
        </Panel>
      </div>
      <p className="muted">
        Reasoning tokens: {sum("reasoning").toLocaleString()} · Included in
        output tokens, never added twice.
      </p>
      <Panel title="Usage by purpose">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Purpose</th>
                <th>Requests</th>
                <th>Input</th>
                <th>Cached</th>
                <th>Output</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {[...new Set<string>(u.map((v: any) => v.purpose))].map((p) => {
                const rows = u.filter((v: any) => v.purpose === p);
                return (
                  <tr key={p}>
                    <td>{label(p)}</td>
                    <td>{rows.length}</td>
                    {["input", "cached", "output", "total"].map((k) => (
                      <td key={k}>
                        {rows
                          .reduce((n: number, v: any) => n + v[k], 0)
                          .toLocaleString()}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!u.length && (
          <div className="inline-empty">
            No AI requests recorded this month.
          </div>
        )}
      </Panel>
    </>
  );
}
export function SettingsPage(c: Context) {
  const [config, setConfig] = useState(c.data.settings),
    [busy, setBusy] = useState(false);
  const update = (key: string, value: any) =>
    setConfig((s: any) => ({ ...s, [key]: value }));
  return (
    <>
      <PageHead
        eyebrow="YOUR AGENT, YOUR RULES"
        title="Set the pace. Keep control."
        description="These settings are persisted and enforced by backend services."
        actions={
          <Button
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await c.act("settings", config);
                c.notify("Run settings saved.");
              } catch {
              } finally {
                setBusy(false);
              }
            }}
          >
            <Save size={16} />
            Save settings
          </Button>
        }
      />
      <Panel
        title="Publication policy"
        description="Choose what happens after an agent prepares a patch."
      >
        <div className="radio-cards">
          {[
            [
              "approval",
              "Review before publishing",
              "Default. Approve the exact patch before any commit, branch, or pull request.",
            ],
            [
              "automatic",
              "Publish explicitly started runs",
              "Allow explicitly started runs to create a draft pull request automatically.",
            ],
            [
              "plan",
              "Plan only",
              "Inspect repository context and propose a plan. No code or GitHub changes.",
            ],
          ].map(([value, title, description]) => (
            <label
              className={config.mode === value ? "selected" : ""}
              key={value}
            >
              <input
                type="radio"
                name="mode"
                value={value}
                checked={config.mode === value}
                onChange={() => update("mode", value)}
              />
              <div>
                <strong>{title}</strong>
                <p>{description}</p>
              </div>
              {value === "approval" && (
                <span className="default-tag">Recommended</span>
              )}
            </label>
          ))}
        </div>
      </Panel>
      <div className="two-column">
        <Panel title="Synchronization & assignments">
          <div className="settings-fields">
            <label className="toggle-row">
              <div>
                <strong>Automatic issue sync</strong>
                <p>
                  Sync all active identities every 15 minutes, with the browser
                  closed.
                </p>
              </div>
              <input
                type="checkbox"
                role="switch"
                checked={config.autosync}
                onChange={(e) => update("autosync", e.target.checked)}
              />
            </label>
            <Field
              label="Wave assignment limit"
              hint="Existing assignments count toward this limit."
            >
              <input
                type="number"
                min={1}
                max={100}
                value={config.waveLimit}
                onChange={(e) => update("waveLimit", Number(e.target.value))}
              />
            </Field>
            <a href="/account" className="external">
              Manage active identities
              <ArrowRight size={14} />
            </a>
          </div>
        </Panel>
        <Panel title="Usage & estimated pricing">
          <div className="settings-fields form-grid">
            {[
              ["monthlyTokens", "Monthly token allowance", 1000],
              ["monthlyJobs", "Monthly jobs", 1],
              ["resetDay", "Allowance reset day (UTC, 1–28)", 1],
              ["resetHour", "Allowance reset hour (UTC, 0–23)", 0],
              ["inputPrice", "Input / 1M tokens ($)", 0],
              ["cachedPrice", "Cached / 1M tokens ($)", 0],
              ["outputPrice", "Output / 1M tokens ($)", 0],
            ].map(([key, title, min]) => (
              <Field key={key} label={String(title)}>
                <input
                  type="number"
                  min={Number(min)}
                  step={String(key).includes("Price") ? "0.01" : "1"}
                  value={config[key]}
                  onChange={(e) => update(String(key), Number(e.target.value))}
                />
              </Field>
            ))}
            <small className="muted">
              Plan entitlements cap your configured limits. Enter model pricing
              from your provider contract.
            </small>
          </div>
        </Panel>
      </div>
    </>
  );
}
export function AccountPage(c: Context) {
  const [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [disconnect, setDisconnect] = useState<any>(null),
    [name, setName] = useState(c.data.user.name),
    [testingProvider, setTestingProvider] = useState(false);
  return (
    <>
      <PageHead
        eyebrow="THE PERSON BEHIND THE CONTRIBUTION"
        title="Your account. Your identities."
        description="A private workspace with clear control over every connected credential."
      />
      <div className="two-column">
        <Panel title="Profile">
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              await c
                .act("profile", { name })
                .then(() => c.notify("Profile updated."))
                .catch(() => {});
            }}
          >
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={80}
              />
            </Field>
            <Field label="Email">
              <input readOnly value={c.data.user.email} />
            </Field>
            <Button type="submit" variant="secondary">
              <Save size={15} />
              Save profile
            </Button>
          </form>
        </Panel>
        <Panel
          title={`${c.data.health.provider.name} connection`}
          description="API keys are configured on the server, never sent to the browser."
        >
          <div className="connection-large">
            <div className="row-icon emerald">
              <Zap size={22} />
            </div>
            <div>
              <strong>
                {c.data.health.provider.name} ·{" "}
                {c.data.health.provider.modelName || "Model selection required"}
              </strong>
              <Badge
                status={
                  c.data.health.provider.verified
                    ? "connection_verified"
                    : c.data.health.ai
                      ? "configured"
                      : "setup_required"
                }
              />
            </div>
          </div>
          <p className="muted">
            {c.data.health.provider.verified
              ? `Connection verified ${new Date(c.data.health.provider.verifiedAt).toLocaleString()}`
              : "Connection not verified. Configuration alone does not confirm model access."}
          </p>
          {c.data.user.providerAdmin && (
            <Button
              variant="secondary"
              busy={testingProvider}
              onClick={async () => {
                setTestingProvider(true);
                try {
                  await c.act("provider/test", {});
                } catch {
                  await c.refresh();
                } finally {
                  setTestingProvider(false);
                }
              }}
            >
              Test {c.data.health.provider.name} connection
            </Button>
          )}
          {!c.data.health.ai && (
            <div className="settings-fields">
              <p className="muted">
                Ask your operator to configure the selected provider’s API key
                and model in the server environment, then restart the app and
                worker.
              </p>
            </div>
          )}
        </Panel>
      </div>
      <Panel
        title="GitHub identities"
        description="Connect multiple accounts. Existing tokens are encrypted and can never be retrieved here."
      >
        <div className="identities-list">
          {c.data.identities.map((i: any) => (
            <div className="identity-row" key={i.id}>
              <div className="row-icon">
                <Github size={21} />
              </div>
              <div>
                <strong>@{i.login}</strong>
                <small>
                  {i.syncedAt
                    ? `Last synced ${new Date(i.syncedAt).toLocaleString()}`
                    : "Not synced yet"}
                </small>
              </div>
              <Badge status={i.status} />
              <Button
                variant="secondary small"
                onClick={() =>
                  void c
                    .act(`identities/${i.id}/validate`, {})
                    .then(() => c.notify("Credential validated."))
                    .catch(() => {})
                }
              >
                Validate
              </Button>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={i.active}
                  onChange={(e) =>
                    void c
                      .act(
                        `identities/${i.id}`,
                        { active: e.target.checked },
                        "PATCH",
                      )
                      .catch(() => {})
                  }
                />
                Active
              </label>
              <button
                className="icon-button"
                title="Disconnect identity"
                aria-label={`Disconnect ${i.login}`}
                onClick={() => setDisconnect(i)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <form
          className="token-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await c.act("identities", { token });
              setToken("");
              c.notify("GitHub identity connected and validated.");
            } catch {
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            label="Add or replace a GitHub token"
            hint="Use a fine-grained token with access only to the repositories you need. Required permissions are documented in README."
          >
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              placeholder="Paste a new GitHub personal access token"
            />
          </Field>
          <Button busy={busy} disabled={!c.data.health.encryption}>
            <KeyRound size={16} />
            Connect identity
          </Button>
          {!c.data.health.encryption && (
            <p className="inline-error">
              Server encryption key is required before tokens can be stored.
            </p>
          )}
        </form>
      </Panel>
      <div className="two-column">
        <Panel title="Change password">
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const form = e.currentTarget;
              try {
                await c.act("password", {
                  current: f.get("current"),
                  password: f.get("password"),
                });
                form.reset();
                c.notify("Password changed. Other sessions have been revoked.");
              } catch {}
            }}
          >
            <Field label="Current password">
              <input
                type="password"
                name="current"
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label="New password">
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                minLength={12}
                required
              />
            </Field>
            <Button variant="secondary" type="submit">
              <LockKeyhole size={15} />
              Update password
            </Button>
          </form>
        </Panel>
        <Panel title="Session security">
          <div className="settings-fields">
            <ShieldCheck size={28} className="emerald-text" />
            <h3>A fresh start for your sessions.</h3>
            <p className="muted">
              Revoke all other sessions. Your current browser gets a new secure
              session.
            </p>
            <Button
              variant="secondary"
              onClick={() =>
                void c
                  .act("sessions/revoke", {})
                  .then(() => c.notify("Other sessions revoked."))
                  .catch(() => {})
              }
            >
              Revoke other sessions
            </Button>
          </div>
        </Panel>
      </div>
      {disconnect && (
        <Modal
          title={`Disconnect @${disconnect.login}?`}
          onClose={() => setDisconnect(null)}
        >
          <p>
            The encrypted token will be deleted from EasySolve. Revoke the token
            on GitHub as well if you no longer need it.
          </p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setDisconnect(null)}>
              Keep connected
            </Button>
            <Button
              onClick={() =>
                void c
                  .act(`identities/${disconnect.id}`, {}, "DELETE")
                  .then(() => setDisconnect(null))
                  .catch(() => {})
              }
            >
              Disconnect identity
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function BillingPage(c: Context) {
  const tokens = c.data.usage.reduce((n: number, u: any) => n + u.total, 0);
  const jobs = c.data.runs.filter(
    (r: any) =>
      new Date(r.createdAt) >=
      new Date(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  ).length;
  return (
    <>
      <PageHead
        eyebrow="ROOM FOR YOUR NEXT GOOD IDEA"
        title="A plan that’s clear about its limits."
        description="Your workspace’s current entitlements and actual monthly usage."
      />
      <div className="two-column">
        <Panel
          title={`${c.data.plan} plan`}
          description="Self-hosted workspace"
        >
          <div className="plan-detail">
            <div className="row-icon emerald">
              <CreditCard size={24} />
            </div>
            <h2>Your infrastructure. Your control.</h2>
            <p>
              No payment provider is configured. This installation does not
              collect payments or create subscriptions.
            </p>
            <Badge status="active" />
          </div>
        </Panel>
        <Panel
          title="This month"
          description={`Resets ${new Date(c.data.limits.reset).toLocaleDateString()} UTC`}
        >
          <div className="allowance">
            <div>
              <span>Jobs started</span>
              <strong>
                {jobs} /{" "}
                {Math.min(c.data.settings.monthlyJobs, c.data.limits.jobs)}
              </strong>
            </div>
            <progress
              value={jobs}
              max={Math.min(c.data.settings.monthlyJobs, c.data.limits.jobs)}
            />
            <div>
              <span>Actual AI tokens</span>
              <strong>
                {tokens.toLocaleString()} /{" "}
                {Math.min(
                  c.data.settings.monthlyTokens,
                  c.data.limits.tokens,
                ).toLocaleString()}
              </strong>
            </div>
            <progress
              value={tokens}
              max={Math.min(
                c.data.settings.monthlyTokens,
                c.data.limits.tokens,
              )}
            />
            <p>
              Job limits are enforced before creation. Token allowance
              exhaustion queues background work until reset.
            </p>
            <a className="external" href="/usage">
              Inspect AI usage
              <ArrowRight size={14} />
            </a>
          </div>
        </Panel>
      </div>
      <div className="subtle-notice">
        <ShieldCheck size={17} />
        Operators configure plan ceilings with PLAN_MAX_JOBS and
        PLAN_MAX_TOKENS. User settings can lower these limits.
      </div>
    </>
  );
}
