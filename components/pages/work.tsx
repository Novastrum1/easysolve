"use client";
import {
  ArrowRight,
  ArrowUp,
  Check,
  Clock,
  FileCode2,
  GitBranch,
  GitPullRequest,
  ListChecks,
  LoaderCircle,
  Mic,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { Identity, PageHead } from "../workspace";
export function ChatPage(c: Context) {
  const [conversation, setConversation] = useState("default");
  const messages = c.data.messages.filter(
    (m: any) => m.conversation === conversation,
  );
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [dictating, setDictating] = useState(false),
    [voiceError, setVoiceError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const recognition = useRef<any>(null);
  useEffect(
    () => end.current?.scrollIntoView({ behavior: "smooth" }),
    [c.data.messages.length],
  );
  const send = async (prompt = text) => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setText("");
    try {
      await c.act("chat", {
        text: prompt,
        identityId: c.identity,
        conversation,
      });
    } catch {
      setText(prompt);
    } finally {
      setBusy(false);
    }
  };
  const dictate = () => {
    if (dictating) {
      recognition.current?.stop();
      setDictating(false);
      return;
    }
    const Speech =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!Speech) {
      setVoiceError(
        "Voice dictation is unavailable in this browser. You can type and edit your message below.",
      );
      return;
    }
    const r = new Speech();
    recognition.current = r;
    r.lang = "en-US";
    r.interimResults = false;
    r.onresult = (e: any) =>
      setText((t) => `${t} ${e.results[0][0].transcript}`.trim());
    r.onerror = () => {
      setVoiceError("Microphone unavailable. Check browser permissions.");
      setDictating(false);
    };
    r.onend = () => setDictating(false);
    r.start();
    setDictating(true);
  };
  return (
    <div className="chat-page">
      <PageHead
        eyebrow="A THOUGHTFUL PAIR OF HANDS"
        title="A little direction goes a long way."
        description="Talk through an issue, find your next task, or move work forward."
        actions={
          <>
            <Identity {...c} />
            <Button
              variant="secondary"
              onClick={() => setConversation(crypto.randomUUID())}
            >
              <Plus size={15} />
              New chat
            </Button>
          </>
        }
      />
      <div className="chat-history">
        <Select
          aria-label="Conversation"
          value={conversation}
          onChange={(e) => setConversation(e.target.value)}
        >
          {[
            ...new Set<string>([
              "default",
              conversation,
              ...c.data.messages.map((m: any) => m.conversation),
            ]),
          ].map((id) => (
            <option key={id} value={id}>
              {c.data.messages
                .find((m: any) => m.conversation === id && m.role === "user")
                ?.content.slice(0, 50) ?? "New conversation"}
            </option>
          ))}
        </Select>
      </div>
      <div className="chat-content">
        {!messages.length ? (
          <div className="chat-welcome">
            <div className="ai-mark">
              <Sparkles size={29} />
            </div>
            <h2>What should we solve today?</h2>
            <p>Your issues, runs, and pull requests. One conversation.</p>
            <div className="prompt-grid">
              {[
                [
                  ListChecks,
                  "Find my next issue",
                  "Which of my issues are ready to solve?",
                ],
                [
                  Terminal,
                  "Check on my runs",
                  "Check the status of my active coding runs.",
                ],
                [
                  GitPullRequest,
                  "Get ready to review",
                  "Which completed runs have a pull request or need my review?",
                ],
                [
                  ShieldCheck,
                  "Make sense of the workflow",
                  "How do I go from an assigned issue to a reviewed pull request?",
                ],
              ].map(([Icon, title, prompt]: any) => (
                <button key={title} onClick={() => void send(prompt)}>
                  <Icon size={20} />
                  <strong>{title}</strong>
                  <span>{prompt}</span>
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages">
            {messages.map((m: any) => (
              <article className={`message ${m.role}`} key={m.id}>
                <div className="message-avatar">
                  {m.role === "assistant" ? (
                    <Sparkles size={18} />
                  ) : (
                    c.data.user.name[0]
                  )}
                </div>
                <div>
                  <div className="message-author">
                    {m.role === "assistant" ? "EasySolve" : c.data.user.name}
                    <small>
                      {new Date(m.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </div>
                  <p>{m.content}</p>
                  {m.activity.map((a: any, i: number) => (
                    <div className="tool-activity" key={i}>
                      <div>
                        <Terminal size={15} />
                        <strong>{a.label}</strong>
                      </div>
                      {a.type === "confirmation" ? (
                        <>
                          <small>
                            Review this action before continuing. GitHub writes
                            require your confirmation.
                          </small>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              void c
                                .act("chat/confirm", { messageId: m.id })
                                .catch(() => {})
                            }
                          >
                            Confirm action
                            <ArrowRight size={14} />
                          </Button>
                        </>
                      ) : (
                        <pre>{JSON.stringify(a.result, null, 2)}</pre>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
            {busy && (
              <div className="thinking">
                <LoaderCircle size={16} className="spin" />
                Inspecting your workspace…
              </div>
            )}
            <div ref={end} />
          </div>
        )}
      </div>
      <div className="composer">
        <textarea
          aria-label="Message EasySolve"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask about your issues, or tell EasySolve what’s next…"
          rows={3}
        />
        <div>
          <span>
            <span className="online-dot" />
            {c.data.health.ai
              ? `${c.data.health.provider.name} configured`
              : `${c.data.health.provider.name} setup required`}
          </span>
          <div>
            <button
              className={`icon-button ${dictating ? "recording" : ""}`}
              title="Dictate message"
              aria-label="Dictate message"
              onClick={dictate}
            >
              <Mic size={18} />
            </button>
            <Button
              busy={busy}
              disabled={!text.trim() || !c.data.health.ai}
              onClick={() => void send()}
              aria-label="Send message"
            >
              <ArrowUp size={18} />
            </Button>
          </div>
        </div>
        {voiceError && <p className="inline-error">{voiceError}</p>}
      </div>
      <div className="composer-note">
        <ShieldCheck size={13} />
        You’re in control. Consequential actions always need your confirmation.
      </div>
    </div>
  );
}
export function IssuesPage(c: Context) {
  const [tab, setTab] = useState("ready"),
    [query, setQuery] = useState(""),
    [repo, setRepo] = useState(""),
    [account, setAccount] = useState(""),
    [presence, setPresence] = useState(""),
    [sort, setSort] = useState("newest"),
    [selected, setSelected] = useState<string[]>([]),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  const list = c.data.issues
    .filter(
      (i: any) =>
        (tab === "all" ||
          (tab === "assigned" && i.assignees.length) ||
          i.status === tab) &&
        (!repo || i.repo === repo) &&
        (!account || i.identityId === account) &&
        `${i.title} ${i.number}`.toLowerCase().includes(query.toLowerCase()) &&
        (!presence ||
          (presence === "yes") ===
            c.data.runs.some(
              (r: any) =>
                r.prUrl &&
                r.title.includes(`#${i.number} `) &&
                r.repo === i.repo,
            )),
    )
    .sort(
      (a: any, b: any) =>
        (sort === "oldest" ? 1 : -1) *
        (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    );
  const solve = async () => {
    setBusy(true);
    try {
      await c.act("runs", { issueIds: selected });
      setSelected([]);
      setConfirm(false);
      c.notify("Coding runs queued. Follow progress in Runs.");
    } catch {
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHead
        eyebrow="CONTRIBUTIONS, ORGANIZED"
        title="Good work starts here."
        description="Your assigned issues, synced from GitHub. Start an agent when you’re ready."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                void c
                  .act("sync", {})
                  .then((r) => c.notify(r.message))
                  .catch(() => {})
              }
            >
              <RefreshCw size={15} />
              Sync issues
            </Button>
            <Button
              disabled={!selected.length}
              onClick={() => setConfirm(true)}
            >
              <Play size={15} />
              Solve selected{selected.length ? ` (${selected.length})` : ""}
            </Button>
          </>
        }
      />
      <div className="subtle-notice">
        <Clock size={15} />
        Autosync{" "}
        {c.data.settings.autosync
          ? "every 15 minutes, even when you’re away"
          : "is paused"}
        . Importing never starts an agent.
      </div>
      <div className="tabs">
        {[
          ["ready", "Ready to run"],
          ["all", "All"],
          ["assigned", "Assigned"],
          ["in_progress", "In progress"],
          ["done", "Done"],
          ["failed", "Failed"],
        ].map(([key, title]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {title}
            <span>
              {
                c.data.issues.filter(
                  (i: any) =>
                    key === "all" ||
                    (key === "assigned" && i.assignees.length) ||
                    i.status === key,
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      <div className="filters">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search issues…"
        />
        <Select
          aria-label="Filter repository"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        >
          <option value="">All repositories</option>
          {[...new Set<string>(c.data.issues.map((i: any) => i.repo))].map(
            (r) => (
              <option key={r}>{r}</option>
            ),
          )}
        </Select>
        <Select
          aria-label="Filter account"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        >
          <option value="">All accounts</option>
          {c.data.identities.map((i: any) => (
            <option value={i.id} key={i.id}>
              @{i.login}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Pull request presence"
          value={presence}
          onChange={(e) => setPresence(e.target.value)}
        >
          <option value="">Any PR state</option>
          <option value="yes">Has pull request</option>
          <option value="no">No pull request</option>
        </Select>
        <Select
          aria-label="Issue ordering"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </Select>
      </div>
      <section className="panel">
        {list.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select all ready issues"
                      checked={
                        list.filter((i: any) =>
                          ["ready", "failed"].includes(i.status),
                        ).length > 0 &&
                        list
                          .filter((i: any) =>
                            ["ready", "failed"].includes(i.status),
                          )
                          .every((i: any) => selected.includes(i.id))
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? list
                                .filter((i: any) =>
                                  ["ready", "failed"].includes(i.status),
                                )
                                .map((i: any) => i.id)
                            : [],
                        )
                      }
                    />
                  </th>
                  <th>Issue</th>
                  <th>Repository / account</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((i: any) => (
                  <tr key={i.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select issue ${i.number}`}
                        disabled={!["ready", "failed"].includes(i.status)}
                        checked={selected.includes(i.id)}
                        onChange={(e) =>
                          setSelected((s) =>
                            e.target.checked
                              ? [...s, i.id]
                              : s.filter((id) => id !== i.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <External href={i.url}>
                        <span className="issue-title">
                          <span className="muted">#{i.number}</span> {i.title}
                        </span>
                      </External>
                      <div className="labels">
                        {i.labels.slice(0, 3).map((l: string) => (
                          <span key={l}>{l}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className="mono">{i.repo}</span>
                      <small className="block muted">
                        @
                        {c.data.identities.find(
                          (a: any) => a.id === i.identityId,
                        )?.login ?? "disconnected"}
                      </small>
                    </td>
                    <td>
                      <Badge status={i.status} />
                    </td>
                    <td>
                      <Button
                        variant="secondary small"
                        disabled={!["ready", "failed"].includes(i.status)}
                        onClick={() => {
                          setSelected([i.id]);
                          setConfirm(true);
                        }}
                      >
                        <Play size={13} />
                        Solve
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Room for your next contribution."
            action={
              <a href="/discover" className="button secondary">
                Find an issue
                <ArrowRight size={14} />
              </a>
            }
          >
            Sync your assigned issues, or discover an open issue to bring into
            your workspace.
          </Empty>
        )}
      </section>
      {confirm && (
        <Modal title="Start coding runs?" onClose={() => setConfirm(false)}>
          <p>
            {selected.length} issues will be grouped by repository, with up to
            four issues per run. Each group gets one branch and pull request.
          </p>
          <div className="subtle-notice">
            <ShieldCheck size={18} />
            Mode: {label(c.data.settings.mode)}.{" "}
            {c.data.settings.mode === "approval"
              ? "You review the patch before any commit, push, or PR."
              : c.data.settings.mode === "plan"
                ? "Only a plan will be generated."
                : "These explicitly started runs may publish automatically."}
          </div>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button busy={busy} onClick={() => void solve()}>
              <Play size={15} />
              Start {selected.length} issues
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function RunsPage(c: Context) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [repo, setRepo] = useState("");
  const runs = c.data.runs.filter(
    (r: any) =>
      (!status || r.status === status) &&
      (!repo || r.repo === repo) &&
      `${r.title} ${r.branch}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHead
        eyebrow="FROM DIRECTION TO DIFF"
        title="Every run. Every step."
        description="Follow your agents, inspect their work, and decide what ships."
      />
      <div className="filters">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search runs…"
        />
        <Select
          value={status}
          aria-label="Run status"
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {[
            "queued",
            "running",
            "awaiting_review",
            "published",
            "completed",
            "planned",
            "failed",
            "cancelled",
          ].map((s) => (
            <option value={s} key={s}>
              {label(s)}
            </option>
          ))}
        </Select>
        <Select
          value={repo}
          aria-label="Run repository"
          onChange={(e) => setRepo(e.target.value)}
        >
          <option value="">All repositories</option>
          {[...new Set<string>(c.data.runs.map((r: any) => r.repo))].map(
            (r) => (
              <option key={r}>{r}</option>
            ),
          )}
        </Select>
      </div>
      <section className="panel">
        {runs.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Run / issues</th>
                  <th>Repository / branch</th>
                  <th>Status</th>
                  <th>Started / duration</th>
                  <th>Pull request</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <a className="strong" href={`/runs/${r.id}`}>
                        {r.title}
                      </a>
                      <small className="block mono muted">
                        {r.id.slice(-8)}
                      </small>
                    </td>
                    <td>
                      <span>{r.repo}</span>
                      <small className="block mono muted">{r.branch}</small>
                    </td>
                    <td>
                      <Badge status={r.status} />
                    </td>
                    <td>
                      {new Date(r.createdAt).toLocaleString()}
                      <small className="block muted">
                        {r.startedAt
                          ? `${Math.round(((r.finishedAt ? new Date(r.finishedAt).getTime() : Date.now()) - new Date(r.startedAt).getTime()) / 1000)}s`
                          : "Not started"}
                      </small>
                    </td>
                    <td>
                      {r.prUrl ? (
                        <External href={r.prUrl}>#{r.prNumber}</External>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Your first run is a good issue away."
            action={
              <a className="button secondary" href="/issues">
                View issues
                <ArrowRight size={14} />
              </a>
            }
          >
            Explicitly start a run from your issue list. Your agent’s plan,
            changes, and tests will be recorded here.
          </Empty>
        )}
      </section>
    </>
  );
}
export function RunPage(c: Context & { runId: string }) {
  const [run, setRun] = useState<any>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("diff"),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState("");
  useEffect(() => {
    const load = () =>
      request(`runs/${c.runId}`)
        .then(setRun)
        .catch((e) => setError(e.message));
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [c.runId]);
  const action = async () => {
    setBusy(true);
    try {
      await c.act(`runs/${c.runId}/${confirm}`, { sha: run.headSha, feedback });
      setRun(await request(`runs/${c.runId}`));
      setConfirm("");
    } catch {
    } finally {
      setBusy(false);
    }
  };
  if (error) return <Empty title={error} />;
  if (!run)
    return (
      <div className="loading-state">
        <LoaderCircle className="spin" />
        Loading run…
      </div>
    );
  return (
    <>
      <PageHead
        eyebrow={`RUN ${run.id.slice(-8).toUpperCase()}`}
        title={run.title}
        description={run.repo}
        actions={
          <>
            <Badge status={run.status} />
            {["queued", "running", "awaiting_review", "failed"].includes(
              run.status,
            ) && (
              <Button variant="secondary" onClick={() => setConfirm("cancel")}>
                <Square size={14} />
                Cancel
              </Button>
            )}
            {["failed", "cancelled"].includes(run.status) && (
              <Button onClick={() => setConfirm("retry")}>
                <RefreshCw size={15} />
                Retry
              </Button>
            )}
            {run.status === "awaiting_review" && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setConfirm("changes")}
                >
                  Request changes
                </Button>
                <Button onClick={() => setConfirm("approve")}>
                  <Check size={16} />
                  Approve & publish
                </Button>
              </>
            )}
            {run.prUrl && (
              <External href={run.prUrl}>
                View pull request #{run.prNumber}
              </External>
            )}
          </>
        }
      />
      {run.error && (
        <div role="alert" className="alert">
          {run.error}
        </div>
      )}
      <div className="run-meta">
        <span>
          <GitBranch size={15} />
          <code>{run.branch}</code>
        </span>
        <span>
          <ShieldCheck size={15} />
          {label(run.mode)} mode
        </span>
        <span>
          <Clock size={15} />
          {new Date(run.createdAt).toLocaleString()}
        </span>
        <span>
          <Zap size={15} />
          {(run.usage?._sum?.total ?? 0).toLocaleString()} tokens ·{" "}
          {run.usage?._count ?? 0} requests
        </span>
      </div>
      <div className="tabs">
        {["diff", "plan", "activity", "tests", "artifacts"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {label(t)}
          </button>
        ))}
      </div>
      <Panel
        title={
          tab === "diff"
            ? "Proposed changes"
            : tab === "tests"
              ? "Actual test output"
              : label(tab)
        }
        description={
          tab === "diff"
            ? "Full file replacements are shown explicitly. Review the complete patch before publication."
            : undefined
        }
      >
        {tab === "diff" ? (
          run.diff ? (
            <Diff value={run.diff} />
          ) : (
            <Empty title="No patch yet">
              Changes appear here when execution finishes.
            </Empty>
          )
        ) : tab === "plan" ? (
          <div className="prose">
            {run.plan || "The agent has not produced a plan yet."}
          </div>
        ) : tab === "activity" ? (
          <pre className="terminal">
            {run.logs || "Waiting for the worker to claim this run."}
          </pre>
        ) : tab === "tests" ? (
          <pre className="terminal">
            {run.tests || "No test command has been executed."}
          </pre>
        ) : (
          <div className="artifact-list">
            {Object.entries(run.artifacts ?? {}).map(([name, content]: any) => (
              <details key={name}>
                <summary>
                  <FileCode2 size={16} />
                  {name}
                  <a
                    href={`data:text/plain;charset=utf-8,${encodeURIComponent(content)}`}
                    download={name.split("/").pop()}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Download ${name}`}
                  >
                    <ArrowUp size={15} />
                  </a>
                </summary>
                <pre>{content}</pre>
              </details>
            ))}
          </div>
        )}
      </Panel>
      {confirm && (
        <Modal
          title={
            confirm === "approve"
              ? "Publish this reviewed patch?"
              : `${label(confirm)} run?`
          }
          onClose={() => setConfirm("")}
        >
          <p>
            {confirm === "approve"
              ? "This creates a GitHub commit, branch, and draft pull request from the exact patch you reviewed. If you lack write access, EasySolve creates or uses your GitHub fork."
              : confirm === "changes"
                ? "The agent will inspect and rebuild the patch. The current approval will be cleared."
                : confirm === "cancel"
                  ? "Pending work will stop. A running sandbox stops at its next checkpoint."
                  : "Retry uses the same run and branch, preventing duplicate pull requests."}
          </p>
          {confirm === "changes" && (
            <Field label="Requested changes">
              <textarea
                rows={4}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Describe what the agent should change…"
              />
            </Field>
          )}
          {confirm === "approve" && (
            <code className="sha">Patch revision: {run.headSha}</code>
          )}
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setConfirm("")}>
              Go back
            </Button>
            <Button busy={busy} onClick={() => void action()}>
              Confirm {confirm === "approve" ? "publication" : confirm}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
