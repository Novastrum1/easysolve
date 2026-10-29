# Replacement selection in eu-north-1

Read-only account checks used ListFoundationModels, ListInferenceProfiles and GetFoundationModelAvailability. No replacement inference, agreement creation, subscription activation, IAM change, Region change or configuration update was performed. The saved evidence is [bedrock-model-availability.json](bedrock-model-availability.json).

## Recommendation for approval

MiniMax M2.5, exact Bedrock Runtime model ID:

```
minimax.minimax-m2.5
```

Keep AWS_REGION=eu-north-1. This is regional on-demand inference; no inference profile is needed. AWS's account availability API returned AUTHORIZED, entitlement AVAILABLE, agreement AVAILABLE, and region AVAILABLE. The catalog reports streaming enabled. These are stronger signals than a catalog listing, but actual inference and EasySolve tool compatibility remain unverified until the approved live tests succeed. No further activation is indicated by the account response.

AWS describes M2.5 as suitable for coding-heavy and tool-calling workloads. Its model card lists Converse, response streaming and structured outputs. Standard on-demand Stockholm pricing is USD 0.36 per million input tokens and USD 1.44 per million output tokens. For example, 10,000 input and 2,000 output tokens would be approximately USD 0.00648 before tax and any other AWS charges. This is a rate-based illustration, not an actual usage receipt or a promise of credit eligibility. Context is 196K tokens and maximum output is 8K, which accommodates EasySolve's current 6K output limit; reasoning can consume part of the output budget.

## Alternatives checked

| Candidate | Catalog | Account availability API | Qualification |
| --- | --- | --- | --- |
| MiniMax M2.5 | Listed, streaming | All four checks ready | Recommended; active, regional coding/agent option |
| Nova 2 Lite | Listed, streaming | All four checks ready | Exact EU profile eu.amazon.nova-2-lite-v1:0; processes across EU Regions, so different routing from regional MiniMax; general-purpose alternative |
| Qwen3 Coder 480B | Listed, streaming | All four checks ready | Exact ID qwen.qwen3-coder-480b-a35b-v1:0; coding specialist, but AWS marks it Legacy with EOL March 30, 2027 |
| Devstral 2 123B | Listed, streaming | All four checks ready | Exact ID mistral.devstral-2-123b; Stockholm USD 0.48 input / 2.40 output per million tokens; Legacy with EOL March 30, 2027 |
| Claude Haiku 4.5 | Listed, streaming; active EU profile | Authorization/entitlement/Region ready, agreement NOT_AVAILABLE | Not ready without account setup; do not invoke or accept agreements without approval |

None of these replacement models has been live-invoked in this selection step. API readiness cannot rule out a runtime permission restriction, quota or service-capacity issue.

## Required account setup and approved next steps

For MiniMax, no new agreement or entitlement setup is indicated. To review it in the console: Amazon Bedrock → Europe (Stockholm) → Model catalog → MiniMax M2.5. Do not accept any unexpected terms or activation prompt automatically. Existing bearer-auth and InvokeModel/InvokeModelWithResponseStream authorization still applies to the regional MiniMax model resource; no missing permission is currently established for this candidate.

Wait for explicit model approval before updating BEDROCK_MODEL_ID. After approval: change only the model setting, restart both services with the same production environment, compare their non-secret runtime configuration receipts, and perform bounded Converse, streaming, persisted chat and read-only tool checks. Record actual usage and only mark Verified on successful inference. Preserve existing conversations, users, GitHub credentials and publication confirmations. Stop and report any unexpected activation requirement or upstream error instead of switching again.

Sources:

- [AWS availability API and returned status meanings](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetFoundationModelAvailability.html)
- [MiniMax model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-minimax-minimax-m2-5.html)
- [AWS MiniMax coding and tool-calling guide](https://aws.amazon.com/blogs/machine-learning/run-minimax-models-on-amazon-bedrock/)
- [AWS Standard on-demand regional pricing](https://aws.amazon.com/bedrock/pricing/)
- [Nova 2 Lite profile IDs](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html)
- [Qwen lifecycle and capabilities](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-coder-480b-a35b-instruct.html)
- [Devstral lifecycle and capabilities](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-devstral-2-123b.html)

## Approved switch outcome

The user approved MiniMax M2.5. The private .env was updated, web and worker were restarted, and runtime receipts confirmed matching Region/model/endpoint/credential. All four live checks were attempted and rejected with AWS HTTP 429 ThrottlingException: "Too many tokens per day, please wait before trying again." Account availability checks did not establish usable runtime quota. No successful inference or usage receipt was recorded, and connection status remains failed/unverified. See [live results](minimax-live-verification.json). No AWS permission, agreement or subscription was changed.
