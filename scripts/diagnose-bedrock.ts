import "../lib/load-env";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { bedrockConfig } from "../lib/providers/bedrock";
import { logBedrockException } from "../lib/providers/bedrock-diagnostics";
import { createHash } from "node:crypto";
import { runtimePath } from "../lib/provider-runtime";
import { readFile } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
const c = bedrockConfig();
const report: { at: string; configuration: unknown; requests: unknown[] } = {
  at: new Date().toISOString(),
  configuration: {
    provider: process.env.AI_PROVIDER,
    region: c.region,
    model: c.model,
    endpoint: c.baseURL,
    bearerPresent: !!c.key,
    configured: c.configured,
    nodeEnv: process.env.NODE_ENV,
  },
  requests: [],
};
console.log(JSON.stringify(report.configuration));
if (!c.configured || process.env.AI_PROVIDER !== "bedrock")
  throw Error("Complete Bedrock configuration before diagnosis.");
const services = [];
for (const service of ["web", "worker"] as const) {
  try {
    const receipt = JSON.parse(await readFile(runtimePath(service), "utf8"));
    let running = true;
    try {
      process.kill(receipt.pid, 0);
    } catch {
      running = false;
    }
    const { credentialDigest, ...safe } = receipt;
    services.push({
      ...safe,
      running,
      matchesEffectiveConfiguration:
        running &&
        receipt.provider === process.env.AI_PROVIDER &&
        receipt.region === c.region &&
        receipt.model === c.model &&
        receipt.endpoint === c.baseURL &&
        credentialDigest === createHash("sha256").update(c.key).digest("hex"),
    });
  } catch {
    services.push({
      service,
      verified: false,
      detail:
        "No accessible runtime receipt; restart service with configuration instrumentation.",
    });
  }
}
console.log(JSON.stringify({ services }));
if (process.argv.includes("--config-only")) {
  await writeFile(
    "docs/bedrock-runtime-configuration.json",
    JSON.stringify({ at: new Date().toISOString(), services }, null, 2) + "\n",
  );
  process.exit(
    services.every(
      (s) =>
        "matchesEffectiveConfiguration" in s && s.matchesEffectiveConfiguration,
    )
      ? 0
      : 1,
  );
}
const client = new BedrockRuntimeClient({
  region: c.region,
  endpoint: c.baseURL,
  token: { token: c.key },
  authSchemePreference: ["httpBearerAuth"],
  maxAttempts: 1,
});
const input = {
  modelId: c.model,
  messages: [{ role: "user" as const, content: [{ text: "Reply OK." }] }],
  inferenceConfig: { maxTokens: 32 },
};
try {
  for (const operation of ["Converse", "ConverseStream"] as const) {
    const context = {
      operation,
      endpoint: `${c.baseURL}/model/${encodeURIComponent(c.model)}/${operation === "Converse" ? "converse" : "converse-stream"}`,
      region: c.region,
      model: c.model,
    };
    try {
      if (operation === "Converse") {
        const response = await client.send(new ConverseCommand(input), {
          abortSignal: AbortSignal.timeout(c.timeout),
        });
        const result = {
          ...context,
          status: "success",
          httpStatus: response.$metadata.httpStatusCode,
          requestId: response.$metadata.requestId,
          stopReason: response.stopReason,
          usage: response.usage,
        };
        report.requests.push(result);
        console.log(JSON.stringify(result));
      } else {
        const response = await client.send(new ConverseStreamCommand(input), {
          abortSignal: AbortSignal.timeout(c.timeout),
        });
        let stopReason: string | undefined, usage: unknown;
        for await (const event of response.stream ?? []) {
          if (event.messageStop) stopReason = event.messageStop.stopReason;
          if (event.metadata) usage = event.metadata.usage;
          for (const name of [
            "internalServerException",
            "modelStreamErrorException",
            "serviceUnavailableException",
            "throttlingException",
            "validationException",
          ] as const)
            if (event[name])
              throw Object.assign(new Error(event[name]?.message), {
                name,
                $metadata: response.$metadata,
              });
        }
        const result = {
          ...context,
          status: stopReason ? "success" : "incomplete",
          httpStatus: response.$metadata.httpStatusCode,
          requestId: response.$metadata.requestId,
          stopReason,
          usage,
        };
        report.requests.push(result);
        console.log(JSON.stringify(result));
      }
    } catch (error) {
      report.requests.push({
        status: "failed",
        ...logBedrockException(error, context),
      });
      process.exitCode = 1;
    }
  }
} finally {
  client.destroy();
  await writeFile(
    "docs/bedrock-diagnostic.json",
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
}
