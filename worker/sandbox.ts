import { spawn } from "node:child_process";
export function command(
  args: string[],
  input?: string,
  timeout = 60000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: process.env.NODE_ENV ?? "production",
      },
    });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", (d) => {
      output += d;
      if (output.length > 3000000) child.kill("SIGKILL");
    });
    child.stderr.on("data", (d) => {
      output += d;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              `Sandbox command failed (${code}): ${output.slice(-2000)}`,
            ),
          );
    });
    child.stdin.end(input);
  });
}
export class Sandbox {
  name: string;
  constructor(id: string) {
    this.name = `easysolve-${id
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 40)}`;
  }
  async create() {
    await command(["rm", "-f", this.name]).catch(() => {});
    await command([
      "run",
      "-d",
      "--name",
      this.name,
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "128",
      "--memory",
      "768m",
      "--cpus",
      "1",
      "--user",
      "10001:10001",
      "--tmpfs",
      "/work:rw,nosuid,nodev,size=256m,uid=10001,gid=10001",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=64m,uid=10001,gid=10001",
      "--workdir",
      "/work",
      process.env.SANDBOX_IMAGE || "easysolve-sandbox:local",
      "sleep",
      "1800",
    ]);
  }
  async op(payload: unknown) {
    return command(
      ["exec", "-i", this.name, "node", "/runner.mjs"],
      JSON.stringify(payload),
      90000,
    );
  }
  async destroy() {
    await command(["rm", "-f", this.name]).catch(() => {});
  }
}
