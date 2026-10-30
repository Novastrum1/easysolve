import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  mkDir: vi.fn(),
  runCommand: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@vercel/sandbox", () => ({ Sandbox: { create: mocks.create } }));
import { VercelSandbox } from "../worker/vercel-sandbox";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue({ cwd: "/vercel", ...mocks });
  mocks.mkDir.mockResolvedValue(undefined);
  mocks.stop.mockResolvedValue(undefined);
});

it("creates an offline disposable VM and sends only the operation to execution", async () => {
  const sandbox = new VercelSandbox();
  await sandbox.create();
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      networkPolicy: "deny-all",
      persistent: false,
      timeout: 1800000,
      env: { CI: "true" },
    }),
  );
  mocks.runCommand.mockImplementation(async (options) => {
    let input = "";
    for await (const chunk of options.stdin) input += chunk;
    expect(JSON.parse(input)).toEqual({ type: "list" });
    expect(options.env).toEqual({
      SANDBOX_WORK_ROOT: "/vercel/work",
      HOME: "/tmp",
      CI: "true",
    });
    options.stdout.write("[]\n");
    return { exitCode: 0 };
  });
  expect(await sandbox.op({ type: "list" })).toBe("[]\n");
  await sandbox.destroy();
  await sandbox.destroy();
  expect(mocks.stop).toHaveBeenCalledTimes(1);
});

it("stops the VM if command execution fails", async () => {
  const sandbox = new VercelSandbox();
  await sandbox.create();
  mocks.runCommand.mockRejectedValue(new Error("request aborted"));
  await expect(sandbox.op({ type: "list" })).rejects.toThrow("request aborted");
  expect(mocks.stop).toHaveBeenCalledTimes(1);
});

it("cleans up a VM if workspace initialization fails", async () => {
  const sandbox = new VercelSandbox();
  mocks.mkDir.mockRejectedValue(new Error("workspace unavailable"));
  await expect(sandbox.create()).rejects.toThrow("workspace unavailable");
  expect(mocks.stop).toHaveBeenCalledTimes(1);
});
