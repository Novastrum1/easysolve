# Amazon Bedrock setup

EasySolve routes chat, history context, GitHub tool previews, issue analysis, assignment assistance, application drafts, and coding-agent planning/editing/repair through the selected provider adapter. Ordinary chat and tools use ConverseStream; schema-constrained text uses Converse for model compatibility. Existing PostgreSQL data, GitHub credentials, queue, authorization, sandbox and publication approval gates are retained. No database migration is required.

Configure the private root `.env`:

```dotenv
AI_PROVIDER=bedrock
AWS_BEARER_TOKEN_BEDROCK=
AWS_REGION=
BEDROCK_MODEL_ID=
BEDROCK_TIMEOUT_MS=
```

Enter the bearer key only in the private server environment. Never place it in chat, screenshots, Git, NEXT_PUBLIC variables, OPENAI_API_KEY, or AGENTROUTER_API_KEY. `.env` is ignored and must remain untracked. Both Next and the worker/operator scripts use Next's environment-file precedence; use the same NODE_ENV, working directory and process environment for both services. Production: NODE_ENV=production. A .env.local or service environment overrides .env.

Find the Region in the AWS console's top-right Region selector, using the Region in which the key was generated. Do not infer it from a model name. In the regional Bedrock console, open Model catalog, inspect a coding model's model card for Converse, streaming and client-side tool calling, then copy the exact Programmatic access model or inference-profile ID. Catalog presence does not establish account access. `npm run bedrock:models` performs read-only catalog/profile discovery; list permissions are separate from inference permissions. If denied, use Model catalog and Inference profiles in the console or ask an administrator for bedrock:ListFoundationModels and bedrock:ListInferenceProfiles. The discovery script reports when a catalog has another page; use the console to inspect further entries.

The active user-approved configuration is AWS_REGION=eu-north-1 and BEDROCK_MODEL_ID=minimax.minimax-m2.5. This uses regional on-demand inference without an inference profile. Web and worker have been restarted with matching configuration. Live generation is currently blocked by AWS HTTP 429 ThrottlingException: "Too many tokens per day, please wait before trying again." See [MiniMax live verification](minimax-live-verification.json); the connection remains unverified.

Earlier authenticated discovery in eu-north-1 listed openai.gpt-6.1-terra and the active profile global.openai.gpt-6.1-terra. The AWS model card documents that Bedrock Runtime requires an inference profile for this model, so that earlier attempt used global.openai.gpt-6.1-terra; AWS subsequently confirmed this model was unavailable to the account. This profile permits global cross-region processing; select another supported profile/model if regional residency is required. Access is verified only by successful inference, never by catalog discovery. No model or Region is defaulted or silently substituted.

The key principal needs bedrock:InvokeModelWithResponseStream for ConverseStream (and bedrock:InvokeModel if using Converse elsewhere), with model/profile resources and cross-region destinations allowed by IAM and organizational policies. For access errors, check the key expiration, source Region, IAM policies, inference-profile permissions, regional quotas and model access. If the console asks to subscribe, accept terms, or submit provider access information, review it yourself; EasySolve does not activate subscriptions or accept agreements. Static short-term keys expire; rotate the server value and restart both services. AWS service errors are sanitized.

Run `npm run ai:verify` after setup. It makes small live requests for a streaming completion, persisted chat and a harmless check_jobs tool call using a temporary fixture user, records actual usage, removes the fixture, and writes docs/ai-live-verification.json. No GitHub writes or coding runs are performed. Structured output and tool arguments are schema validated; malformed, filtered or incomplete results cannot execute actions. EasySolve's tools are locally dispatched previews/read operations: their results are persisted in message activity and included in subsequent workspace history, rather than using an autonomous provider-side tool loop.

Restart web and worker using your service supervisor after changing configuration. For a local production build, run `npm run build`, then `NODE_ENV=production npm start` and `NODE_ENV=production npm run worker:start` in separate terminals. Settings shows Amazon Bedrock, Region, model and Configured / Verified / Connection failed. Only successful live generations create verification receipts; receipts expire after 24 hours and are bound to key, endpoint/Region and model. AI_ADMIN_USER_IDS controls the existing operator connection-test button.

Limits: AI_MAX_OUTPUT_TOKENS (6000), AI_MAX_INPUT_BYTES (200000), AI_REQUESTS_PER_MINUTE (20 per user), AI_GLOBAL_REQUESTS_PER_MINUTE (60), AI_JOB_MAX_TOKENS (500000), AI_JOB_MAX_REQUESTS (18), BEDROCK_TIMEOUT_MS (90000 maximum), RUN_TIMEOUT_MS and WORKER_CONCURRENCY. Usage rows retain provider/model and actual input/cache-read/output token receipts, including completed receipts for rejected output. No AgentRouter or OpenAI price estimates apply to Bedrock. Cache writes are included in input totals. Interrupted streams may incur AWS charges without a returned usage receipt; no token count is invented. Check AWS billing for charges; credit eligibility has not been confirmed.

Official references:

- [Bedrock API-key authentication](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-use.html)
- [AWS SDK authentication scheme preference](https://docs.aws.amazon.com/sdkref/latest/guide/feature-auth-scheme.html)
- [ConverseStream JavaScript SDK](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-runtime/command/ConverseStreamCommand/)
- [Structured outputs](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html)
- [GPT-6.1 Terra capabilities and exact profile IDs](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-1-terra.html)

AgentRouter and direct OpenAI remain optional adapters. Their credentials and configuration are not required or used when AI_PROVIDER=bedrock.

## Remaining access setup after the live denial

1. AWS console → Amazon Bedrock → Europe (Stockholm) → API keys: check the selected key's expiration and generating Region. Update the private server value if expired; do not paste it into chat.
2. Amazon Bedrock → Model catalog → GPT-6.1 Terra: review model access and Programmatic access. The Runtime ID is global.openai.gpt-6.1-terra. Do not automatically accept terms or activate Marketplace subscriptions.
3. IAM → the identity associated with the key → Permissions: have the account administrator check bedrock:InvokeModel and bedrock:InvokeModelWithResponseStream on this inference profile and underlying model resources. Check permission boundaries, organization SCPs and destination-Region restrictions for global inference. List permissions alone do not permit inference.
4. Restart both services after credential/configuration changes, then run npm run ai:verify. The report must show all three checks verified before considering chat/tool access live-verified.

## Migration validation

Production build and TypeScript passed. Unit tests: 70 passed. Integration tests: 49 passed. Desktop/mobile workspace browser tests: 4 passed. `.env` is ignored and untracked; final browser assets contain no configured bearer key. Web and worker were restarted with NODE_ENV=production.

Authenticated catalog discovery verified the listed Region/profile, but live inference returned AI_FORBIDDEN. Live chat and harmless tool verification remain blocked; no usage was invented and no GitHub writes were performed. See [sanitized live report](ai-live-verification.json).

Changed files (the private ignored `.env` was also updated with the selected model profile):

- `.env.example`
- `README.md`
- `components/admin-dashboard.tsx`
- `components/pages/settings.tsx`
- `components/pages/work.tsx`
- `components/ui.tsx`
- `components/workspace.tsx`
- `docs/BEDROCK.md`
- `docs/ai-live-verification.json`
- `lib/ai.ts`
- `lib/chat.ts`
- `lib/load-env.ts`
- `lib/provider-status.ts`
- `lib/providers/agentrouter.ts`
- `lib/providers/bedrock.ts`
- `lib/providers/index.ts`
- `lib/providers/openai.ts`
- `lib/routes/contribution.ts`
- `package-lock.json`
- `package.json`
- `scripts/bedrock-models.ts`
- `scripts/doctor.ts`
- `scripts/verify-ai.ts`
- `tests/bedrock-workflows.integration.test.ts`
- `tests/bedrock.test.ts`
- `tests/browser/workspace.spec.ts`
- `worker/index.ts`
