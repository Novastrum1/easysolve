import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "../db";
import { GitHub,github } from "../github";
import { settingsSchema } from "../policy";
import { encrypt,hash,HttpError,session } from "../security";
import type { RouteContext } from "./types";
const id = z.string().min(1).max(100);
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });
export async function handleAccount({
  request,
  path,
  body,
  url,
  u,
}: RouteContext) {
  const route = path.join("/");
  const method = request.method;
  if (route === "auth/logout") {
    const c = await cookies();
    const token = c.get("es_session")?.value;
    if (token)
      await db.session.deleteMany({ where: { id: hash(token), userId: u.id } });
    c.delete("es_session");
    return json({ ok: true });
  }
  if (route === "profile") {
    const input = z.object({ name: z.string().min(1).max(80) }).parse(body);
    await db.user.update({ where: { id: u.id }, data: input });
    return json({ ok: true });
  }
  if (route === "password") {
    const input = z
      .object({ current: z.string(), password: z.string().min(12).max(128) })
      .parse(body);
    if (!(await bcrypt.compare(input.current, u.password)))
      throw new HttpError(403, "Current password is incorrect");
    await db.user.update({
      where: { id: u.id },
      data: { password: await bcrypt.hash(input.password, 12) },
    });
    await db.session.deleteMany({ where: { userId: u.id } });
    await session(u.id);
    return json({ ok: true });
  }
  if (route === "sessions/revoke") {
    await db.session.deleteMany({ where: { userId: u.id } });
    await session(u.id);
    return json({ ok: true });
  }
  if (route === "settings") {
    const input = settingsSchema.parse(body);
    await db.user.update({ where: { id: u.id }, data: { settings: input } });
    return json({ ok: true });
  }
  if (route === "identities" && method === "POST") {
    const token = z.string().min(20).max(300).parse(body.token);
    const gh = new GitHub(token);
    const account = await gh.request("/user");
    const identity = await db.identity.upsert({
      where: { userId_login: { userId: u.id, login: account.login } },
      create: { userId: u.id, login: account.login, token: encrypt(token) },
      update: { token: encrypt(token), status: "connected", active: true },
    });
    return json({ id: identity.id, login: identity.login });
  }
  if (path[0] === "identities" && path[1]) {
    const identity = await db.identity.findFirst({
      where: { id: path[1], userId: u.id },
    });
    if (!identity) throw new HttpError(404, "Identity not found");
    if (method === "DELETE") {
      if (
        await db.run.count({
          where: {
            userId: u.id,
            identityId: identity.id,
            status: { in: ["queued", "running"] },
          },
        })
      )
        throw new HttpError(409, "Cancel active runs before disconnecting");
      await db.identity.delete({ where: { id: identity.id } });
      return json({ ok: true });
    }
    if (path[2] === "validate") {
      await (await github(u.id, identity.id)).request("/user");
      await db.identity.update({
        where: { id: identity.id },
        data: { status: "connected" },
      });
    } else
      await db.identity.update({
        where: { id: identity.id },
        data: { active: z.boolean().parse(body.active) },
      });
    return json({ ok: true });
  }
  return undefined;
}
