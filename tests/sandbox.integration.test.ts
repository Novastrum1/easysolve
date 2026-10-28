import { expect,it } from "vitest";
import { Sandbox } from "../worker/sandbox";
it("runs actual commands as non-root, denies network and host paths, captures failed tests", async () => {
  const s = new Sandbox(`test-${crypto.randomUUID()}`);
  try {
    await s.create();
    await s.op({
      type: "write",
      files: {
        "sum.test.js":
          "const {test}=require('node:test');const assert=require('node:assert');test('sum',()=>assert.equal(1+1,2));",
      },
    });
    const result = JSON.parse(
      await s.op({ type: "test", command: "node --test" }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pass 1");
    const denied = JSON.parse(
      await s.op({
        type: "test",
        command:
          "node -e \"require('fs').writeFileSync('/root/easysolve-test','x')\"",
      }),
    );
    expect(denied.exitCode).not.toBe(0);
    await expect(
      s.op({ type: "write", files: { "../escape": "x" } }),
    ).rejects.toThrow("Unsafe path");
    const env = JSON.parse(
      await s.op({
        type: "test",
        command: "id -u; printenv DEEPSEEK_API_KEY; printenv DATABASE_URL",
      }),
    );
    expect(env.stdout).toContain("10001");
    expect(env.stdout).not.toContain("postgresql");
    const net = JSON.parse(
      await s.op({
        type: "test",
        command:
          "node -e \"fetch('https://example.com',{signal:AbortSignal.timeout(1000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))\"",
      }),
    );
    expect(net.exitCode).not.toBe(0);
  } finally {
    await s.destroy();
  }
}, 30000);
