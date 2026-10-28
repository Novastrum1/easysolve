import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
if (!fs.existsSync(".env")) {
  let env = fs
    .readFileSync(".env.example", "utf8")
    .replace(
      "TOKEN_ENCRYPTION_KEY=",
      "TOKEN_ENCRYPTION_KEY=" + crypto.randomBytes(32).toString("base64"),
    );
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
  "Ready. Set DEEPSEEK_API_KEY in .env if needed, then npm run start:all. Port 3000 stays private.",
);
