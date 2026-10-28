import { cookies } from "next/headers";
import {
createCipheriv,
createDecipheriv,
createHash,
randomBytes,
timingSafeEqual,
} from "node:crypto";
import { db } from "./db";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function key() {
  const k = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32)
    throw new HttpError(
      503,
      "Configure TOKEN_ENCRYPTION_KEY (32 bytes, base64)",
    );
  return k;
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((b) => b.toString("base64"))
    .join(".");
}
export function decrypt(value: string) {
  const [iv, tag, data] = value.split(".").map((s) => Buffer.from(s, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function user() {
  const token = (await cookies()).get("es_session")?.value;
  if (!token) throw new HttpError(401, "Sign in to your workspace");
  const s = await db.session.findUnique({
    where: { id: hash(token) },
    include: { user: true },
  });
  if (!s || s.expiresAt < new Date())
    throw new HttpError(401, "Session expired. Please sign in.");
  return s.user;
}
export async function session(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await db.session.create({
    data: {
      id: hash(token),
      userId,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    },
  });
  (await cookies()).set("es_session", token, {
    httpOnly: true,
    secure:
      process.env.NODE_ENV === "production" &&
      process.env.COOKIE_SECURE !== "false",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  });
}
export function csrf(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_URL || new URL(request.url).origin;
  if (!origin || origin !== expected)
    throw new HttpError(403, "Request origin rejected");
}
export async function rateLimit(key: string, limit = 30) {
  const now = new Date();
  await db.rateLimit.deleteMany({ where: { key, expiresAt: { lt: now } } });
  const record = await db.rateLimit.upsert({
    where: { key },
    create: { key, count: 1, expiresAt: new Date(Date.now() + 60000) },
    update: { count: { increment: 1 } },
  });
  if (record.count > limit)
    throw new HttpError(429, "Too many requests. Try again in a minute.");
}
export function publicError(e: unknown) {
  if (e instanceof HttpError) return { status: e.status, error: e.message };
  return {
    status: 500,
    error: "The operation could not be completed. Check server diagnostics.",
  };
}

export function patchHash(files: Record<string, string>) {
  return hash(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    ),
  );
}
