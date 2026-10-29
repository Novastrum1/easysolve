import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
if (!fs.existsSync(".env")) {
  const dbPassword = crypto.randomBytes(24).toString("hex");
  let env = fs
    .readFileSync(".env.example", "utf8")
    .replace(
      "TOKEN_ENCRYPTION_KEY=",
      "TOKEN_ENCRYPTION_KEY=" + crypto.randomBytes(32).toString("base64"),
    );
  env = env
    .replace(
      "DATABASE_URL=",
      `DATABASE_URL=postgresql://easysolve:${dbPassword}@localhost:5432/easysolve`,
    )
    .replace("POSTGRES_PASSWORD=", `POSTGRES_PASSWORD=${dbPassword}`)
    .replace("APP_URL=", "APP_URL=http://localhost:3000");
  if (process.env.CODESPACE_NAME)
    env = env.replace(
      "APP_URL=http://localhost:3000",
      `APP_URL=https://${process.env.CODESPACE_NAME}-3000.app.github.dev`,
    );
  fs.writeFileSync(".env", env, { mode: 0o600 });
  console.log("Created private .env with encryption key.");
}
for (const [bin, args] of [
  ["docker", ["compose", "up", "-d", "--wait"]],
  ["npm", ["run", "db:generate"]],
  ["npm", ["run", "db:migrate"]],
  ["docker", ["build", "-t", "easysolve-sandbox:local", "sandbox"]],
]) {
  console.log(`Running ${bin} ${args.join(" ")}`);
  execFileSync(bin, args, { stdio: "inherit" });
}
console.log(
  "Ready. Configure the selected provider’s private key in .env if needed, then npm run start:all. Port 3000 stays private.",
);
