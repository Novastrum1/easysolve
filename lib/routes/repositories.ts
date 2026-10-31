import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "../db";
import { github, syncIssues } from "../github";
import { repoName } from "../policy";
import { enqueue } from "../queue";
import { HttpError } from "../security";
import type { RouteContext } from "./types";
const id = z.string().min(1).max(100);
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });
export async function handleRepositories({
  request,
  path,
  body,
  url,
  u,
}: RouteContext) {
  const route = path.join("/");
  const method = request.method;
  if (route === "repositories" && method === "POST") {
    const input = z.object({ identityId: id, repo: z.string() }).parse(body);
    const name = repoName(input.repo);
    const gh = await github(u.id, input.identityId);
    const r = await gh.request(`/repos/${name}`);
    if (!r.permissions?.admin && !r.permissions?.maintain)
      throw new HttpError(
        403,
        "Repository admin or maintain permission is required",
      );
    const saved = await db.repository.upsert({
      where: { userId_fullName: { userId: u.id, fullName: r.full_name } },
      create: {
        userId: u.id,
        identityId: input.identityId,
        fullName: r.full_name,
        defaultBranch: r.default_branch,
      },
      update: { identityId: input.identityId, health: "connected" },
    });
    return json(saved);
  }
  if (path[0] === "repositories" && path[1]) {
    const r = await db.repository.findFirst({
      where: { id: path[1], userId: u.id },
    });
    if (!r) throw new HttpError(404, "Repository not found");
    if (path[2] === "sync") {
      await enqueue(
        u.id,
        "repository_sync",
        `repo-sync:${r.id}:${Math.floor(Date.now() / 60000)}`,
        { repositoryId: r.id },
      );
      return json({ message: "Repository health sync queued" });
    }
    if (method === "DELETE")
      await db.repository.delete({ where: { id: r.id } });
    return json({ ok: true });
  }
  if (route === "sync") {
    const identities = await db.identity.findMany({
      where: {
        userId: u.id,
        active: true,
        usable: true,
        ...(body.identityId ? { id: id.parse(body.identityId) } : {}),
      },
    });
    if (!identities.length)
      throw new HttpError(422, "Connect an active GitHub identity first");
    const results: { identityId: string; count: number }[] = [];
    for (const i of identities)
      results.push({
        identityId: i.id,
        count: (await syncIssues(u.id, i.id)).count,
      });
    const count = results.reduce((total, result) => total + result.count, 0);
    return json({
      count,
      identities: results,
      message: `Synced ${count} assigned issue${count === 1 ? "" : "s"}.`,
    });
  }
  if (route === "discover") {
    const identityId = id.parse(url.searchParams.get("identityId"));
    const repo = repoName(url.searchParams.get("repo") ?? "");
    const gh = await github(u.id, identityId);
    const issues = await gh.pages(`/repos/${repo}/issues?state=open`);
    return json(
      issues
        .filter((i) => !i.pull_request)
        .map((i) => ({
          repo,
          number: i.number,
          title: i.title,
          body: i.body ?? "",
          labels: i.labels.map((l: any) => l.name),
          assignees: i.assignees.map((a: any) => a.login),
          url: i.html_url,
        })),
    );
  }
  if (route === "issues/import") {
    const input = z
      .object({
        identityId: id,
        repo: z.string(),
        number: z.number().int().positive(),
      })
      .parse(body);
    const repo = repoName(input.repo);
    const gh = await github(u.id, input.identityId);
    const i = await gh.request(`/repos/${repo}/issues/${input.number}`);
    if (i.pull_request)
      throw new HttpError(422, "This number is a pull request");
    return json(
      await db.issue.upsert({
        where: { userId_repo_number: { userId: u.id, repo, number: i.number } },
        create: {
          userId: u.id,
          identityId: input.identityId,
          repo,
          number: i.number,
          title: i.title,
          body: i.body ?? "",
          labels: i.labels.map((l: any) => l.name),
          assignees: i.assignees.map((a: any) => a.login),
          url: i.html_url,
        },
        update: { title: i.title },
      }),
    );
  }
  return undefined;
}
