import { beforeEach,expect,it,vi } from "vitest";
import {
csrf,
decrypt,
encrypt,
publicError,
safeEqual,
} from "../lib/security";
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("../lib/db", () => ({ db: {} }));
beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString("base64");
  process.env.APP_URL = "https://easy.test";
});
it("authenticates encrypted tokens and randomizes ciphertext", () => {
  const token = "github_pat_private_token";
  const a = encrypt(token),
    b = encrypt(token);
  expect(a).not.toBe(b);
  expect(a).not.toContain(token);
  expect(decrypt(a)).toBe(token);
  const p = a.split(".");
  const bytes = Buffer.from(p[2], "base64");
  bytes[0] ^= 1;
  p[2] = bytes.toString("base64");
  expect(() => decrypt(p.join("."))).toThrow();
});
it("refuses missing encryption keys", () => {
  delete process.env.TOKEN_ENCRYPTION_KEY;
  expect(() => encrypt("secret")).toThrow("Configure");
});
it("rejects cross origin writes and missing Origin", () => {
  expect(() =>
    csrf(
      new Request("https://easy.test/api", {
        headers: { origin: "https://evil.test" },
      }),
    ),
  ).toThrow();
  expect(() => csrf(new Request("https://easy.test/api"))).toThrow();
  expect(() =>
    csrf(
      new Request("https://easy.test/api", {
        headers: { origin: "https://easy.test" },
      }),
    ),
  ).not.toThrow();
});
it("never returns internal errors or secrets", () => {
  expect(publicError(new Error("token=secret database password"))).toEqual({
    status: 500,
    error: "The operation could not be completed. Check server diagnostics.",
  });
  expect(safeEqual("a", "a")).toBe(true);
  expect(safeEqual("a", "b")).toBe(false);
});

it("accepts Codespaces origin rewriting only for the configured host and same-origin browser requests", () => {
  process.env.APP_URL = "https://example-3000.app.github.dev";
  const headers = {
    origin: "http://localhost:3000",
    host: "localhost:3000",
    "x-forwarded-host": "example-3000.app.github.dev",
    "sec-fetch-site": "same-origin",
  };
  const check = (overrides: Record<string, string> = {}) =>
    csrf(new Request("http://localhost:3000/api/auth/login", {
      headers: { ...headers, ...overrides },
    }));
  expect(() => check()).not.toThrow();
  const rejectedHeaders: Record<string, string>[] = [
    { origin: "https://evil.test" },
    { origin: "null" },
    { "x-forwarded-host": "other-3000.app.github.dev" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "" },
    { host: "evil.test" },
  ];
  for (const overrides of rejectedHeaders)
    expect(() => check(overrides)).toThrow("Request origin rejected");
  process.env.APP_URL = "https://production.example";
  expect(() => check()).toThrow("Request origin rejected");
});

it("patch fingerprints survive PostgreSQL JSON key ordering", async () => {
  const { patchHash } = await import("../lib/security");
  expect(patchHash({ "z.js": "z", "a.js": "a" })).toBe(
    patchHash({ "a.js": "a", "z.js": "z" }),
  );
  expect(patchHash({ "a.js": "changed", "z.js": "z" })).not.toBe(
    patchHash({ "a.js": "a", "z.js": "z" }),
  );
});
