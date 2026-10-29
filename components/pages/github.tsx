"use client";
import {
ArrowRight,
Check,
Copy,
FileCode2,
FolderGit2,
GitMerge,
LoaderCircle,
Plus,
RefreshCw,
Search,
Send,
ShieldCheck,
Sparkles,
Users,
Waves,
} from "lucide-react";
import { useState } from "react";
import {
Badge,
Button,
Diff,
Empty,
External,
Field,
Modal,
Panel,
SearchBox,
Select,
label,
request,
} from "../ui";
import type { Context } from "../workspace";
import { Identity,PageHead } from "../workspace";
export function DiscoverPage(c: Context) {
  const [repo, setRepo] = useState(""),
    [issues, setIssues] = useState<any[]>([]),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [labelFilter, setLabelFilter] = useState(""),
    [unassigned, setUnassigned] = useState(false),
    [issue, setIssue] = useState<any>(null),
    [experience, setExperience] = useState(""),
    [draft, setDraft] = useState<any>(null),
    [confirm, setConfirm] = useState(false),[analysis,setAnalysis]=useState('');
  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setIssues(
        await request(
          `discover?repo=${encodeURIComponent(repo)}&identityId=${c.identity}`,
        ),
      );
      setLoaded(true);
    } catch (e) {
      c.notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const filtered = issues.filter(
    (i) =>
      `${i.title} ${i.body} ${i.number}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!labelFilter || i.labels.includes(labelFilter)) &&
      (!unassigned || !i.assignees.length),
  );
  return (
    <>
      <PageHead
        eyebrow="FIND YOUR NEXT CONTRIBUTION"
        title="An open issue. A real opportunity."
        description="Explore live GitHub issues and find work you can move forward."
        actions={<Identity {...c} />}
      />
      <Panel
        title="Explore a repository"
        description="Enter owner/repository or paste a GitHub repository URL."
      >
        <form className="inline-form" onSubmit={search}>
          <div className="search-input">
            <FolderGit2 size={17} />
            <input
              aria-label="Repository name or URL"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="e.g. vercel/next.js"
              required
            />
          </div>
          <Button busy={busy} disabled={!c.identity}>
            <Search size={16} />
            Find issues
          </Button>
        </form>
      </Panel>
      {loaded && (
        <div className="filters">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Search issue titles and descriptions…"
          />
          <Select
            value={labelFilter}
            aria-label="Issue label"
            onChange={(e) => setLabelFilter(e.target.value)}
          >
            <option value="">All labels</option>
            {[...new Set<string>(issues.flatMap((i) => i.labels))]
              .sort()
              .map((l) => (
                <option key={l}>{l}</option>
              ))}
          </Select>
          <label className="check-label">
            <input
              type="checkbox"
              checked={unassigned}
              onChange={(e) => setUnassigned(e.target.checked)}
            />
            Unassigned only
          </label>
        </div>
      )}
      <Panel
        title={
          loaded
            ? `${filtered.length} open issues`
            : "A good fit makes all the difference."
        }
      >
        {loaded && filtered.length ? (
          <div className="issue-cards">
            {filtered.map((i) => (
              <button
                className="issue-card"
                key={i.number}
                onClick={() => {
                  setIssue(i);
                  setDraft(null);setAnalysis('');
                }}
              >
                <div>
                  <span className="issue-number">#{i.number}</span>
                  <h3>{i.title}</h3>
                  <ArrowRight size={17} />
                </div>
                <p>{i.body.slice(0, 180) || "No description provided."}</p>
                <div className="labels">
                  {i.labels.slice(0, 5).map((l: string) => (
                    <span key={l}>{l}</span>
                  ))}
                  <span className="assignee-label">
                    {i.assignees.length
                      ? `Assigned to ${i.assignees.join(", ")}`
                      : "Unassigned"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Empty
            title={
              loaded
                ? "No matching open issues."
                : "Start with a project you care about."
            }
          >
            {loaded
              ? "Try a different filter or repository."
              : "Search a repository to inspect real issues, draft your approach, and prepare a thoughtful application."}
          </Empty>
        )}
      </Panel>
      {issue && (
        <Modal
          title={`#${issue.number} ${issue.title}`}
          onClose={() => {
            setIssue(null);
            setConfirm(false);
          }}
        >
          <div className="issue-description">
            {issue.body || "No description provided."}
          </div>
          <div className="labels">
            {issue.labels.map((l: string) => (
              <span key={l}>{l}</span>
            ))}
          </div>
          <div className="action-row">
            <External href={issue.url}>View on GitHub</External>
            <Button
              variant="secondary"
              onClick={() =>
                void c
                  .act("issues/import", {
                    identityId: c.identity,
                    repo: issue.repo,
                    number: issue.number,
                  })
                  .then(() =>
                    c.notify("Issue imported. No coding run was started."),
                  )
                  .catch(() => {})
              }
            >
              <Plus size={15} />
              Add to my issues
            </Button>
          </div>
          <div className="action-row"><Button variant="secondary" busy={busy} disabled={!c.data.health.ai} onClick={async()=>{setBusy(true);try{const r=await c.act('issues/analyze',{identityId:c.identity,repo:issue.repo,number:issue.number});setAnalysis(r.analysis);}catch{}finally{setBusy(false);}}}><Sparkles size={15}/>Analyze issue</Button></div>{analysis&&<div className="issue-description" aria-label="AI issue analysis">{analysis}</div>}
          {!draft ? (
            <>
              <Field
                label="Your relevant experience"
                hint="Optional. Include only experience you can stand behind."
              >
                <textarea
                  rows={3}
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                  placeholder="What have you worked on that relates to this issue?"
                />
              </Field>
              <Button
                busy={busy}
                disabled={!c.data.health.ai}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setDraft(
                      await c.act("applications/draft", {
                        identityId: c.identity,
                        repo: issue.repo,
                        number: issue.number,
                        experience,
                      }),
                    );
                  } catch {
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Sparkles size={16} />
                Draft an approach
              </Button>
            </>
          ) : (
            <>
              <Field
                label="Your application draft"
                hint="Edit before posting. Nothing is sent automatically."
              >
                <textarea
                  rows={9}
                  value={draft.draft}
                  onChange={(e) =>
                    setDraft({ ...draft, draft: e.target.value })
                  }
                />
              </Field>
              {confirm ? (
                <div className="confirmation-box">
                  <p>
                    Post this exact draft as a public GitHub comment on{" "}
                    {issue.repo}#{issue.number}?
                  </p>
                  <Button
                    busy={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await c.act(`applications/${draft.id}/post`, {
                          draft: draft.draft,
                        });
                        setConfirm(false);
                        c.notify("Application comment posted on GitHub.");
                        setIssue(null);
                      } catch {
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Send size={15} />
                    Confirm & post
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirm(false)}>
                    Go back
                  </Button>
                </div>
              ) : (
                <div className="action-row">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(draft.draft)
                        .then(() => c.notify("Draft copied."))
                    }
                  >
                    <Copy size={15} />
                    Copy draft
                  </Button>
                  <Button onClick={() => setConfirm(true)}>
                    <Send size={15} />
                    Review & post
                  </Button>
                </div>
              )}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
export function WavePage(c: Context) {
  const [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [draft, setDraft] = useState(""),
    [languages, setLanguages] = useState<string[]>([]);
  const prepare = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = await c.act("wave/prepare", {
        identityId: c.identity,
        repo: String(f.get("repo")),
        numbers: String(f.get("numbers") ?? "")
          .split(",")
          .map(Number)
          .filter((n) => n > 0),
        experience: String(f.get("experience")),
        wave: String(f.get("wave")),
        complexity: String(f.get("complexity")),
        languages,
        count: Number(f.get("count")),
      });
      c.notify(
        `${result.applications.length} drafts prepared${result.failures.length ? `, ${result.failures.length} failed` : ""}. Matches are based on your supplied experience. Review before submitting.`,
      );
    } catch (e) {
      c.notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHead
        eyebrow="THOUGHTFUL APPLICATIONS, BETTER FIT"
        title="Make your next Wave count."
        description="Prepare an honest approach. Keep the application and identity verification in your hands."
        actions={<Identity {...c} />}
      />
      <div className="subtle-notice">
        <ShieldCheck size={17} />
        EasySolve tracks your preparation only. Counts here are not Drips’
        official application count.
      </div>
      <div className="two-column">
        <Panel
          title="Your preferences"
          description="Match issues against the experience you actually have."
        >
          <form onSubmit={prepare} className="form-stack">
            <Field label="Repository">
              <input name="repo" required placeholder="owner/repository" />
            </Field>
            <div className="form-grid">
              <Field label="Wave name (optional)">
                <input name="wave" placeholder="Label to match, e.g. Wave 12" />
              </Field>
              <Field label="Complexity">
                <Select name="complexity">
                  <option value="small">Small</option>
                  <option value="moderate">Moderate</option>
                  <option value="complex">Complex</option>
                </Select>
              </Field>
            </div>
            <Field
              label="Language preferences"
              hint="Choose up to five. Used as context for the proposed approach."
            >
              <div className="language-picker">
                {[
                  "TypeScript",
                  "JavaScript",
                  "Python",
                  "Rust",
                  "Go",
                  "Java",
                  "Solidity",
                  "C++",
                  "Ruby",
                ].map((l) => (
                  <button
                    type="button"
                    key={l}
                    className={languages.includes(l) ? "selected" : ""}
                    disabled={!languages.includes(l) && languages.length >= 5}
                    onClick={() =>
                      setLanguages((s) =>
                        s.includes(l) ? s.filter((v) => v !== l) : [...s, l],
                      )
                    }
                  >
                    {l}
                    {languages.includes(l) && <Check size={12} />}
                  </button>
                ))}
              </div>
            </Field>
            <Field
              label="Your experience"
              hint="Required for honest matching. No qualifications will be invented."
            >
              <textarea
                name="experience"
                required
                rows={4}
                placeholder="Languages, projects, and contributions you’ve actually worked on…"
              />
            </Field>
            <div className="form-grid">
              <Field label="Issues to prepare">
                <input
                  name="count"
                  type="number"
                  min={1}
                  max={5}
                  defaultValue={2}
                />
              </Field>
              <Field label="Specific issues (optional)">
                <input name="numbers" placeholder="12, 34, 56" />
              </Field>
            </div>
            <Button
              type="submit"
              busy={busy}
              disabled={!c.identity || !c.data.health.ai}
            >
              <Sparkles size={16} />
              Prepare applications
            </Button>
          </form>
        </Panel>
        <Panel
          title="Your application desk"
          description={`${c.data.applications.filter((a: any) => a.status === "pending").length} pending · ${c.data.applications.filter((a: any) => ["applied", "posted"].includes(a.status)).length} tracked as applied`}
        >
          {c.data.applications.length ? (
            c.data.applications.map((a: any) => (
              <button
                className="application-row"
                key={a.id}
                onClick={() => {
                  setSelected(a);
                  setDraft(a.draft);
                }}
              >
                <div className="row-icon">
                  <Waves size={19} />
                </div>
                <div>
                  <strong>{a.title}</strong>
                  <small>
                    {a.repo} · #{a.number}
                    {a.wave ? ` · ${a.wave}` : ""}
                  </small>
                </div>
                <Badge status={a.status} />
              </button>
            ))
          ) : (
            <Empty title="A thoughtful approach goes further.">
              Prepare your first application to review and edit it here.
              Submission on Drips stays manual.
            </Empty>
          )}
        </Panel>
      </div>
      {selected && (
        <Modal
          title={`Application · #${selected.number}`}
          onClose={() => setSelected(null)}
        >
          <Field label="Editable application">
            <textarea
              rows={12}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </Field>
          <div className="action-row">
            <Button
              variant="secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(draft)
                  .then(() => c.notify("Application copied."))
              }
            >
              <Copy size={15} />
              Copy
            </Button>
            <External
              href={`https://www.drips.network/app/projects/github/${selected.repo}`}
            >
              Open Drips
            </External>
            <External
              href={`https://github.com/${selected.repo}/issues/${selected.number}`}
            >
              GitHub issue
            </External>
          </div>
          <div className="subtle-notice">
            Submit and verify your identity on Drips manually. Marking an
            application here only updates EasySolve.
          </div>
          <div className="modal-actions">
            <Button
              variant="secondary"
              onClick={() =>
                void c
                  .act(`applications/${selected.id}`, { draft })
                  .then(() => c.notify("Draft saved."))
                  .catch(() => {})
              }
            >
              Save draft
            </Button>
            <Button
              onClick={() =>
                void c
                  .act(`applications/${selected.id}`, {
                    draft,
                    status:
                      selected.status === "applied" ? "pending" : "applied",
                  })
                  .then(() => setSelected(null))
                  .catch(() => {})
              }
            >
              {selected.status === "applied"
                ? "Mark pending"
                : "Mark applied manually"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function AssignmentsPage(c: Context) {
  const [busy, setBusy] = useState(false),
    [proposal, setProposal] = useState<any>(null),
    [confirm, setConfirm] = useState(false);
  const preview = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      setProposal(
        await c.act("assignments/propose", {
          identityId: c.identity,
          repo: f.get("repo"),
          usernames: String(f.get("usernames"))
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          numbers: String(f.get("numbers"))
            .split(/[\s,]+/)
            .map(Number)
            .filter((n) => n > 0),
          labels: f.get("labels"),
          additional: Number(f.get("additional")),
          waveOnly: f.get("waveOnly") === "on",
        }),
      );
      setConfirm(false);
    } catch {
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHead
        eyebrow="MAINTAIN WITH INTENTION"
        title="The right issue. The right contributor."
        description="Validate assignability, account for existing work, and preview every assignment."
        actions={<Identity {...c} />}
      />
      <div className="two-column">
        <Panel
          title="Build an assignment proposal"
          description={`Wave limit: ${c.data.settings.waveLimit} active assignments per contributor.`}
        >
          <form onSubmit={preview} className="form-stack">
            <Field
              label="Repository"
              hint="Use an owner or organization repository."
            >
              <input
                name="repo"
                list="managed-repos"
                required
                placeholder="organization/repository"
              />
              <datalist id="managed-repos">
                {c.data.repositories
                  .filter((r: any) => r.identityId === c.identity)
                  .map((r: any) => (
                    <option key={r.id} value={r.fullName} />
                  ))}
              </datalist>
            </Field>
            <Field label="Contributors" hint="One GitHub username per line.">
              <textarea
                name="usernames"
                required
                rows={4}
                placeholder={"octocat\ncontributor"}
              />
            </Field>
            <Field label="Issue numbers (optional)">
              <input name="numbers" placeholder="12, 34, 56" />
            </Field>
            <div className="form-grid">
              <Field label="Labels (optional)">
                <input name="labels" placeholder="good first issue" />
              </Field>
              <Field label="Additional issues per person">
                <input
                  name="additional"
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={1}
                />
              </Field>
            </div>
            <label className="check-label">
              <input name="waveOnly" type="checkbox" defaultChecked />
              Wave-labeled issues only
            </label>
            <Button type="submit" busy={busy} disabled={!c.identity}>
              <Users size={16} />
              Generate proposal
            </Button>
          </form>
        </Panel>
        <Panel
          title="Preview before you assign"
          description="No GitHub writes happen until you confirm."
        >
          {proposal ? (
            <>
              <div className="proposal-list">
                {proposal.entries.map((e: any) => (
                  <div key={`${e.number}-${e.login}`}>
                    <span className="issue-number">#{e.number}</span>
                    <div>
                      <strong>{e.title}</strong>
                      <small>
                        @{e.login} · {e.existing} existing assignments
                      </small>
                      {e.error && (
                        <small className="inline-error">{e.error}</small>
                      )}
                    </div>
                    <Badge status={e.state} />
                  </div>
                ))}
              </div>
              {confirm ? (
                <div className="confirmation-box">
                  <p>
                    Apply these assignments on {proposal.repo}? Each issue will
                    be revalidated immediately before writing.
                  </p>
                  <Button
                    busy={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const result = await c.act("assignments/apply", {
                          proposalId: proposal.id,
                        });
                        setProposal(result);
                        setConfirm(false);
                        c.notify(
                          result.state === "applied"
                            ? "All assignments applied."
                            : "Some assignments failed. Review individual results.",
                        );
                      } catch {
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Confirm GitHub assignments
                  </Button>
                </div>
              ) : (
                proposal.state !== "applied" && (
                  <div className="panel-pad">
                    <Button onClick={() => setConfirm(true)}>
                      Review & apply
                      <ArrowRight size={15} />
                    </Button>
                  </div>
                )
              )}
            </>
          ) : (
            <Empty title="A clear view before the handoff.">
              Generate a proposal to see the issue, contributor, and assignment
              limits before changing anything on GitHub.
            </Empty>
          )}
        </Panel>
      </div>
      <Panel title="Previous proposals">
        {c.data.proposals.length ? (
          c.data.proposals.map((p: any) => (
            <button
              className="work-row full-width"
              key={p.id}
              onClick={() => {
                setProposal(p);
                setConfirm(false);
              }}
            >
              <Users size={18} />
              <div>
                <strong>{p.repo}</strong>
                <small>
                  {p.entries.length} assignments ·{" "}
                  {new Date(p.createdAt).toLocaleString()}
                </small>
              </div>
              <Badge status={p.state} />
            </button>
          ))
        ) : (
          <div className="inline-empty">
            Your assignment history will appear here.
          </div>
        )}
      </Panel>
    </>
  );
}
export function ReviewPage(c: Context) {
  const [reviews, setReviews] = useState<any[]>([]),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState("needs_review"),
    [repo, setRepo] = useState(""),
    [selected, setSelected] = useState<any>(null),
    [detail, setDetail] = useState<any>(null),
    [body, setBody] = useState(""),
    [action, setAction] = useState(""),
    [checked, setChecked] = useState<string[]>([]),
    [bulk, setBulk] = useState(false),
    [results, setResults] = useState<string[]>([]);
  const sync = async () => {
    setBusy(true);
    try {
      setReviews(await request("reviews"));
      setLoaded(true);
    } catch (e) {
      c.notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const open = async (r: any) => {
    setSelected(r);
    setDetail(null);
    setAction("");
    try {
      setDetail(
        await request("reviews/detail", {
          identityId: r.identityId,
          repo: r.repo,
          number: r.number,
        }),
      );
    } catch (e) {
      c.notify((e as Error).message);
    }
  };
  const key = (r: any) => `${r.repo}#${r.number}`;
  const filtered = reviews.filter(
    (r) =>
      (tab === "all" || r.category === tab) &&
      (!repo || r.repo === repo) &&
      `${r.title} ${r.number}`.toLowerCase().includes(query.toLowerCase()),
  );
  const apply = async (r: any, a: string) =>
    request("reviews/action", {
      identityId: r.identityId,
      repo: r.repo,
      number: r.number,
      sha: r.head,
      action: a,
      body,
    });
  return (
    <>
      <PageHead
        eyebrow="HUMAN JUDGMENT, FRONT AND CENTER"
        title="The last mile deserves a closer look."
        description="Review real diffs and checks. Approvals and merges stay bound to the commit you inspected."
        actions={
          <>
            <Button variant="secondary" busy={busy} onClick={() => void sync()}>
              <RefreshCw size={16} />
              Sync pull requests
            </Button>
            <Button
              disabled={!checked.length}
              onClick={() => {
                setBulk(true);
                setResults([]);
              }}
            >
              <GitMerge size={16} />
              Review bulk merge ({checked.length})
            </Button>
          </>
        }
      />
      <div className="tabs">
        {[
          ["needs_review", "Needs review"],
          ["changes_requested", "Changes requested"],
          ["approved", "Approved"],
          ["ready", "Ready to merge"],
          ["blocked", "Blocked"],
          ["all", "All"],
        ].map(([k, t]) => (
          <button
            className={tab === k ? "active" : ""}
            key={k}
            onClick={() => setTab(k)}
          >
            {t}
            <span>
              {reviews.filter((r) => k === "all" || r.category === k).length}
            </span>
          </button>
        ))}
      </div>
      <div className="filters">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search pull requests…"
        />
        <Select
          aria-label="Repository filter"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        >
          <option value="">All repositories</option>
          {c.data.repositories.map((r: any) => (
            <option key={r.id} value={r.fullName}>
              {r.fullName}
            </option>
          ))}
        </Select>
      </div>
      <section className="panel">
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Pull request</th>
                  <th>Checks</th>
                  <th>Review state</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={key(r)}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${key(r)} for merge`}
                        disabled={r.category !== "ready"}
                        checked={checked.includes(key(r))}
                        onChange={(e) =>
                          setChecked((v) =>
                            e.target.checked
                              ? [...v, key(r)]
                              : v.filter((k) => k !== key(r)),
                          )
                        }
                      />
                    </td>
                    <td>
                      <strong>{r.title}</strong>
                      <small className="block muted">
                        {r.repo} · #{r.number} · @{r.author}
                      </small>
                    </td>
                    <td>
                      <Badge status={r.checks} />
                    </td>
                    <td>
                      <Badge status={r.category} />
                    </td>
                    <td>
                      <Button
                        variant="secondary small"
                        onClick={() => void open(r)}
                      >
                        Inspect diff
                        <ArrowRight size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={
              loaded
                ? "A clear review queue."
                : "Bring your pull requests into focus."
            }
            action={
              !loaded && (
                <Button
                  variant="secondary"
                  busy={busy}
                  onClick={() => void sync()}
                >
                  Sync managed repositories
                </Button>
              )
            }
          >
            {loaded
              ? "No pull requests match this view."
              : "Sync your managed repositories to inspect actual GitHub reviews, checks, and mergeability."}
          </Empty>
        )}
      </section>
      {selected && (
        <Modal
          title={`#${selected.number} ${selected.title}`}
          onClose={() => setSelected(null)}
        >
          <div className="action-row">
            <Badge status={selected.category} />
            <Badge status={selected.checks} />
            <External href={selected.url}>View on GitHub</External>
          </div>
          <code className="sha">
            Reviewed head: {detail?.head ?? "Loading…"}
          </code>
          {detail ? (
            detail.files.map((f: any) => (
              <details className="file-diff" key={f.filename} open>
                <summary>
                  <FileCode2 size={15} />
                  {f.filename}
                </summary>
                <Diff value={f.patch} />
              </details>
            ))
          ) : (
            <div className="loading-state">
              <LoaderCircle className="spin" />
              Loading diff…
            </div>
          )}
          <Field label="Review comment">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="What should the contributor know?"
            />
          </Field>
          {action ? (
            <div className="confirmation-box">
              <p>
                Confirm {label(action)} for commit {detail?.head?.slice(0, 12)}?
                GitHub protections remain enforced.
              </p>
              <Button
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await apply({ ...selected, head: detail.head }, action);
                    c.notify("GitHub action completed.");
                    setSelected(null);
                    await sync();
                  } catch (e) {
                    c.notify((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Confirm {label(action)}
              </Button>
              <Button variant="ghost" onClick={() => setAction("")}>
                Go back
              </Button>
            </div>
          ) : (
            <div className="action-row">
              <Button
                variant="secondary"
                disabled={!detail}
                onClick={() => setAction("changes")}
              >
                Request changes
              </Button>
              <Button disabled={!detail} onClick={() => setAction("approve")}>
                <Check size={16} />
                Approve
              </Button>
              {selected.category === "ready" && (
                <Button disabled={!detail} onClick={() => setAction("merge")}>
                  <GitMerge size={16} />
                  Merge
                </Button>
              )}
            </div>
          )}
        </Modal>
      )}
      {bulk && (
        <Modal title="Confirm bulk merge" onClose={() => setBulk(false)}>
          <p>
            Each pull request is rechecked against its reviewed SHA, approvals,
            CI, and GitHub branch protections. Partial failures are reported
            individually.
          </p>
          {reviews
            .filter((r) => checked.includes(key(r)))
            .map((r) => (
              <div className="bulk-row" key={key(r)}>
                <strong>{key(r)}</strong>
                <code>{r.head.slice(0, 12)}</code>
              </div>
            ))}
          {results.map((r, i) => (
            <p key={i}>{r}</p>
          ))}
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setBulk(false)}>
              Close
            </Button>
            <Button
              busy={busy}
              disabled={results.length > 0}
              onClick={async () => {
                setBusy(true);
                for (const r of reviews.filter((r) =>
                  checked.includes(key(r)),
                )) {
                  try {
                    await apply(r, "merge");
                    setResults((v) => [...v, `${key(r)}: merged`]);
                  } catch (e) {
                    setResults((v) => [
                      ...v,
                      `${key(r)}: ${(e as Error).message}`,
                    ]);
                  }
                }
                setChecked([]);
                setBusy(false);
                await sync();
              }}
            >
              <GitMerge size={15} />
              Confirm merges
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
