import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
import { VercelSandbox } from "../worker/vercel-sandbox";

// Only load the Sandbox authentication token, never the production database or AI keys.
const envFile = process.argv[2];
if (envFile) {
  const env = parse(await readFile(envFile));
  if (env.VERCEL_OIDC_TOKEN)
    process.env.VERCEL_OIDC_TOKEN = env.VERCEL_OIDC_TOKEN;
}
const sandbox = new VercelSandbox();
try {
  await sandbox.create();
  await sandbox.op({
    type: "write",
    files: { "check.cjs": "console.log(2 + 2)" },
  });
  const result = JSON.parse(
    await sandbox.op({ type: "test", command: "node check.cjs" }),
  );
  if (result.exitCode !== 0 || result.stdout.trim() !== "4")
    throw new Error("Execution check failed");
  const network = JSON.parse(
    await sandbox.op({
      type: "test",
      command:
        "node -e \"fetch('https://example.com',{signal:AbortSignal.timeout(2000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))\"",
    }),
  );
  if (network.exitCode === 0) throw new Error("Network isolation check failed");
  const credentials = JSON.parse(
    await sandbox.op({
      type: "test",
      command:
        "node -e \"for(const k of ['DATABASE_URL','TOKEN_ENCRYPTION_KEY','VERCEL_OIDC_TOKEN','OPENAI_API_KEY','AWS_BEARER_TOKEN_BEDROCK'])if(process.env[k])process.exit(1)\"",
    }),
  );
  if (credentials.exitCode !== 0)
    throw new Error("Credential isolation check failed");
  console.log(
    "Vercel Sandbox: file write, code execution, blocked outbound network, and credential isolation passed.",
  );
} finally {
  await sandbox.destroy();
}
