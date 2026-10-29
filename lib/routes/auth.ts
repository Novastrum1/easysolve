import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { hash, HttpError, rateLimit, session } from "../security";
import type { RouteContext } from "./types";
import {
  loginSchema,
  signupSchema,
  recoverySchema,
  resetSchema,
  parseAuthInput,
} from "../auth-input";
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
    if (route === "auth/signup") {
      const input = parseAuthInput(signupSchema, body);
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
    const input = parseAuthInput(loginSchema, body);
    const u = await db.user.findUnique({ where: { email: input.email } });
    if (!u || !(await bcrypt.compare(input.password, u.password)))
      throw new HttpError(401, "Email or password is incorrect");
    if (u.suspendedAt)
      throw new HttpError(
        403,
        "This account is suspended. Contact the operator.",
      );
    await session(u.id);
    return json({ ok: true });
  }
  if (route === "auth/recover") {
    await rateLimit("recover", 5);
    const { email } = parseAuthInput(recoverySchema, body);
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
    const input = parseAuthInput(resetSchema, body);
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
