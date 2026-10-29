import "../lib/load-env";
// Read-only control-plane discovery; bearer access may not include list permissions.
const region = process.env.AWS_REGION?.trim();
const key = process.env.AWS_BEARER_TOKEN_BEDROCK?.trim();
if (!key || !region || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)) {
  console.log(
    "Set AWS_REGION and AWS_BEARER_TOKEN_BEDROCK privately first. Region is shown in the AWS console top-right Region selector.",
  );
  process.exitCode = 1;
} else {
  for (const path of [
    "/foundation-models?byOutputModality=TEXT",
    "/inference-profiles?typeEquals=SYSTEM_DEFINED",
  ]) {
    try {
      const response = await fetch(
        `https://bedrock.${region}.${region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com"}${path}`,
        {
          headers: { Authorization: `Bearer ${key}` },
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) {
        console.log(
          `Discovery ${path.split("?")[0]}: HTTP ${response.status}. This does not mean no models exist. In the regional Bedrock console, open Model catalog and Inference profiles. Ask your administrator for bedrock:ListFoundationModels and bedrock:ListInferenceProfiles if needed.`,
        );
        process.exitCode = 1;
        continue;
      }
      const data = await response.json();
      console.log(
        JSON.stringify(
          {
            region,
            candidates:
              data.modelSummaries?.map((m: any) => ({
                id: m.modelId,
                name: m.modelName,
                streaming: m.responseStreamingSupported,
              })) ??
              data.inferenceProfileSummaries?.map((m: any) => ({
                id: m.inferenceProfileId,
                name: m.inferenceProfileName,
                status: m.status,
              })),
            nextPage: !!data.nextToken,
          },
          null,
          2,
        ),
      );
      console.log(
        "Catalog entries do not establish account access or tool support. Confirm the model card, then verify the selected exact ID with npm run ai:verify.",
      );
    } catch {
      console.log(
        "Model discovery could not connect. Check networking and the regional Bedrock console. No model availability conclusion can be drawn.",
      );
      process.exitCode = 1;
    }
  }
}
