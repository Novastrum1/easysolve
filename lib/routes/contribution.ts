import {analyzeIssue,draftApplication} from "../issue-analysis";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ai } from "../ai";
import { applyProposal,propose } from "../assignments";
import { chat,chatAction } from "../chat";
import { db } from "../db";
import { github } from "../github";
import { repoName } from "../policy";
import { HttpError } from "../security";
import { prepareWave,waveSchema } from "../wave";
import type { RouteContext } from "./types";
const id = z.string().min(1).max(100);
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });
export async function handleContribution({
  request,
  path,
  body,
  url,
  u,
}: RouteContext) {
  const route = path.join("/");
  const method = request.method;
  if (route === "assignments/propose") {
    const input = z
      .object({
        identityId: id,
        repo: z.string(),
        usernames: z.array(z.string()).min(1).max(30),
        numbers: z.array(z.number().int().positive()).default([]),
        labels: z.string().default(""),
        additional: z.number().int().min(1).max(10),
        waveOnly: z.boolean(),
      })
      .parse(body);
    input.repo = repoName(input.repo);
    return json(await propose(u.id, input));
  }
  if (route === "assignments/apply")
    return json(await applyProposal(u.id, id.parse(body.proposalId)));
  if (route === "chat")
    return json(
      await chat(
        u.id,
        z.string().min(1).max(10000).parse(body.text),
        body.identityId,
        body.conversation ? id.parse(body.conversation) : "default",
      ),
    );
  if (route === "chat/confirm")
    return json(await chatAction(u.id, id.parse(body.messageId),body.activityIndex===undefined?undefined:z.number().int().nonnegative().parse(body.activityIndex)));
  if (route === "wave/prepare")
    return json(await prepareWave(u.id, waveSchema.parse(body)));
  if(route==='issues/analyze'){const input=z.object({identityId:id,repo:z.string(),number:z.number().int().positive()}).parse(body);const repo=repoName(input.repo);const issue=await(await github(u.id,input.identityId)).request(`/repos/${repo}/issues/${input.number}`);return json({analysis:await analyzeIssue(u.id,{repo,number:issue.number,title:issue.title,body:issue.body??''})});}
  if (route === "applications/draft") {
    const input = z
      .object({
        identityId: id,
        repo: z.string(),
        number: z.number().int().positive(),
        experience: z.string().max(6000),
        wave: z.string().max(100).default(""),
        complexity: z.string().max(40).default("moderate"),
        languages: z.array(z.string().max(30)).max(5).default([]),
      })
      .parse(body);
    const repo = repoName(input.repo);
    const issue = await (
      await github(u.id, input.identityId)
    ).request(`/repos/${repo}/issues/${input.number}`);
    const draft=await draftApplication(u.id,{repo,number:issue.number,title:issue.title,body:issue.body??''},input.experience,{complexity:input.complexity,languages:input.languages});
    return json(
      await db.application.create({
        data: {
          userId: u.id,
          identityId: input.identityId,
          repo,
          number: issue.number,
          title: issue.title,
          draft,
          wave: input.wave,
          complexity: input.complexity,
          languages: input.languages,
        },
      }),
    );
  }
  if (path[0] === "applications" && path[1]) {
    const a = await db.application.findFirst({
      where: { id: path[1], userId: u.id },
    });
    if (!a) throw new HttpError(404, "Application not found");
    if (path[2] === "post") {
      if (a.status === "posted")
        throw new HttpError(409, "Comment already posted");
      const draft = z.string().min(1).max(20000).parse(body.draft);
      const gh = await github(u.id, a.identityId);
      const marker = `<!-- easysolve-application:${a.id} -->`;
      const comments = await gh.pages(
        `/repos/${a.repo}/issues/${a.number}/comments`,
      );
      let posted = comments.find((c) => c.body.includes(marker));
      if (!posted)
        posted = await gh.request(
          `/repos/${a.repo}/issues/${a.number}/comments`,
          "POST",
          { body: `${draft}\n\n${marker}` },
        );
      await db.application.update({
        where: { id: a.id },
        data: { status: "posted", draft },
      });
      return json({ url: posted.html_url });
    }
    const input = z
      .object({
        draft: z.string().max(20000).optional(),
        status: z.enum(["pending", "applied"]).optional(),
      })
      .parse(body);
    return json(
      await db.application.update({ where: { id: a.id }, data: input }),
    );
  }
  return undefined;
}
