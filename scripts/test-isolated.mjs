// Create a fresh local test database; never clear or migrate the application's database.
import fs from "node:fs";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import dotenv from "dotenv";
import pg from "pg";
const local = dotenv.parse(fs.readFileSync(".env"));
const source = new URL(local.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(source.hostname))
  throw Error("Isolated tests require a local PostgreSQL server in root .env");
const name = `easysolve_test_${crypto.randomBytes(8).toString("hex")}`;
const admin = new pg.Client({ connectionString: source.toString() });
await admin.connect();
await admin.query(`CREATE DATABASE "${name}"`);
source.pathname = `/${name}`;
const env = {
  ...process.env,
  DATABASE_URL: source.toString(),
  TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
  AI_PROVIDER: "deepseek",
  DEEPSEEK_API_KEY: "mocked-isolated-tests",
  AI_REQUESTS_PER_MINUTE: "200",
  AI_GLOBAL_REQUESTS_PER_MINUTE: "1000",
};
let web;
try {
  for (const args of [
    ["run", "db:migrate"],
    ...(process.argv.includes("--browser")
      ? []
      : [["run", "test:integration"]]),
  ]) {
    const result = spawnSync("npm", args, { env, stdio: "inherit" });
    if (result.status !== 0) {
      process.exitCode = result.status || 1;
      break;
    }
  }
  if (process.argv.includes("--browser") && !process.exitCode) {
    const testEnv = {
      ...env,
      APP_URL: "http://localhost:3000",
      COOKIE_SECURE: "false",
      NODE_ENV: "production",
    };
    const log = fs.openSync("/tmp/easysolve-browser-web.log", "w", 0o600);
    web = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"],
      { env: testEnv, stdio: ["ignore", log, log] },
    );
    fs.closeSync(log);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        ready = (await fetch("http://localhost:3000/api/health")).ok;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready) throw Error("Isolated browser server did not start");
    const result = spawnSync(
      "npm",
      [
        "run",
        "test:browser",
        "--",
        ...process.argv.slice(2).filter((arg) => arg !== "--browser"),
      ],
      {
        env: testEnv,
        stdio: "inherit",
      },
    );
    process.exitCode = result.status || 0;
  }
} finally {
  if (web) {
    const closed = new Promise((resolve) => web.once("exit", resolve));
    web.kill("SIGTERM");
    await closed;
  }
  await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
