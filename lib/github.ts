import {
  assertIdentityAccess,
  creditMergedRun,
  releaseRun,
} from "./entitlements";
import { db } from "./db";
import { decrypt, HttpError } from "./security";
export class GithubRateLimitError extends HttpError {
  constructor(
    message: string,
    public retryAt: Date,
  ) {
    super(429, message);
  }
}
export class GithubCredentialError extends HttpError {
  constructor() {
    super(
      422,
      "GitHub credential expired or invalid. Update or revoke the token, then retry.",
    );
  }
}
export class GitHub {
  constructor(
    private token: string,
    private coordinationKey?: string,
  ) {}
  private async beforeRequest(method: string) {
    if (!this.coordinationKey) return;
    const key = `github:${this.coordinationKey}`;
    const configuredInterval =
      method === "GET"
        ? Number(process.env.GITHUB_MIN_INTERVAL_MS || 250)
        : Number(process.env.GITHUB_MIN_MUTATION_INTERVAL_MS || 1000);
    const interval = Math.min(
      5000,
      Math.max(method === "GET" ? 100 : 1000, configuredInterval),
    );
    const waitMs = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const now = new Date();
      const row = await tx.githubThrottle.findUnique({ where: { key } });
      if (row?.blockedUntil && row.blockedUntil > now)
        throw new GithubRateLimitError(
          "GitHub temporarily limited EasySolve requests. Retry after the recorded reset time; do not switch identities to bypass the restriction.",
          row.blockedUntil,
        );
      const wait = Math.max(
        0,
        (row?.nextAllowedAt?.getTime() ?? 0) - now.getTime(),
      );
      const nextAllowedAt = new Date(now.getTime() + wait + interval);
      await tx.githubThrottle.upsert({
        where: { key },
        create: { key, nextAllowedAt },
        update: { nextAllowedAt },
      });
      return wait;
    });
    const maxInlineWait = Math.min(
      30000,
      Math.max(1000, Number(process.env.GITHUB_MAX_INLINE_WAIT_MS || 5000)),
    );
    if (waitMs > maxInlineWait)
      throw new GithubRateLimitError(
        "GitHub request pacing is paused. EasySolve queued this job until the recorded retry time without consuming execution budget.",
        new Date(Date.now() + waitMs),
      );
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  private async recordHeaders(response: Response) {
    if (!this.coordinationKey) return;
    const key = `github:${this.coordinationKey}`;
    const remainingHeader = response.headers.get("x-ratelimit-remaining");
    const resetHeader = response.headers.get("x-ratelimit-reset");
    const parsedRemaining =
      remainingHeader === null ? NaN : Number(remainingHeader);
    const remaining =
      Number.isSafeInteger(parsedRemaining) && parsedRemaining >= 0
        ? parsedRemaining
        : null;
    const resetAt =
      resetHeader && /^\d+$/.test(resetHeader)
        ? new Date(Number(resetHeader) * 1000)
        : null;
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds =
      retryAfterHeader && /^\d+(?:\.\d+)?$/.test(retryAfterHeader)
        ? Number(retryAfterHeader)
        : null;
    const pollIntervalHeader = response.headers.get("x-poll-interval");
    const pollIntervalSeconds =
      pollIntervalHeader && /^\d+$/.test(pollIntervalHeader)
        ? Number(pollIntervalHeader)
        : null;
    const message = response.ok
      ? ""
      : await response
          .clone()
          .text()
          .catch(() => "");
    const abuse =
      /secondary rate limit|abuse detection|temporarily blocked|rate limit/i.test(
        message,
      );
    const limited =
      response.status === 429 ||
      ((response.status === 403 || response.status === 429) &&
        (remaining === 0 || abuse));
    let retryAt: Date | null = null;
    if (remaining === 0 || limited) {
      retryAt =
        retryAfterSeconds !== null
          ? new Date(Date.now() + Math.ceil(retryAfterSeconds * 1000))
          : resetAt && resetAt > new Date()
            ? resetAt
            : new Date(Date.now() + (limited ? 60000 : 1000));
      await db.githubThrottle.upsert({
        where: { key },
        create: { key, blockedUntil: retryAt, resetAt, remaining },
        update: { blockedUntil: retryAt, resetAt, remaining },
      });
    } else if (remaining !== null || resetAt) {
      await db.githubThrottle.upsert({
        where: { key },
        create: { key, resetAt, remaining },
        update: { resetAt, remaining },
      });
    }
    if (pollIntervalSeconds !== null)
      await db.githubThrottle.upsert({
        where: { key },
        create: {
          key,
          nextAllowedAt: new Date(Date.now() + pollIntervalSeconds * 1000),
        },
        update: {
          nextAllowedAt: new Date(Date.now() + pollIntervalSeconds * 1000),
        },
      });
    return { limited, message, resetAt, retryAt };
  }
  async request<T = any>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    await this.beforeRequest(method);
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    const headers = await this.recordHeaders(response);
    if (!response.ok) {
      if (headers?.limited) {
        const retryAt = headers.retryAt ?? new Date(Date.now() + 60000);
        throw new GithubRateLimitError(
          "GitHub rate limit or abuse protection is active. EasySolve stopped requests and will not retry automatically.",
          retryAt,
        );
      }
      const status = response.status;
      if (status === 401) throw new GithubCredentialError();
      throw new HttpError(
        status === 403 ? 403 : 502,
        `GitHub ${status}: ${status === 403 ? "permission denied" : "request failed"}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return response.json();
  }
  async pages(path: string) {
    const all: any[] = [];
    for (let p = 1; p <= 20; p++) {
      const result = await this.request<any[]>(
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${p}`,
      );
      all.push(...result);
      if (result.length < 100) return all;
    }
    throw new HttpError(
      422,
      "Result exceeds 2,000 records. Narrow the repository scope.",
    );
  }
}
export async function github(userId: string, identityId: string) {
  const i = await assertIdentityAccess(userId, identityId);
  return new GitHub(decrypt(i.token), `user:${userId}`);
}
async function assignedIssues(gh: GitHub, login: string) {
  // GitHub's global assigned feed can omit issues from organizations or
  // repositories that a fine-grained token can otherwise read. Merge it with
  // an assignee search instead of using search only as an empty-feed fallback.
  const feed = await gh.pages("/issues?filter=assigned&state=all");
  const search: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const result = await gh.request<{ items?: any[] }>(
      `/search/issues?q=${encodeURIComponent(`assignee:${login} is:issue`)}&per_page=100&page=${page}`,
    );
    const items = result.items ?? [];
    search.push(...items);
    if (items.length < 100) break;
  }
  const merged = new Map<string, any>();
  for (const issue of [...feed, ...search]) {
    const repo =
      issue.repository?.full_name ??
      issue.repository_url?.split("/repos/")[1] ??
      "";
    if (repo)
      merged.set(`${repo}#${issue.number}`, {
        ...issue,
        repository: { full_name: repo },
      });
  }
  return [...merged.values()];
}
export async function syncIssues(userId: string, identityId: string) {
  const gh = await github(userId, identityId);
  const identity = await db.identity.findFirstOrThrow({
    where: { id: identityId, userId },
  });
  try {
    const issues = await assignedIssues(gh, identity.login);
    for (const i of issues.filter((i) => !i.pull_request)) {
      const repo = i.repository.full_name;
      if (!repo) continue;
      await db.issue.upsert({
        where: { userId_repo_number: { userId, repo, number: i.number } },
        create: {
          userId,
          identityId,
          repo,
          number: i.number,
          title: i.title,
          body: i.body ?? "",
          labels: i.labels.map((l: any) => l.name),
          assignees: i.assignees.map((a: any) => a.login),
          url: i.html_url,
          state: i.state,
          status: i.state === "closed" ? "done" : "ready",
        },
        update: {
          identityId,
          title: i.title,
          body: i.body ?? "",
          labels: i.labels.map((l: any) => l.name),
          assignees: i.assignees.map((a: any) => a.login),
          state: i.state,
          ...(i.state === "closed" ? { status: "done" } : {}),
        },
      });
    }
    const imported = new Set(
      issues
        .filter((i) => !i.pull_request)
        .map((i) => `${i.repository.full_name}#${i.number}`),
    );
    const previous = await db.issue.findMany({
      where: {
        userId,
        identityId,
        assignees: { array_contains: [identity.login] },
      },
    });
    for (const old of previous) {
      if (imported.has(`${old.repo}#${old.number}`)) continue;
      const current = await gh.request(
        `/repos/${old.repo}/issues/${old.number}`,
      );
      await db.issue.update({
        where: { id: old.id },
        data: {
          assignees: current.assignees.map((a: any) => a.login),
          state: current.state,
          ...(current.state === "closed" ? { status: "done" } : {}),
        },
      });
    }
    const published = await db.run.findMany({
      where: {
        userId,
        identityId,
        status: "published",
        prNumber: { not: null },
      },
    });
    for (const run of published) {
      const pr = await gh.request(`/repos/${run.repo}/pulls/${run.prNumber}`);
      if (pr.merged) {
        await creditMergedRun(userId, run.id);
        await db.run.update({
          where: { id: run.id },
          data: { status: "completed" },
        });
        await db.issue.updateMany({
          where: { userId, id: { in: run.issueIds as string[] } },
          data: { status: "done" },
        });
      } else if (pr.state === "closed") {
        await releaseRun(run.id);
        await db.run.update({
          where: { id: run.id },
          data: {
            status: "cancelled",
            error: "Pull request closed without merge",
          },
        });
      }
    }
    await db.identity.update({
      where: { id: identity.id },
      data: { syncedAt: new Date(), status: "connected" },
    });
    return { count: issues.filter((i) => !i.pull_request).length };
  } catch (e) {
    await db.identity.update({
      where: { id: identity.id },
      data: { status: "needs_attention" },
    });
    throw e;
  }
}
export async function reviewQueue(userId: string) {
  const repos = await db.repository.findMany({ where: { userId } });
  const result: any[] = [];
  for (const repo of repos) {
    const gh = await github(userId, repo.identityId);
    const prs = await gh.pages(`/repos/${repo.fullName}/pulls?state=open`);
    for (const summary of prs) {
      const pr = await gh.request(
        `/repos/${repo.fullName}/pulls/${summary.number}`,
      );
      const reviews = await gh.pages(
        `/repos/${repo.fullName}/pulls/${pr.number}/reviews`,
      );
      const checks = await gh.request(
        `/repos/${repo.fullName}/commits/${pr.head.sha}/check-runs`,
      );
      const statuses = await gh.request(
        `/repos/${repo.fullName}/commits/${pr.head.sha}/status`,
      );
      const runs = checks.check_runs ?? [];
      const combined =
        runs.some(
          (c: any) =>
            c.status === "completed" &&
            !["success", "neutral", "skipped"].includes(c.conclusion),
        ) || ["failure", "error"].includes(statuses.state)
          ? "failure"
          : runs.some((c: any) => c.status !== "completed") ||
              (statuses.state === "pending" && statuses.total_count > 0)
            ? "pending"
            : runs.length || statuses.total_count
              ? "success"
              : "pending";
      const { reviewCategory } = await import("./policy");
      result.push({
        repo: repo.fullName,
        identityId: repo.identityId,
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        head: pr.head.sha,
        author: pr.user.login,
        draft: !!pr.draft,
        mergeable: pr.mergeable,
        mergeableState: pr.mergeable_state ?? null,
        checks: combined,
        category: reviewCategory(pr, reviews, pr.head.sha, combined),
        additions: pr.additions,
        deletions: pr.deletions,
        updatedAt: pr.updated_at,
      });
    }
  }
  return result;
}

export async function syncRepositoryStats(
  userId: string,
  repositoryId: string,
) {
  const repo = await db.repository.findFirst({
    where: { id: repositoryId, userId },
  });
  if (!repo) throw new HttpError(404, "Repository not found");
  const gh = await github(userId, repo.identityId);
  const permissions = await gh.request(`/repos/${repo.fullName}`);
  if (!permissions.permissions?.admin && !permissions.permissions?.maintain) {
    await db.repository.update({
      where: { id: repo.id },
      data: { health: "needs_attention" },
    });
    throw new HttpError(403, "Management permission is no longer available");
  }
  const issues = (
    await gh.pages(`/repos/${repo.fullName}/issues?state=open`)
  ).filter((i) => !i.pull_request);
  const prs = await gh.pages(
    `/repos/${repo.fullName}/pulls?state=all&sort=updated`,
  );
  const contributors = await gh.request(
    `/repos/${repo.fullName}/contributors?per_page=10`,
  );
  const stats = {
    openIssues: issues.length,
    assignedIssues: issues.filter((i) => i.assignees.length).length,
    openPRs: prs.filter((p) => p.state === "open").length,
    mergedPRs: prs.filter((p) => p.merged_at).length,
    contributors: Array.isArray(contributors)
      ? contributors.map((c: any) => ({
          login: c.login,
          contributions: c.contributions,
        }))
      : [],
    recentPRs: prs.slice(0, 8).map((p) => ({
      title: p.title,
      number: p.number,
      author: p.user.login,
      state: p.merged_at ? "merged" : p.state,
      url: p.html_url,
    })),
    updatedAt: new Date().toISOString(),
  };
  return db.repository.update({
    where: { id: repo.id },
    data: { stats, health: "connected" },
  });
}
