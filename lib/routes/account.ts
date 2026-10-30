import { connectGithubAccount, chooseGithubAccounts } from "../github-accounts";
import { entitlementSummary } from "../entitlements";
import { ai } from "../ai";
import { isProviderAdmin, providerStatus } from "../provider-status";
import { rateLimit } from "../security";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "../db";
import { GitHub, github } from "../github";
import { settingsSchema } from "../policy";
import { encrypt, hash, HttpError, session } from "../security";
import type { RouteContext } from "./types";
import { parseAuthInput, passwordChangeSchema } from "../auth-input";
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
  if (route === "provider/test") {
    if (!(await isProviderAdmin(u.id)))
      throw new HttpError(
        403,
        "Only a configured provider administrator can test the shared AI connection.",
      );
    await rateLimit(`provider-test:${u.id}`, 2);
    await ai(
      u.id,
      "connection_verification",
      "Reply with EASYSOLVE_OK only.",
      "Return the requested marker.",
    );
    return json(await providerStatus());
  }
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
    const input = parseAuthInput(passwordChangeSchema, body);
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
    const identity = await connectGithubAccount(u.id, account, token);
    return json({
      id: identity.id,
      login: identity.login,
      active: identity.active,
      usable: identity.usable,
      message:
        identity.active && identity.usable
          ? "GitHub identity connected and validated."
          : "Token updated. Select this identity in Usable GitHub identities to enable it.",
    });
  }
  if (route === "identities/selection")
    return json(
      await chooseGithubAccounts(u.id, z.array(id).max(100).parse(body.ids)),
    );
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
      await db.identity.update({
        where: { id: identity.id },
        data: { active: false, usable: false, status: "disconnected" },
      });
      return json({ ok: true });
    }
    if (path[2] === "validate") {
      await (await github(u.id, identity.id)).request("/user");
      await db.identity.update({
        where: { id: identity.id },
        data: { status: "connected" },
      });
    } else {
      const active = z.boolean().parse(body.active);
      if (active) {
        const current = await db.identity.findMany({
          where: { userId: u.id, active: true, usable: true },
          select: { id: true },
        });
        await chooseGithubAccounts(u.id, [
          ...current.map((i) => i.id),
          identity.id,
        ]);
      } else
        await db.identity.update({
          where: { id: identity.id },
          data: { active: false, usable: false },
        });
    }
    return json({ ok: true });
  }
  return undefined;
}
