import { creditMergedRun } from "../entitlements";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "../db";
import { github, reviewQueue } from "../github";
import { repoName } from "../policy";
import { HttpError } from "../security";
import type { RouteContext } from "./types";
const id = z.string().min(1).max(100);
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });
export async function handleReviews({
  request,
  path,
  body,
  url,
  u,
}: RouteContext) {
  const route = path.join("/");
  const method = request.method;
  if (route === "reviews" && method === "GET")
    return json(await reviewQueue(u.id));
  if (route === "reviews/detail") {
    const input = z
      .object({
        identityId: id,
        repo: z.string(),
        number: z.number().int().positive(),
      })
      .parse(body);
    const repo = repoName(input.repo);
    if (
      !(await db.repository.findFirst({
        where: { userId: u.id, fullName: repo, identityId: input.identityId },
      }))
    )
      throw new HttpError(403, "Repository is not managed");
    const gh = await github(u.id, input.identityId);
    const pr = await gh.request(`/repos/${repo}/pulls/${input.number}`);
    const files = await gh.pages(`/repos/${repo}/pulls/${input.number}/files`);
    return json({
      head: pr.head.sha,
      files: files.map((f) => ({
        filename: f.filename,
        patch: f.patch ?? "Binary or large file; inspect on GitHub",
      })),
    });
  }
  if (route === "reviews/action") {
    const input = z
      .object({
        identityId: id,
        repo: z.string(),
        number: z.number().int().positive(),
        sha: z.string().regex(/^[a-f0-9]{40}$/),
        action: z.enum(["approve", "changes", "comment", "merge"]),
        body: z.string().max(10000).default(""),
      })
      .parse(body);
    const repo = repoName(input.repo);
    if (
      !(await db.repository.findFirst({
        where: { userId: u.id, fullName: repo, identityId: input.identityId },
      }))
    )
      throw new HttpError(403, "Repository is not managed");
    const gh = await github(u.id, input.identityId);
    const pr = await gh.request(`/repos/${repo}/pulls/${input.number}`);
    if (pr.head.sha !== input.sha)
      throw new HttpError(
        409,
        "PR head changed. Review the new diff before acting.",
      );
    if (input.action === "merge") {
      const queue = await reviewQueue(u.id);
      const item = queue.find(
        (i) => i.repo === repo && i.number === input.number,
      );
      if (item?.category !== "ready")
        throw new HttpError(
          409,
          "PR is not approved with passing checks and mergeability",
        );
      const merged = await gh.request(
        `/repos/${repo}/pulls/${input.number}/merge`,
        "PUT",
        { sha: input.sha, merge_method: "squash" },
      );
      if (!merged.merged) throw new HttpError(409, "GitHub rejected merge");
      const linked = await db.run.findMany({
        where: { userId: u.id, repo, prNumber: input.number },
      });
      for (const run of linked) {
        await creditMergedRun(u.id, run.id);
        await db.issue.updateMany({
          where: { userId: u.id, id: { in: run.issueIds as string[] } },
          data: { status: "done" },
        });
      }
      return json(merged);
    }
    if (input.action === "changes" && !input.body.trim())
      throw new HttpError(422, "Explain the requested changes");
    return json(
      await gh.request(`/repos/${repo}/pulls/${input.number}/reviews`, "POST", {
        commit_id: input.sha,
        event:
          input.action === "approve"
            ? "APPROVE"
            : input.action === "changes"
              ? "REQUEST_CHANGES"
              : "COMMENT",
        body: input.body,
      }),
    );
  }
  return undefined;
}
