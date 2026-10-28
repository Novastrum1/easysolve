import { db } from "./db";
import { github } from "./github";
import { settings } from "./policy";
import { HttpError } from "./security";
export type Entry = {
  number: number;
  title: string;
  login: string;
  existing: number;
  state: string;
  error?: string;
};
export async function propose(
  userId: string,
  input: {
    identityId: string;
    repo: string;
    usernames: string[];
    numbers: number[];
    labels: string;
    additional: number;
    waveOnly: boolean;
  },
) {
  const gh = await github(userId, input.identityId);
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const limit = settings(u.settings).waveLimit;
  const issues = await gh.pages(
    `/repos/${input.repo}/issues?state=open${input.labels ? `&labels=${encodeURIComponent(input.labels)}` : ""}`,
  );
  const candidates = issues.filter(
    (i) =>
      !i.pull_request &&
      !i.assignees.length &&
      (!input.numbers.length || input.numbers.includes(i.number)) &&
      (!input.waveOnly || i.labels.some((l: any) => /wave/i.test(l.name))),
  );
  const entries: Entry[] = [];
  let index = 0;
  for (const login of [...new Set(input.usernames)]) {
    if (!/^[\w-]{1,39}$/.test(login))
      throw new HttpError(422, `Invalid username ${login}`);
    await gh.request(`/repos/${input.repo}/assignees/${login}`);
    const existing = issues.filter(
      (i) =>
        !i.pull_request &&
        i.assignees.some(
          (a: any) => a.login.toLowerCase() === login.toLowerCase(),
        ) &&
        (!input.waveOnly || i.labels.some((l: any) => /wave/i.test(l.name))),
    ).length;
    for (
      let i = 0;
      i < Math.min(input.additional, Math.max(0, limit - existing)) &&
      index < candidates.length;
      i++
    ) {
      const issue = candidates[index++];
      entries.push({
        number: issue.number,
        title: issue.title,
        login,
        existing,
        state: "pending",
      });
    }
  }
  if (!entries.length)
    throw new HttpError(
      422,
      "No assignable issues within the configured Wave limit",
    );
  return db.proposal.create({
    data: { userId, identityId: input.identityId, repo: input.repo, entries },
  });
}
export async function applyProposal(userId: string, id: string) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`assign:${userId}`}))`;
      const p = await tx.proposal.findFirst({
        where: { id, userId, state: { in: ["preview", "partial"] } },
      });
      if (!p)
        throw new HttpError(409, "Proposal unavailable or already applied");
      const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const limit = settings(u.settings).waveLimit;
      const gh = await github(userId, p.identityId);
      const entries = p.entries as Entry[];
      for (const entry of entries) {
        if (entry.state === "applied") continue;
        try {
          const issue = await gh.request(
            `/repos/${p.repo}/issues/${entry.number}`,
          );
          if (issue.assignees.some((a: any) => a.login === entry.login)) {
            entry.state = "applied";
            continue;
          }
          if (issue.state !== "open" || issue.assignees.length)
            throw new Error("Issue is no longer unassigned");
          const all = await gh.pages(
            `/repos/${p.repo}/issues?state=open&assignee=${encodeURIComponent(entry.login)}`,
          );
          if (all.filter((i) => !i.pull_request).length >= limit)
            throw new Error("Assignment limit reached");
          const applied = await gh.request(
            `/repos/${p.repo}/issues/${entry.number}/assignees`,
            "POST",
            { assignees: [entry.login] },
          );
          if (!applied.assignees.some((a: any) => a.login === entry.login))
            throw new Error("GitHub did not apply assignment");
          entry.state = "applied";
          delete entry.error;
        } catch (e) {
          entry.state = "failed";
          entry.error = e instanceof Error ? e.message : "Assignment failed";
        }
      }
      return tx.proposal.update({
        where: { id: p.id },
        data: {
          entries,
          state: entries.every((e) => e.state === "applied")
            ? "applied"
            : "partial",
        },
      });
    },
    { timeout: 120000 },
  );
}
