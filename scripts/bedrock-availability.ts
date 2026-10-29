import "../lib/load-env";
import { writeFile } from "node:fs/promises";
import { bedrockConfig } from "../lib/providers/bedrock";
import { sanitizeBedrockText } from "../lib/providers/bedrock-diagnostics";
const c = bedrockConfig();
if (!c.key || !c.region)
  throw Error("Set the private bearer key and Region first.");
const base = `https://bedrock.${c.region}.amazonaws.com`;
async function get(path: string) {
  const response = await fetch(base + path, {
    headers: { Authorization: `Bearer ${c.key}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  if (!response.ok)
    return {
      httpStatus: response.status,
      requestId: response.headers.get("x-amzn-requestid"),
      exception: body.__type,
      message: sanitizeBedrockText(body.message),
    };
  return body;
}
const catalog = await get("/foundation-models?byOutputModality=TEXT");
const candidates = [
  "amazon.nova-2-lite-v1:0",
  "qwen.qwen3-coder-480b-a35b-v1:0",
  "mistral.devstral-2-123b",
  "anthropic.claude-haiku-4-5-20251001-v1:0",
  "minimax.minimax-m2.5",
];
const profiles: any[] = [];
let nextToken: string | undefined;
do {
  const page = await get(
    "/inference-profiles?typeEquals=SYSTEM_DEFINED" +
      (nextToken ? `&nextToken=${encodeURIComponent(nextToken)}` : ""),
  );
  if (page.httpStatus) {
    profiles.push(page);
    break;
  }
  profiles.push(...(page.inferenceProfileSummaries ?? []));
  nextToken = page.nextToken;
} while (nextToken);
const models = [];
for (const id of candidates) {
  const model = catalog.modelSummaries?.find((m: any) => m.modelId === id);
  models.push({
    id,
    catalogListed: !!model,
    streaming: model?.responseStreamingSupported,
    inferenceTypes: model?.inferenceTypesSupported,
    availability: await get(
      `/foundation-model-availability/${encodeURIComponent(id)}`,
    ),
    profiles: profiles
      .filter(
        (p) =>
          p.models?.some((m: any) => m.modelArn?.endsWith(`/` + id)) ||
          p.inferenceProfileId?.endsWith(id),
      )
      .map((p) => ({
        id: p.inferenceProfileId,
        status: p.status,
        arn: p.inferenceProfileArn,
      })),
  });
}
const report = {
  at: new Date().toISOString(),
  region: c.region,
  readOnly: true,
  inferenceAttempted: false,
  catalogError: catalog.httpStatus ? catalog : undefined,
  models,
};
await writeFile(
  "docs/bedrock-model-availability.json",
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(report, null, 2));
