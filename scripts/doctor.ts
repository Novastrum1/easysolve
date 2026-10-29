import "dotenv/config";
import { providerConfig } from "../lib/providers";
import { execFileSync } from "node:child_process";
import { db } from "../lib/db";
let failed = false;
console.log(`EasySolve diagnostics · Node ${process.version}`);
console.log(`Browser origin: ${process.env.APP_URL || "not configured"}`);
const provider = providerConfig();
console.log(
  `${provider.name}: ${provider.configured ? "key configured (not live-verified)" : "setup required"} · model ${provider.model || "selection required"}`,
);

const encryption =
  Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || "", "base64").length === 32;
console.log(
  `Token encryption: ${encryption ? "32-byte key configured" : "setup required"}`,
);
if (!encryption) failed = true;
try {
  const version = execFileSync(
    "docker",
    ["info", "--format", "{{.ServerVersion}}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  console.log(`Docker daemon: ${version}`);
  execFileSync(
    "docker",
    [
      "image",
      "inspect",
      process.env.SANDBOX_IMAGE || "easysolve-sandbox:local",
    ],
    { stdio: "ignore" },
  );
  console.log("Sandbox image: available");
} catch {
  console.log(
    "Docker/sandbox unavailable. Run npm run setup and check daemon permissions.",
  );
  failed = true;
}
try {
  await db.$queryRaw`SELECT 1`;
  const queued = await db.job.count({ where: { status: "queued" } });
  const running = await db.job.count({ where: { status: "running" } });
  console.log(
    `PostgreSQL: connected · ${queued} queued jobs · ${running} running jobs`,
  );
} catch {
  console.log(
    "PostgreSQL/schema unavailable. Check DATABASE_URL, Compose, and migrations.",
  );
  failed = true;
} finally {
  await db.$disconnect();
}
console.log(
  "Start both services with npm run start:all. No live provider requests were made.",
);
process.exitCode = failed ? 1 : 0;
