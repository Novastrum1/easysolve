import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerConfig } from "./providers";
export const runtimePath = (service: "web" | "worker") =>
  join(tmpdir(), `easysolve-provider-${service}.json`);
export async function recordProviderRuntime(service: "web" | "worker") {
  const config = providerConfig();
  const safe = {
    service,
    pid: process.pid,
    at: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV ?? null,
    provider: config.id,
    region: "region" in config ? config.region : null,
    model: config.model,
    endpoint: config.baseURL,
    bearerPresent: config.id === "bedrock" && !!config.key,
  };
  // Digest is kept in a private local receipt, never in browser responses or logs.
  await writeFile(
    runtimePath(service),
    JSON.stringify({
      ...safe,
      credentialDigest: createHash("sha256").update(config.key).digest("hex"),
    }) + "\n",
    { mode: 0o600 },
  );
  console.log("EasySolve provider configuration", JSON.stringify(safe));
}
