import { readFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import { Sandbox } from "@vercel/sandbox";

/** Remote execution uses an offline, disposable VM with no application secrets. */
export class VercelSandbox {
  private sandbox?: Sandbox;
  private runner?: string;

  async create() {
    this.runner = await readFile(
      new URL("../sandbox/runner.mjs", import.meta.url),
      "utf8",
    );
    this.sandbox = await Sandbox.create({
      image: "vercel/sandbox/universal",
      networkPolicy: "deny-all",
      persistent: false,
      timeout: 30 * 60 * 1000,
      resources: { vcpus: 1 },
      env: { CI: "true" },
    });
    try {
      await this.sandbox.mkDir(`${this.sandbox.cwd}/work`);
    } catch (error) {
      await this.destroy();
      throw error;
    }
  }

  async op(payload: unknown) {
    const sandbox = this.sandbox;
    if (!sandbox || !this.runner) throw new Error("Sandbox is not running");
    let output = "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        if (output.length > 3000000) {
          controller.abort();
          callback(new Error("Sandbox output limit exceeded"));
        } else callback();
      },
    });
    try {
      const result = await sandbox.runCommand({
        cmd: "node",
        args: ["--input-type=module", "-e", this.runner],
        cwd: `${sandbox.cwd}/work`,
        env: {
          SANDBOX_WORK_ROOT: `${sandbox.cwd}/work`,
          HOME: "/tmp",
          CI: "true",
        },
        stdin: Readable.from([JSON.stringify(payload)]),
        stdout: stream,
        stderr: stream,
        signal: controller.signal,
      });
      if (result.exitCode !== 0)
        throw new Error(
          `Sandbox command failed (${result.exitCode}): ${output.slice(-2000)}`,
        );
      return output;
    } catch (error) {
      // Cancellation of an SDK request alone must not leave untrusted code running.
      await this.destroy();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async destroy() {
    const sandbox = this.sandbox;
    this.sandbox = undefined;
    if (sandbox) await sandbox.stop();
  }
}
