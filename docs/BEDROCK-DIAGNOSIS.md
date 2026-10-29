# Bedrock access diagnosis

The two requested live requests both reached AWS and returned HTTP 403 AccessDeniedException. Their full sanitized response messages are identical:

> openai.gpt-6.1-terra is not available for this account. You can explore other available models on Amazon Bedrock. For additional access options, contact AWS Sales at https://aws.amazon.com/contact-us/sales-support/

| Operation | Request ID | Endpoint |
| --- | --- | --- |
| Converse | 03e748d6-4b1d-4e3a-ac28-15d1914073c3 | https://bedrock-runtime.eu-north-1.amazonaws.com/model/global.openai.gpt-6.1-terra/converse |
| ConverseStream | f11ba1a3-3338-40b1-9912-ffd288626d5b | https://bedrock-runtime.eu-north-1.amazonaws.com/model/global.openai.gpt-6.1-terra/converse-stream |

Region: eu-north-1. Model/profile: global.openai.gpt-6.1-terra. Authentication: server-side AWS_BEARER_TOKEN_BEDROCK with explicit SDK httpBearerAuth; no access-key pair or alternate provider was used. The sandbox's initial DNS failures never reached AWS; the two live calls ran with network approval, no SDK retries, and maxTokens=32.

Read-only GetInferenceProfile succeeded with HTTP 200, request ID 164c6cef-e973-46d9-a218-9b584b52f55f. It returned ACTIVE and these exact resources:

```
arn:aws:bedrock:eu-north-1:743691382332:inference-profile/global.openai.gpt-6.1-terra
arn:aws:bedrock:eu-north-1::foundation-model/openai.gpt-6.1-terra
arn:aws:bedrock:::foundation-model/openai.gpt-6.1-terra
```

The model and inference profile are discoverable, but AWS denies account access to generation. This is not a streaming-only failure. Neither response identifies an IAM principal, missing action, explicit SCP deny, expired token, or wrong credential Region. Successful profile discovery does not prove every inference permission is granted; the evidence nevertheless identifies account model availability as the immediate blocker. IAM policies and organization policies were not enumerated or modified.

## Smallest supported next step

Open [AWS Contact Sales](https://aws.amazon.com/contact-us/sales-support/) (the destination specified in the error). Sign in/select account 743691382332 and request **GPT-6.1 Terra access on Amazon Bedrock Runtime through global.openai.gpt-6.1-terra, source Region eu-north-1**. Include the two AWS request IDs above. The Bedrock console location for reviewing the model is Amazon Bedrock → Europe (Stockholm) → Model catalog → GPT-6.1 Terra → Programmatic access. Catalog visibility and ACTIVE profile status are not model entitlement.

No IAM policy change is justified by this response, so no permission-grant policy is proposed as a fix. No subscription, agreement, Region/model change, IAM edit or organization-policy bypass was performed. After AWS confirms account access, rerun the diagnostic explicitly; do not automatically retry or change providers.

## Operation authorization reference

- Converse requires bedrock:InvokeModel.
- ConverseStream requires bedrock:InvokeModelWithResponseStream.
- Global inference authorization evaluates the profile, regional foundation model and Region-agnostic foundation model listed above. The source evaluation uses eu-north-1; the global foundation-model evaluation uses aws:RequestedRegion=unspecified. The bedrock:InferenceProfileArn condition applies to foundation-model evaluations, not the profile evaluation.
- Bedrock bearer usage is separately controlled by bedrock:CallWithBearerToken (AWS documents its deny policies with Resource=* and optional bedrock:bearerTokenType conditions). An explicit organization deny cannot be resolved by adding an identity Allow. Nothing in these two errors establishes that this bearer gate or an SCP is the blocker.

These are documented requirements, not a finding of missing permissions. If a later AWS response identifies a missing action/resource, construct a narrowly scoped policy from that evidence; do not apply broad permissions to address account entitlement.

## Evidence and application changes

[Full sanitized live evidence](bedrock-diagnostic.json) includes operation, exception, HTTP status, complete message, request ID, endpoint, Region and model/profile. [Running-service configuration evidence](bedrock-runtime-configuration.json) is generated with the diagnostic's --config-only mode after service restart; this mode makes no AWS requests.

The adapter logs allowlisted AWS exception fields to server stderr before producing a safe UI error. It never logs raw SDK objects, headers, request bodies or credentials. The account-unavailable response now produces AI_MODEL_ACCOUNT_ACCESS and tells the user to request AWS account model access, rather than suggesting repeated retries. Startup instrumentation records non-secret configuration for web and worker. Private local receipts contain credential digests only to compare configuration; digests are excluded from logs and reports.

Reproduce the two live requests only when explicitly desired:

```
NODE_ENV=production node --import tsx scripts/diagnose-bedrock.ts
```

Check both running services without a paid request:

```
NODE_ENV=production node --import tsx scripts/diagnose-bedrock.ts --config-only
```

Official sources consulted:

- [GPT-6.1 Terra model card, IDs and Stockholm global availability](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-1-terra.html)
- [Converse action requirement](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html)
- [ConverseStream action requirement](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html)
- [Global inference IAM resource and SCP requirements](https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html)
- [Bearer-token permission controls](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-permissions.html)

Validation of diagnostic changes: production build and TypeScript passed; 73 unit tests passed. The integration rerun passed 48 of 49 tests; the Docker coding-agent fixture was terminated (137), and its isolated retry encountered a stopped container (128). These Docker fixture failures are separate from the AWS account-access diagnosis. Running web and worker configuration receipts both matched the production Region, model, endpoint and credential digest; no bearer value or digest is included in the report. A final browser asset scan found zero bearer-key matches.
