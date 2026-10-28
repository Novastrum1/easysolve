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

it("patch fingerprints survive PostgreSQL JSON key ordering", async () => {
  const { patchHash } = await import("../lib/security");
  expect(patchHash({ "z.js": "z", "a.js": "a" })).toBe(
    patchHash({ "a.js": "a", "z.js": "z" }),
  );
  expect(patchHash({ "a.js": "changed", "z.js": "z" })).not.toBe(
    patchHash({ "a.js": "a", "z.js": "z" }),
  );
});
