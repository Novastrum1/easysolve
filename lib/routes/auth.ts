import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { hash,HttpError,rateLimit,session } from "../security";
import type { RouteContext } from "./types";
const authSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(12).max(128),
  name: z.string().min(1).max(80).optional(),
});
const id = z.string().min(1).max(100);
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });
export async function handleAuth({
  request,
  path,
  body,
  url,
}: Omit<RouteContext, "u">) {
  const route = path.join("/");
  const method = request.method;
  if (route === "auth/signup" || route === "auth/login") {
    await rateLimit(
      `auth:${request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"}`,
      10,
    );
    const input = authSchema.parse(body);
    if (route === "auth/signup") {
      if (await db.user.findUnique({ where: { email: input.email } }))
        throw new HttpError(409, "An account with this email already exists");
      const u = await db.user.create({
        data: {
          email: input.email,
          name: input.name ?? input.email.split("@")[0],
          password: await bcrypt.hash(input.password, 12),
        },
      });
      await session(u.id);
      return json({ ok: true });
    }
    const u = await db.user.findUnique({ where: { email: input.email } });
    if (!u || !(await bcrypt.compare(input.password, u.password)))
      throw new HttpError(401, "Email or password is incorrect");
    await session(u.id);
    return json({ ok: true });
  }
  if (route === "auth/recover") {
    await rateLimit("recover", 5);
    const email = z.email().parse(body.email).toLowerCase();
    const u = await db.user.findUnique({ where: { email } });
    if (u) {
      if (!process.env.RECOVERY_WEBHOOK_URL)
        throw new HttpError(
          503,
          "Account recovery delivery is not configured. Contact your operator.",
        );
      const token = randomBytes(32).toString("base64url");
      await db.reset.create({
        data: {
          id: hash(token),
          userId: u.id,
          expiresAt: new Date(Date.now() + 1800000),
        },
      });
      const sent = await fetch(process.env.RECOVERY_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.RECOVERY_WEBHOOK_SECRET ?? ""}`,
        },
        body: JSON.stringify({
          email: u.email,
          url: `${process.env.APP_URL}/?reset=${token}`,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!sent.ok)
        throw new HttpError(
          503,
          "Recovery delivery failed. Contact your operator.",
        );
    }
    return json({
      message: "If this account exists, a recovery link has been sent.",
    });
  }
  if (route === "auth/reset") {
    const input = z
      .object({ token: id, password: z.string().min(12).max(128) })
      .parse(body);
    const password = await bcrypt.hash(input.password, 12);
    await db.$transaction(async (tx) => {
      const r = await tx.reset.findFirst({
        where: { id: hash(input.token), expiresAt: { gt: new Date() } },
      });
      if (!r) throw new HttpError(422, "Recovery link expired");
      await tx.reset.delete({ where: { id: r.id } });
      await tx.user.update({ where: { id: r.userId }, data: { password } });
      await tx.session.deleteMany({ where: { userId: r.userId } });
    });
    return json({ ok: true });
  }
  return undefined;
}
