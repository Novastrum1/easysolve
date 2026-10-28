import bcrypt from "bcryptjs";
import "dotenv/config";
import { afterAll,beforeAll,expect,it,vi } from "vitest";
import { db } from "../lib/db";
import { handleAuth } from "../lib/routes/auth";
import { hash } from "../lib/security";
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
let userId = "",
  email = "";
beforeAll(async () => {
  email = `recovery-${crypto.randomUUID()}@example.test`;
  userId = (
    await db.user.create({
      data: {
        email,
        name: "Recovery fixture",
        password: await bcrypt.hash("old-long-password", 4),
      },
    })
  ).id;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.RECOVERY_WEBHOOK_URL;
  delete process.env.RECOVERY_WEBHOOK_SECRET;
  await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});
it("delivers one-use reset links through the configured adapter and revokes sessions", async () => {
  process.env.RECOVERY_WEBHOOK_URL = "https://adapter.example.test/recovery";
  process.env.RECOVERY_WEBHOOK_SECRET = "fixture-secret";
  const provider = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", provider);
  const request = new Request("http://localhost/api/auth/recover", {
    method: "POST",
  });
  await handleAuth({
    request,
    path: ["auth", "recover"],
    body: { email },
    url: new URL("http://localhost"),
  });
  const sent = JSON.parse(provider.mock.calls[0][1].body);
  expect(sent.email).toBe(email);
  expect(provider.mock.calls[0][1].headers.Authorization).toBe(
    "Bearer fixture-secret",
  );
  const token = new URL(sent.url).searchParams.get("reset")!;
  expect(token.length).toBeGreaterThan(32);
  expect((await db.reset.findFirstOrThrow({ where: { userId } })).id).toBe(
    hash(token),
  );
  await db.session.create({
    data: {
      id: hash("fixture-session"),
      userId,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const context = {
    request,
    path: ["auth", "reset"],
    body: { token, password: "new-secure-password-123" },
    url: new URL("http://localhost"),
  };
  expect((await handleAuth(context))?.status).toBe(200);
  expect(await db.session.count({ where: { userId } })).toBe(0);
  expect(
    await bcrypt.compare(
      "new-secure-password-123",
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).password,
    ),
  ).toBe(true);
  await expect(handleAuth(context)).rejects.toThrow("expired");
});
