import "dotenv/config";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { db } from "../lib/db";
import { hash } from "../lib/security";
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
const ids: string[] = [];
const ratePrefix = `auth-integration-${crypto.randomUUID()}`;
const setCookie = vi.fn();
let email = "",
  originalHash = "";
const origin = "http://localhost:3000";
async function call(action: string, body: unknown) {
  return api(
    new Request(`${origin}/api/auth/${action}`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Forwarded-For": `${ratePrefix}-${crypto.randomUUID()}`,
      },
      body: JSON.stringify(body),
    }),
    ["auth", action],
  );
}
beforeAll(async () => {
  vi.stubEnv("APP_URL", origin);
  vi.mocked(cookies).mockResolvedValue({ set: setCookie } as any);
  email = `auth-${crypto.randomUUID()}@example.test`;
  originalHash = await bcrypt.hash("eight123", 4);
  ids.push(
    (
      await db.user.create({
        data: { email, name: "Existing login fixture", password: originalHash },
      })
    ).id,
  );
});
afterAll(async () => {
  await db.rateLimit.deleteMany({
    where: { key: { startsWith: `auth:${ratePrefix}` } },
  });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  vi.unstubAllEnvs();
  await db.$disconnect();
});
it("authenticates an existing account with omitted or null signup-only fields without changing its hash", async () => {
  for (const extra of [{}, { name: null, token: null, redirect: null }]) {
    expect(
      (
        await call("login", {
          email: email.toUpperCase(),
          password: "eight123",
          ...extra,
        })
      ).status,
    ).toBe(200);
  }
  expect(setCookie).toHaveBeenCalled();
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: ids[0] } })).password,
  ).toBe(originalHash);
});
it("rejects missing/null/empty credentials with actionable field errors and no session", async () => {
  const sessions = await db.session.count({ where: { userId: ids[0] } });
  for (const [body, field] of [
    [{ password: "eight123" }, "email"],
    [{ email }, "password"],
    [{ email: null, password: "eight123" }, "email"],
    [{ email, password: null }, "password"],
    [{ email: "", password: "eight123" }, "email"],
    [{ email, password: "" }, "password"],
    [{ email: "invalid-email", password: "eight123" }, "email"],
  ] as const) {
    const response = await call("login", body);
    expect(response.status).toBe(422);
    const result = await response.json();
    expect(result.fieldErrors[field]).toBe(
      field === "password"
        ? "Enter your password."
        : body.email === "invalid-email"
          ? "Enter a valid email address."
          : "Enter your email address.",
    );
    expect(JSON.stringify(result)).not.toMatch(
      /Invalid input|expected string|eight123/,
    );
  }
  expect(await db.session.count({ where: { userId: ids[0] } })).toBe(sessions);
});
it("rejects invalid credentials consistently without revealing account existence", async () => {
  for (const [account, password] of [
    [email, "wrong-password"],
    [`unknown-${crypto.randomUUID()}@example.test`, "eight123"],
    [email, "wrong"],
  ]) {
    const response = await call("login", { email: account, password });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Email or password is incorrect",
    });
  }
});
it("creates a normal account with an eight-character password and supports subsequent login", async () => {
  const signupEmail = `signup-${crypto.randomUUID()}@example.test`;
  expect(
    (
      await call("signup", {
        email: signupEmail,
        name: "Signup fixture",
        password: "short7",
      })
    ).status,
  ).toBe(422);
  expect(
    await db.user.findUnique({ where: { email: signupEmail } }),
  ).toBeNull();
  expect(
    (
      await call("signup", {
        email: signupEmail,
        name: "Signup fixture",
        password: "eight123",
        role: "ADMIN",
      })
    ).status,
  ).toBe(200);
  const account = await db.user.findUniqueOrThrow({
    where: { email: signupEmail },
  });
  ids.push(account.id);
  expect(account.role).toBe("USER");
  expect(await bcrypt.compare("eight123", account.password)).toBe(true);
  expect(
    (await call("login", { email: signupEmail, password: "eight123" })).status,
  ).toBe(200);
});
it("handles missing recovery/reset fields and accepts an eight-character replacement via a one-use reset", async () => {
  const recovery = await call("recover", { email: null });
  expect(recovery.status).toBe(422);
  expect((await recovery.json()).fieldErrors.email).toBe(
    "Enter your email address.",
  );
  const missing = await call("reset", { token: null, password: "eight123" });
  expect(missing.status).toBe(422);
  expect((await missing.json()).fieldErrors.token).toContain(
    "Request a new link",
  );
  const token = `fixture-reset-${crypto.randomUUID()}`;
  await db.reset.create({
    data: {
      id: hash(token),
      userId: ids[0],
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  expect((await call("reset", { token, password: "newpass8" })).status).toBe(
    200,
  );
  expect((await call("login", { email, password: "newpass8" })).status).toBe(
    200,
  );
  expect((await call("reset", { token, password: "newpass8" })).status).toBe(
    422,
  );
});
