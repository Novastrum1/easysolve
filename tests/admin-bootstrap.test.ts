import { beforeEach, expect, it, vi } from "vitest";
const { tx, transaction } = vi.hoisted(() => ({
  tx: {
    $executeRaw: vi.fn(),
    user: { count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    adminBootstrap: { findUnique: vi.fn(), create: vi.fn() },
    adminAudit: { create: vi.fn() },
  },
  transaction: vi.fn(),
}));
vi.mock("../lib/db", () => ({ db: { $transaction: transaction } }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { bootstrapAdmin, redactDiagnostic } from "../lib/admin";

beforeEach(() => {
  vi.resetAllMocks();
  transaction.mockImplementation((operation) => operation(tx));
  tx.adminBootstrap.findUnique.mockResolvedValue(null);
  tx.user.count.mockResolvedValue(0);
  tx.user.findUnique.mockResolvedValue({
    id: "chosen-owner",
    role: "USER",
    suspendedAt: null,
  });
});
it("promotes exactly the selected existing email account and records the one-time bootstrap", async () => {
  expect(await bootstrapAdmin({ email: "Owner@Example.test" })).toBe(
    "chosen-owner",
  );
  expect(tx.user.findUnique).toHaveBeenCalledWith({
    where: { email: "owner@example.test" },
  });
  expect(tx.user.update).toHaveBeenCalledExactlyOnceWith({
    where: { id: "chosen-owner" },
    data: { role: "ADMIN" },
  });
  expect(tx.adminBootstrap.create).toHaveBeenCalledWith({
    data: { id: "owner", userId: "chosen-owner" },
  });
  expect(tx.adminAudit.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      actorId: "chosen-owner",
      targetId: "chosen-owner",
      action: "owner.bootstrap",
    }),
  });
});
it("supports an exact user ID and never creates an account", async () => {
  await bootstrapAdmin({ userId: "chosen-owner" });
  expect(tx.user.findUnique).toHaveBeenCalledWith({
    where: { id: "chosen-owner" },
  });
  tx.user.findUnique.mockResolvedValue(null);
  tx.user.update.mockClear();
  await expect(bootstrapAdmin({ userId: "missing" })).rejects.toThrow(
    "Existing account not found",
  );
  expect(tx.user.update).not.toHaveBeenCalled();
});
it("refuses reuse, an existing administrator, suspended targets, and ambiguous selectors", async () => {
  await expect(bootstrapAdmin({})).rejects.toThrow("exactly one");
  await expect(
    bootstrapAdmin({ userId: "owner", email: "owner@example.test" }),
  ).rejects.toThrow("exactly one");
  tx.adminBootstrap.findUnique.mockResolvedValue({ id: "owner" });
  await expect(bootstrapAdmin({ userId: "owner" })).rejects.toThrow("already");
  tx.adminBootstrap.findUnique.mockResolvedValue(null);
  tx.user.count.mockResolvedValue(1);
  await expect(bootstrapAdmin({ userId: "owner" })).rejects.toThrow("already");
  tx.user.count.mockResolvedValue(0);
  tx.user.findUnique.mockResolvedValue({
    id: "owner",
    suspendedAt: new Date(),
  });
  await expect(bootstrapAdmin({ userId: "owner" })).rejects.toThrow(
    "suspended",
  );
  expect(tx.user.update).not.toHaveBeenCalled();
});
it("redacts configured provider keys and bearer credentials from job diagnostics", () => {
  vi.stubEnv("OPENAI_API_KEY", "fixture-secret-provider-key");
  expect(
    redactDiagnostic("failure fixture-secret-provider-key Bearer other-secret"),
  ).toBe("failure [redacted] Bearer [redacted]");
  vi.unstubAllEnvs();
});
