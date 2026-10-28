"use client";
import { Activity,RefreshCw,Users } from "lucide-react";
import { Badge,Button,Empty,External,Panel } from "../ui";
import type { Context } from "../workspace";
export function MaintainerDetails(c: Context) {
  const repos = c.data.repositories;
  const synced = repos.filter((r: any) => r.stats?.updatedAt);
  const totals = (key: string) =>
    synced.reduce((n: number, r: any) => n + (r.stats[key] ?? 0), 0);
  const contributors = new Map<string, number>();
  for (const r of synced)
    for (const person of r.stats.contributors ?? [])
      contributors.set(
        person.login,
        (contributors.get(person.login) ?? 0) + person.contributions,
      );
  return (
    <>
      <div className="stat-grid">
        {[
          ["Open repository issues", "openIssues"],
          ["Assigned repository issues", "assignedIssues"],
          ["Open pull requests", "openPRs"],
          ["Merged pull requests", "mergedPRs"],
        ].map(([caption, key]) => (
          <div className="stat-card" key={key}>
            <div>
              <span>{caption}</span>
              <Activity size={16} />
            </div>
            <strong>{synced.length ? totals(key) : "—"}</strong>
            <small>
              {synced.length
                ? `${synced.length} repositories synced`
                : "Sync repository health to load"}
            </small>
          </div>
        ))}
      </div>
      <div className="two-column">
        <Panel
          title="Repository health"
          description="Live snapshots of issues, assignments, and PR activity."
        >
          {repos.length ? (
            repos.map((r: any) => (
              <div className="work-row" key={r.id}>
                <div>
                  <strong>{r.fullName}</strong>
                  <small>
                    {r.stats?.updatedAt
                      ? `Synced ${new Date(r.stats.updatedAt).toLocaleString()}`
                      : "Health has not been synced yet"}
                  </small>
                </div>
                <Badge status={r.health} />
                <Button
                  variant="secondary small"
                  onClick={() =>
                    void c
                      .act(`repositories/${r.id}/sync`, {})
                      .then((r) => c.notify(r.message))
                      .catch(() => {})
                  }
                >
                  <RefreshCw size={13} />
                  Sync
                </Button>
              </div>
            ))
          ) : (
            <Empty
              title="Connect your first repository."
              action={
                <a className="button secondary" href="/repositories">
                  Add repository
                </a>
              }
            >
              Management permission is verified before onboarding.
            </Empty>
          )}
        </Panel>
        <Panel
          title="Contributor activity"
          description="Commit contributions from GitHub’s top contributors per repository."
        >
          {contributors.size ? (
            [...contributors]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map(([login, count]) => (
                <div className="work-row" key={login}>
                  <Users size={17} />
                  <div>
                    <External href={`https://github.com/${login}`}>
                      @{login}
                    </External>
                  </div>
                  <span className="muted mono">
                    {count.toLocaleString()} commits
                  </span>
                </div>
              ))
          ) : (
            <Empty title="People make projects move.">
              Sync repository health to see verified contributor activity.
            </Empty>
          )}
        </Panel>
      </div>
      <Panel
        title="Recent pull requests"
        action={<a href="/reviews">Open review queue</a>}
      >
        {synced
          .flatMap((r: any) =>
            (r.stats.recentPRs ?? []).map((p: any) => ({
              ...p,
              repo: r.fullName,
            })),
          )
          .slice(0, 12)
          .map((p: any) => (
            <div className="work-row" key={`${p.repo}#${p.number}`}>
              <div>
                <External href={p.url}>
                  <strong>{p.title}</strong>
                </External>
                <small>
                  {p.repo} · #{p.number} · @{p.author}
                </small>
              </div>
              <Badge status={p.state} />
            </div>
          ))}
        {!synced.length && (
          <div className="inline-empty">
            Sync your repositories to load PR activity.
          </div>
        )}
      </Panel>
    </>
  );
}
