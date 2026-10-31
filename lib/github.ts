import {
  assertIdentityAccess,
  creditMergedRun,
  releaseRun,
} from "./entitlements";
import { db } from "./db";
import { decrypt, HttpError } from "./security";
export class GitHub {
  constructor(private token: string) {}
  async request<T = any>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
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
    if (!response.ok)
      throw new HttpError(
        response.status === 401 ? 422 : response.status === 403 ? 403 : 502,
        `GitHub ${response.status}: ${response.status === 401 ? "credential expired or invalid" : response.status === 403 ? "permission or rate limit denied" : "request failed"}`,
      );
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
  return new GitHub(decrypt(i.token));
}
async function assignedIssues(gh: GitHub, login: string) {
  const issues = await gh.pages("/issues?filter=assigned&state=all");
  if (issues.length) return issues;

  // Fine-grained tokens and organization visibility rules can occasionally
  // return an empty global list even though the account can find its issues.
  // Search is scoped to the authenticated account and gives us a reliable
  // fallback without requiring a repository to be managed first.
  const result = await gh.request<{ items?: any[] }>(
    `/search/issues?q=${encodeURIComponent(`assignee:${login} is:issue`)}&per_page=100&page=1`,
  );
  return (result.items ?? []).map((issue: any) => ({
    ...issue,
    repository: {
      full_name:
        issue.repository?.full_name ??
        issue.repository_url?.split("/repos/")[1] ??
        "",
    },
  }));
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
