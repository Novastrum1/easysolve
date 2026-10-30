import { z } from "zod";
export function planLimits(u: {
  planName?: string | null;
  planMaxJobs?: number | null;
  planMaxTokens?: number | null;
}) {
  return {
    name: u.planName ?? (process.env.PLAN_NAME || "Personal"),
    jobs: u.planMaxJobs ?? Number(process.env.PLAN_MAX_JOBS || 50),
    tokens: u.planMaxTokens ?? Number(process.env.PLAN_MAX_TOKENS || 1000000),
  };
}
export const settingsSchema = z.object({
  mode: z.enum(["approval", "automatic", "plan"]).default("approval"),
  autosync: z.boolean().default(true),
  waveLimit: z.number().int().min(1).max(100).default(3),
  monthlyTokens: z.number().int().min(1000).max(100000000).default(1000000),
  resetDay: z.number().int().min(1).max(28).default(1),
  resetHour: z.number().int().min(0).max(23).default(0),
  monthlyJobs: z.number().int().min(1).max(10000).default(50),
  deepseekInputPrice: z
    .number()
    .min(0)
    .default(Number(process.env.DEEPSEEK_INPUT_PRICE_PER_MILLION) || 0),
  deepseekCachedPrice: z
    .number()
    .min(0)
    .default(Number(process.env.DEEPSEEK_CACHED_PRICE_PER_MILLION) || 0),
  deepseekOutputPrice: z
    .number()
    .min(0)
    .default(Number(process.env.DEEPSEEK_OUTPUT_PRICE_PER_MILLION) || 0),
});
export const settings = (v: unknown) => settingsSchema.parse(v ?? {});
export function repoName(value: string) {
  const clean = value
    .trim()
    .replace(/^https:\/\/github.com\//, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(clean))
    throw new z.ZodError([
      {
        code: "custom",
        path: ["repo"],
        message: "Use owner/repository or a GitHub repository URL",
      },
    ]);
  return clean;
}
export function groups<T extends { repo: string }>(issues: T[]) {
  const map = new Map<string, T[]>();
  for (const issue of issues) {
    const same = map.get(issue.repo) ?? [];
    same.push(issue);
    map.set(issue.repo, same);
  }
  return [...map.values()].flatMap((items) =>
    Array.from({ length: Math.ceil(items.length / 4) }, (_, i) =>
      items.slice(i * 4, i * 4 + 4),
    ),
  );
}
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
export function nextMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
export function reviewCategory(
  pr: { draft?: boolean; mergeable: boolean | null; mergeable_state?: string },
  reviews: { user?: { login: string }; state: string; commit_id: string }[],
  sha: string,
  checks: string,
) {
  const latest = new Map<string, string>();
  for (const r of reviews)
    if (
      r.commit_id === sha &&
      ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(r.state)
    )
      latest.set(r.user?.login ?? "", r.state);
  if (
    pr.draft ||
    pr.mergeable === false ||
    ["blocked", "behind", "dirty", "unstable"].includes(
      pr.mergeable_state ?? "",
    ) ||
    checks === "failure"
  )
    return "blocked";
  if ([...latest.values()].includes("CHANGES_REQUESTED"))
    return "changes_requested";
  if ([...latest.values()].includes("APPROVED"))
    return pr.mergeable === true && checks === "success" ? "ready" : "approved";
  return "needs_review";
}

export function allowanceWindow(
  config: { resetDay: number; resetHour: number },
  now = new Date(),
) {
  const candidate = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      config.resetDay,
      config.resetHour,
    ),
  );
  const offset = now < candidate ? -1 : 0;
  return {
    start: new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() + offset,
        config.resetDay,
        config.resetHour,
      ),
    ),
    reset: new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() + offset + 1,
        config.resetDay,
        config.resetHour,
      ),
    ),
  };
}
