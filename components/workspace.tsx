"use client";
import {
  Activity,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  CreditCard,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Github,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  Users,
  Waves,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { authPayload, type AuthMode } from "@/lib/auth-input";
import { MaintainerDetails } from "./pages/maintainer";
import {
  Badge,
  Button,
  Empty,
  Field,
  Modal,
  Panel,
  SearchBox,
  Select,
  request,
  RequestError,
} from "./ui";
import {
  AccountPage,
  AssignmentsPage,
  BillingPage,
  ChatPage,
  DiscoverPage,
  IssuesPage,
  RepositoriesPage,
  ReviewPage,
  RunPage,
  RunsPage,
  SettingsPage,
  UsagePage,
  WavePage,
} from "./workflows";
export type Data = any;
export type Context = {
  data: Data;
  refresh: () => Promise<void>;
  act: (path: string, body?: any, method?: string) => Promise<any>;
  identity: string;
  setIdentity: (s: string) => void;
  notify: (s: string) => void;
};
const nav = [
  {
    group: "Workspace",
    items: [
      ["Overview", "/overview", LayoutDashboard],
      ["Chat", "/chat", MessageSquare],
      ["Issues", "/issues", ListChecks],
      ["Runs", "/runs", Terminal],
    ],
  },
  {
    group: "Contribute",
    items: [
      ["Find issues", "/discover", Search],
      ["Wave apply", "/wave", Waves],
    ],
  },
  {
    group: "Maintain",
    items: [
      ["Dashboard", "/maintain", Activity],
      ["Assignments", "/assignments", Users],
      ["Review queue", "/reviews", GitPullRequest],
      ["Repositories", "/repositories", FolderGit2],
    ],
  },
  {
    group: "Settings",
    items: [
      ["AI usage", "/usage", Zap],
      ["Run settings", "/settings", Settings2],
      ["Account", "/account", ShieldCheck],
      ["Plans & billing", "/billing", CreditCard],
    ],
  },
];
export function Workspace() {
  const router = useRouter();
  const pathname = usePathname();
  const page = pathname === "/" ? "overview" : pathname.split("/")[1];
  const [data, setData] = useState<Data>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [identity, setIdentity] = useState(""),
    [toast, setToast] = useState(""),
    [drawer, setDrawer] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [light, setLight] = useState(false),
    [command, setCommand] = useState(false),
    [query, setQuery] = useState(""),
    [profile, setProfile] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const d = await request("bootstrap");
      setData(d);
      setError("");
      setIdentity((v) =>
        d.identities.some((i: any) => i.id === v)
          ? v
          : (d.identities.find((i: any) => i.active)?.id ?? ""),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const theme = localStorage.getItem("es-theme");
    setLight(theme === "light");
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
  }, [light]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommand((v) => !v);
      }
      if (e.key === "Escape") {
        setDrawer(false);
        setProfile(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!drawer) return;
    const previous = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const aside = document.querySelector("aside");
    const first = aside?.querySelector<HTMLElement>("button,a");
    first?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const nodes = Array.from(
        aside?.querySelectorAll<HTMLElement>("a,button,input,select") ?? [],
      ).filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      if (event.shiftKey && document.activeElement === nodes[0]) {
        event.preventDefault();
        nodes.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
        event.preventDefault();
        nodes[0].focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [drawer]);
  const act = async (path: string, body?: any, method?: string) => {
    try {
      const result = await request(path, body, method);
      await refresh();
      return result;
    } catch (e) {
      setToast((e as Error).message);
      throw e;
    }
  };
  const go = (href: string) => {
    router.push(href);
    setDrawer(false);
    setCommand(false);
  };
  if (loading)
    return (
      <div className="boot">
        <img src="/mark.svg" width="42" alt="EasySolve" />
        <div className="skeleton" />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!data) return <Auth onLogin={refresh} error={error} />;
  const context: Context = {
    data,
    refresh,
    act,
    identity,
    setIdentity,
    notify: setToast,
  };
  const title =
    (nav
      .flatMap((g) => g.items)
      .find((i) => i[1] === `/${page}`)?.[0] as string) ?? "Overview";
  return (
    <div className={`app ${collapsed ? "collapsed" : ""}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
      )}
      <aside className={drawer ? "open" : ""} aria-label="Workspace navigation">
        <button
          className="icon-button mobile-drawer-close"
          title="Close navigation"
          aria-label="Close navigation"
          onClick={() => setDrawer(false)}
        >
          <X size={18} />
        </button>
        <a
          className="brand"
          href="/overview"
          onClick={(e) => {
            e.preventDefault();
            go("/overview");
          }}
        >
          <img src="/mark.svg" width="31" height="31" alt="" />
          <span>
            EasySolve<span className="brand-dot">.</span>
          </span>
        </a>
        <button className="workspace-picker" onClick={() => go("/account")}>
          <span className="avatar small">
            {data.user.name[0].toUpperCase()}
          </span>
          <span>
            {data.user.name}&apos;s workspace<small>{data.plan} plan</small>
          </span>
          <ChevronRight size={14} />
        </button>
        <nav aria-label="Main navigation">
          {data.user.role === "ADMIN" && (
            <div className="nav-group">
              <p>Administration</p>
              <Link href="/admin">
                <ShieldCheck size={18} />
                <span>Owner dashboard</span>
              </Link>
            </div>
          )}
          {nav.map((g) => (
            <div className="nav-group" key={g.group}>
              <p>{g.group}</p>
              {g.items.map(([name, href, Icon]: any) => {
                const count =
                  href === "/reviews"
                    ? data.runs.filter(
                        (r: any) => r.status === "awaiting_review",
                      ).length
                    : href === "/issues"
                      ? data.issues.filter((i: any) => i.status === "ready")
                          .length
                      : 0;
                return (
                  <Link
                    key={href}
                    href={href}
                    title={name}
                    className={page === href.slice(1) ? "active" : ""}
                    onClick={() => setDrawer(false)}
                  >
                    <Icon size={18} />
                    <span>{name}</span>
                    {count > 0 && <b>{count}</b>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="agent-status">
            <span
              className={
                data.health.provider.verified ? "online-dot" : "offline-dot"
              }
            />
            <span>
              {data.health.provider.connectionFailed
                ? `${data.health.provider.name} connection failed`
                : data.health.provider.verified
                  ? `${data.health.provider.name} verified`
                  : data.health.ai
                    ? `${data.health.provider.name} configured`
                    : `${data.health.provider.name} setup required`}
              <small>
                {data.health.provider.connectionFailed
                  ? "Check connection settings"
                  : data.health.ai
                    ? "Check verification in Account"
                    : "Set up to start solving"}
              </small>
            </span>
            <a
              href="/account"
              title="Connection settings"
              aria-label="Connection settings"
            >
              <ChevronRight size={16} />
            </a>
          </div>
          <button
            className="collapse-button"
            onClick={() => setCollapsed((v) => !v)}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose size={17} />
            <span>Collapse sidebar</span>
          </button>
        </div>
      </aside>
      <div className="workspace" inert={drawer}>
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            title="Open navigation"
            aria-label="Open navigation"
            onClick={() => setDrawer(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
            {pathname.split("/")[2] && (
              <>
                <ChevronRight size={14} />
                <span>Run details</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <button
              className="command-trigger"
              aria-label="Open command menu"
              title="Search workspace (Ctrl or Command K)"
              onClick={() => setCommand(true)}
            >
              <Search size={15} />
              <span>Search anything…</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="icon-button"
              title={light ? "Switch to dark theme" : "Switch to light theme"}
              aria-label="Toggle theme"
              onClick={() => {
                setLight((v) => !v);
                localStorage.setItem("es-theme", light ? "dark" : "light");
              }}
            >
              {light ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <div className="profile-wrap">
              <button
                className="avatar"
                aria-label="Profile menu"
                title="Profile menu"
                onClick={() => setProfile((v) => !v)}
              >
                {data.user.name[0].toUpperCase()}
              </button>
              {profile && (
                <div className="profile-menu">
                  <strong>{data.user.name}</strong>
                  <small>{data.user.email}</small>
                  <button
                    onClick={() => {
                      go("/account");
                      setProfile(false);
                    }}
                  >
                    Account settings
                  </button>
                  <button
                    onClick={async () => {
                      await request("auth/logout", {});
                      setData(null);
                    }}
                  >
                    <LogOut size={14} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main">
          {error && (
            <div className="alert">
              Live update failed: {error}
              <button onClick={() => void refresh()}>Retry</button>
            </div>
          )}
          {page === "overview" || page === "maintain" ? (
            <Overview {...context} maintainer={page === "maintain"} go={go} />
          ) : page === "chat" ? (
            <ChatPage {...context} />
          ) : page === "issues" ? (
            <IssuesPage {...context} />
          ) : page === "runs" ? (
            pathname.split("/")[2] ? (
              <RunPage {...context} runId={pathname.split("/")[2]} />
            ) : (
              <RunsPage {...context} />
            )
          ) : page === "discover" ? (
            <DiscoverPage {...context} />
          ) : page === "wave" ? (
            <WavePage {...context} />
          ) : page === "assignments" ? (
            <AssignmentsPage {...context} />
          ) : page === "reviews" ? (
            <ReviewPage {...context} />
          ) : page === "repositories" ? (
            <RepositoriesPage {...context} />
          ) : page === "usage" ? (
            <UsagePage {...context} />
          ) : page === "settings" ? (
            <SettingsPage {...context} />
          ) : page === "account" ? (
            <AccountPage {...context} />
          ) : page === "billing" || page === "checkout" ? (
            <BillingPage {...context} />
          ) : (
            <Empty
              title="Page not found"
              action={<a href="/overview">Return to overview</a>}
            />
          )}
          <footer>
            <span>
              <img src="/mark.svg" width="14" alt="" />
              Built for the work that matters.
            </span>
            <span>
              EasySolve <span className="separator">/</span> From issue to
              reviewed pull request.
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div role="status" className="toast">
          <CircleHelp size={18} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {command && (
        <Modal title="Go anywhere" onClose={() => setCommand(false)}>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Search pages, issues, and runs…"
          />
          <div className="command-results">
            {nav
              .flatMap((g) => g.items)
              .filter(([n]) =>
                (n as string).toLowerCase().includes(query.toLowerCase()),
              )
              .map(([n, h, I]: any) => (
                <button key={h} onClick={() => go(h)}>
                  <I size={17} />
                  {n}
                  <ArrowRight size={15} />
                </button>
              ))}
            {query &&
              data.issues
                .filter((i: any) =>
                  i.title.toLowerCase().includes(query.toLowerCase()),
                )
                .slice(0, 5)
                .map((i: any) => (
                  <button key={i.id} onClick={() => go("/issues")}>
                    <ListChecks size={17} />#{i.number} {i.title}
                  </button>
                ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
export function PageHead({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{actions}</div>
    </div>
  );
}
export function Identity({
  data,
  identity,
  setIdentity,
}: Pick<Context, "data" | "identity" | "setIdentity">) {
  return (
    <Select
      aria-label="GitHub account"
      value={identity}
      onChange={(e) => setIdentity(e.target.value)}
    >
      <option value="">Select GitHub account</option>
      {data.identities
        .filter((i: any) => i.active)
        .map((i: any) => (
          <option key={i.id} value={i.id}>
            @{i.login}
          </option>
        ))}
    </Select>
  );
}
function Overview(
  c: Context & { maintainer: boolean; go: (s: string) => void },
) {
  const { data: d, maintainer, go } = c;
  const ready = d.issues.filter((i: any) => i.status === "ready"),
    active = d.runs.filter((r: any) =>
      ["running", "queued"].includes(r.status),
    ),
    review = d.runs.filter((r: any) => r.status === "awaiting_review"),
    done = d.runs.filter((r: any) => r.status === "completed");
  return (
    <>
      <PageHead
        eyebrow={maintainer ? "MAINTAINER WORKSPACE" : "YOUR WORK, IN FOCUS"}
        title={
          maintainer
            ? "A healthy project starts here."
            : `Let’s move good work forward${d.user.name ? ", " + d.user.name.split(" ")[0] : ""}.`
        }
        description={
          maintainer
            ? "A clear view of your repositories, contributors, and the work ahead."
            : "Discover an issue. Build with an agent. Ship something meaningful."
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => go("/discover")}>
              <Search size={16} />
              Find an issue
            </Button>
            <Button onClick={() => go("/chat")}>
              <Plus size={16} />
              New conversation
            </Button>
          </>
        }
      />
      <div className="overview-banner">
        <div className="banner-icon">
          <GitBranch size={28} />
        </div>
        <div>
          <span className="eyebrow">
            A LITTLE LESS FRICTION. A LOT MORE FORWARD.
          </span>
          <h2>Your next contribution starts with a good issue.</h2>
          <p>
            Bring your GitHub work into one place. Let EasySolve help with the
            heavy lifting.
          </p>
          <button
            onClick={() => go(d.identities.length ? "/issues" : "/account")}
          >
            {d.identities.length
              ? "Explore your issues"
              : "Connect your GitHub account"}
            <ArrowRight size={15} />
          </button>
        </div>
        <div className="flow-graphic" aria-hidden="true">
          <div>
            <ListChecks size={19} />
            <span>Issue</span>
          </div>
          <i />
          <div>
            <Sparkles size={19} />
            <span>Agent</span>
          </div>
          <i />
          <div>
            <GitPullRequest size={19} />
            <span>Pull request</span>
          </div>
        </div>
      </div>
      <div className="stat-grid">
        {(maintainer
          ? [
              [
                "Managed repositories",
                d.repositories.length,
                FolderGit2,
                "Projects in your workspace",
                "/repositories",
              ],
              [
                "Assigned issues",
                d.issues.filter((i: any) => i.assignees.length).length,
                Users,
                "Synced from GitHub",
                "/assignments",
              ],
              [
                "Awaiting review",
                review.length,
                GitPullRequest,
                "Ready for a closer look",
                "/reviews",
              ],
              [
                "Work completed",
                done.length,
                CheckCheck,
                "Merged contributions",
                "/runs",
              ],
            ]
          : [
              [
                "Ready to solve",
                ready.length,
                ListChecks,
                "Your next opportunity",
                "/issues",
              ],
              [
                "Active runs",
                active.length,
                Terminal,
                "Working in the background",
                "/runs",
              ],
              [
                "Awaiting review",
                review.length,
                GitPullRequest,
                "Your judgment, their next step",
                "/runs",
              ],
              [
                "Work completed",
                done.length,
                CheckCheck,
                "Good work, shipped",
                "/runs",
              ],
            ]
        ).map(([title, n, Icon, note, href]: any) => (
          <button className="stat-card" key={title} onClick={() => go(href)}>
            <div>
              <span>{title}</span>
              <Icon size={18} />
            </div>
            <strong>
              {n}
              <ArrowUp n={n} />
            </strong>
            <small>{note}</small>
          </button>
        ))}
      </div>
      {maintainer && <MaintainerDetails {...c} />}
      <div className="overview-grid">
        <div className="overview-primary">
          <Panel
            title="Needs your attention"
            description="A human checkpoint before the next step."
            action={
              <a href="/runs">
                View all
                <ArrowRight size={14} />
              </a>
            }
          >
            {review.length ? (
              review.slice(0, 4).map((r: any) => (
                <a className="work-row" href={`/runs/${r.id}`} key={r.id}>
                  <div className="row-icon emerald">
                    <GitPullRequest size={18} />
                  </div>
                  <div>
                    <strong>{r.title}</strong>
                    <small>{r.repo}</small>
                  </div>
                  <Badge status="awaiting_review" />
                  <ChevronRight size={16} />
                </a>
              ))
            ) : (
              <div className="compact-empty">
                <div className="check-ring">
                  <Check size={22} />
                </div>
                <h4>You’re all caught up.</h4>
                <p>
                  When an agent finishes, its changes will appear here for your
                  review.
                </p>
              </div>
            )}
          </Panel>
          <Panel
            title={maintainer ? "Repository health" : "Your issue shortlist"}
            description={
              maintainer
                ? "Connected projects and their open work."
                : "Good places to make your next contribution."
            }
            action={
              <a href={maintainer ? "/repositories" : "/issues"}>
                View all
                <ArrowRight size={14} />
              </a>
            }
          >
            {(maintainer ? d.repositories : ready).length ? (
              (maintainer ? d.repositories : ready)
                .slice(0, 4)
                .map((i: any) => (
                  <a
                    className="work-row"
                    href={maintainer ? "/repositories" : "/issues"}
                    key={i.id}
                  >
                    <div className="row-icon">
                      <FolderGit2 size={18} />
                    </div>
                    <div>
                      <strong>{maintainer ? i.fullName : i.title}</strong>
                      <small>
                        {maintainer
                          ? "Management access verified"
                          : `${i.repo} · #${i.number}`}
                      </small>
                    </div>
                    <Badge status={maintainer ? i.health : i.status} />
                  </a>
                ))
            ) : (
              <Empty
                title={
                  maintainer
                    ? "Your repositories, connected."
                    : "A clean slate. A world of issues."
                }
                action={
                  <Button
                    variant="secondary"
                    onClick={() =>
                      go(maintainer ? "/repositories" : "/discover")
                    }
                  >
                    {maintainer ? "Add a repository" : "Find your first issue"}
                    <ArrowRight size={14} />
                  </Button>
                }
              >
                {maintainer
                  ? "Add a repository you maintain to manage contributions."
                  : "Connect GitHub to sync assigned issues, or find a project to contribute to."}
              </Empty>
            )}
          </Panel>
        </div>
        <div>
          <Panel
            title="Connections"
            description="The tools behind your workflow."
          >
            <div className="connection-row">
              <Github size={21} />
              <div>
                <strong>GitHub</strong>
                <small>
                  {d.identities.length
                    ? `${d.identities.length} connected ${d.identities.length === 1 ? "identity" : "identities"}`
                    : "Bring your repositories"}
                </small>
              </div>
              <span
                className={`connection-dot ${d.identities.length ? "on" : ""}`}
              />
            </div>
            <div className="connection-row">
              <Sparkles size={21} />
              <div>
                <strong>
                  {d.health.provider.name} ·{" "}
                  {d.health.provider.modelName || "Model selection required"}
                </strong>
                <small>
                  {d.health.ai ? "API key configured" : "API key required"}
                </small>
              </div>
              <span className={`connection-dot ${d.health.ai ? "on" : ""}`} />
            </div>
            <a className="panel-bottom-link" href="/account">
              Manage connections
              <ArrowRight size={14} />
            </a>
          </Panel>
          <Panel title="A deliberate workflow">
            <div className="steps">
              {[
                [
                  "01",
                  "Find the right issue",
                  "Choose work that fits your experience.",
                ],
                [
                  "02",
                  "Give your agent a direction",
                  "Inspect, plan, build, and test in isolation.",
                ],
                [
                  "03",
                  "Review. Refine. Ship.",
                  "You stay in control of every publication.",
                ],
              ].map(([n, t, desc]) => (
                <div key={n}>
                  <span>{n}</span>
                  <div>
                    <strong>{t}</strong>
                    <p>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <a className="panel-bottom-link" href="/settings">
              <ShieldCheck size={15} />
              Approval required by default
            </a>
          </Panel>
        </div>
      </div>
      <Panel
        title="Recent activity"
        description="A record of what actually happened."
      >
        {d.runs.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Repository</th>
                  <th>Status</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {d.runs.slice(0, 5).map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/runs/${r.id}`}>{r.title}</a>
                    </td>
                    <td className="mono">{r.repo}</td>
                    <td>
                      <Badge status={r.status} />
                    </td>
                    <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="inline-empty">
            <Activity size={18} />
            <span>
              Your workspace activity will appear here. Start with an issue.
            </span>
          </div>
        )}
      </Panel>
    </>
  );
}
function ArrowUp({ n }: { n: number }) {
  return n > 0 ? (
    <span className="stat-spark">↗</span>
  ) : (
    <span className="stat-zero">—</span>
  );
}
function Auth({
  onLogin,
  error,
}: {
  onLogin: () => Promise<void>;
  error: string;
}) {
  const [mode, setMode] = useState<Exclude<AuthMode, "reset">>("login"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [resetToken, setResetToken] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const token = new URLSearchParams(window.location.search).get("reset");
    return token?.trim() ? token : null;
  });
  const action: AuthMode = resetToken ? "reset" : mode;
  const switchMode = (next: Exclude<AuthMode, "reset">) => {
    setMode(next);
    setMessage("");
    setFieldErrors({});
  };
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setFieldErrors({});
    // Capture the enabled DOM controls before any loading-state render.
    const f = new FormData(e.currentTarget);
    try {
      const result = await request(
        `auth/${action}`,
        authPayload(action, f, resetToken),
      );
      if (action === "recover" || action === "reset") {
        setMessage(
          result.message ?? "Password changed. Sign in with your new password.",
        );
        if (action === "reset") {
          history.replaceState({}, "", "/");
          setResetToken(null);
        }
        setMode("login");
      } else await onLogin();
    } catch (e) {
      if (e instanceof RequestError && e.fieldErrors)
        setFieldErrors(e.fieldErrors);
      else setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <div className="auth-story">
        <a className="brand" href="/">
          <img src="/mark.svg" width="35" alt="" />
          EasySolve<span className="brand-dot">.</span>
        </a>
        <div>
          <span className="eyebrow">LESS FRICTION. MORE CONTRIBUTION.</span>
          <h1>
            From issue to
            <br />
            reviewed pull request<span>.</span>
          </h1>
          <p>
            A considered workspace for the entire contribution.
            <br />
            Your direction. An agent’s momentum.
          </p>
          <div className="auth-pills">
            <span>
              <ListChecks size={17} />
              Discover
            </span>
            <ChevronRight size={16} />
            <span>
              <Terminal size={17} />
              Build
            </span>
            <ChevronRight size={16} />
            <span>
              <GitPullRequest size={17} />
              Ship
            </span>
          </div>
        </div>
        <small>Thoughtful tools for people who build.</small>
      </div>
      <div className="auth-form">
        <form onSubmit={submit}>
          <div className="eyebrow">YOUR NEXT CONTRIBUTION AWAITS</div>
          <h2>
            {action === "reset"
              ? "Choose a new password."
              : mode === "signup"
                ? "Make room for good work."
                : mode === "recover"
                  ? "Find your way back."
                  : "Welcome to EasySolve."}
          </h2>
          <p>
            {action === "reset"
              ? "Use at least 8 characters for your new password."
              : mode === "signup"
                ? "Create your private workspace to get started."
                : "Sign in to pick up where you left off."}
          </p>
          {error && !error.includes("Sign in") && (
            <div className="alert">{error}</div>
          )}
          {action === "signup" && (
            <Field label="Your name" error={fieldErrors.name}>
              <input
                name="name"
                autoComplete="name"
                required
                maxLength={80}
                placeholder="Alex Morgan"
              />
            </Field>
          )}
          {action !== "reset" && (
            <Field label="Email address" error={fieldErrors.email}>
              <input
                name="email"
                type="email"
                autoComplete={action === "login" ? "username" : "email"}
                required
                maxLength={254}
                placeholder="you@example.com"
              />
            </Field>
          )}
          {action !== "recover" && (
            <Field
              label="Password"
              hint="Use at least 8 characters."
              error={fieldErrors.password}
            >
              <input
                name="password"
                type="password"
                autoComplete={
                  action === "login" ? "current-password" : "new-password"
                }
                minLength={action === "login" ? undefined : 8}
                maxLength={128}
                required
                placeholder="Your password"
              />
            </Field>
          )}
          {fieldErrors.token && (
            <div role="alert" className="alert">
              {fieldErrors.token}
            </div>
          )}
          {fieldErrors.form && (
            <div role="alert" className="alert">
              {fieldErrors.form}
            </div>
          )}
          {message && (
            <div role="alert" className="alert">
              {message}
            </div>
          )}
          <Button type="submit" busy={busy}>
            {action === "reset"
              ? "Save new password"
              : mode === "signup"
                ? "Create workspace"
                : mode === "recover"
                  ? "Send recovery link"
                  : "Continue"}
            <ArrowRight size={16} />
          </Button>
          {action !== "reset" && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => switchMode(mode === "signup" ? "login" : "signup")}
            >
              {mode === "signup"
                ? "Already have an account? Sign in"
                : "New here? Create an account"}
            </button>
          )}
          {action === "login" && (
            <button
              type="button"
              className="text-button muted"
              disabled={busy}
              onClick={() => switchMode("recover")}
            >
              Forgot your password?
            </button>
          )}
          <div className="auth-note">
            <ShieldCheck size={16} />
            Your tokens stay encrypted. Your work stays yours.
          </div>
        </form>
      </div>
    </div>
  );
}
