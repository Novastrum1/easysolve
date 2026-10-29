# EasySolve

**From issue to reviewed pull request.**

A self-hosted GitHub coding-agent application with a Next.js interface, PostgreSQL persistence, a durable worker, AgentRouter Chat Completions and optional direct OpenAI Responses integration, and isolated Docker execution. The interface includes contributor and maintainer workflows, original branding, dark/light themes, and responsive navigation. There are no simulated live issues, runs, usage figures, or provider connections.

## Start in Codespaces or locally

Requires Node.js 24, npm, Docker with Compose, and access to a Docker daemon. The devcontainer supplies Node and Docker. Keep the Codespaces preview **private**.

```bash
npm ci
npm run setup
npm run start:all
```

`setup` creates a private `.env` with a random encryption key if it does not exist, starts PostgreSQL, generates Prisma Client, applies migrations, and builds the sandbox image. `start:all` starts both the web app and durable worker. Open port **3000**. The web server binds `0.0.0.0`; PostgreSQL is bound to localhost:5432 only. No Redis is required: the queue uses PostgreSQL row locks, leases, and unique idempotency keys.

Create your account in the application. Connect GitHub in **Account**. Set `AI_PROVIDER=agentrouter`, `AGENTROUTER_BASE_URL=https://co.agentrouter.org/v1`, `AGENTROUTER_API_KEY` and a catalog-verified `AGENTROUTER_MODEL` in the private root `.env`, then restart the app and worker. Direct OpenAI remains optional with `AI_PROVIDER=openai` and a separate `OPENAI_API_KEY`. GitHub workflows work without an AI key. Key presence alone does not verify provider access.

In Codespaces, set `APP_URL=https://<codespace-name>-3000.app.github.dev`. The setup script does this automatically when creating `.env`. It must match the exact browser origin for CSRF protection. Never expose preview port 3000 publicly without reviewing the production deployment instructions.

## Commands

| Command                    | Purpose                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- |
| `npm run setup`            | Initialize local infrastructure, environment, migrations, and sandbox image   |
| `npm run start:all`        | Start web development server and worker together                              |
| `npm run dev`              | Web server only, port 3000                                                    |
| `npm run worker:start`     | Worker without file watching                                                  |
| `npm run doctor`           | Check configuration, database, Docker and sandbox without live provider calls |
| `npm run db:generate`      | Generate Prisma Client                                                        |
| `npm run db:migrate`       | Apply versioned migrations                                                    |
| `npm run build`            | Compile and type-check production Next.js app                                 |
| `npm start`                | Serve production build on port 3000                                           |
| `npm run typecheck`        | Type-check application, worker, and tests                                     |
| `npm test`                 | Deterministic unit/provider-boundary tests                                    |
| `npm run test:integration` | PostgreSQL, workflow, and actual Docker sandbox tests                         |
| `npm run test:browser`     | Desktop and mobile Chromium tests against a running localhost:3000 app        |
| `npm run db:seed`          | Explicit development account only; requires `SEED_EMAIL` and `SEED_PASSWORD`  |

`npm run ai:verify` makes live requests to the selected provider, consumes provider tokens, and writes a sanitized report to `docs/ai-live-verification.json`. It uses temporary database fixtures for two bounded connection/chat requests; it performs no coding-agent or GitHub actions. Run it only when live provider verification is intended.

Browser setup: `npx playwright install --with-deps chromium`. Integration/browser tests create uniquely named fixture accounts and remove their own records. Use a local disposable database. They never call live AI providers or GitHub write APIs. Do not point the test environment at production.

## Credentials and configuration

Copy the documented names in [.env.example](.env.example); never commit `.env`.

| Variable                  | Meaning                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | PostgreSQL connection string; production records, sessions, jobs, artifacts, usage                         |
| `POSTGRES_PASSWORD`       | Local Compose database password; change with `DATABASE_URL` for production                                 |
| `APP_URL`                 | Exact browser origin, no trailing slash; CSRF and recovery links                                           |
| `TOKEN_ENCRYPTION_KEY`    | Base64-encoded 32-byte AES-256-GCM key; `openssl rand -base64 32`                                          |
| `OPENAI_API_KEY`        | Server-only OpenAI API key; never given to the sandbox                                                   |
| `OPENAI_MODEL`          | Configurable Responses-compatible model, default `gpt-6-astra`; access depends on your OpenAI account |
| `AI_MAX_OUTPUT_TOKENS`    | Per-request output ceiling, default 6,000                                                                  |
| `PLAN_NAME`               | Self-hosted plan label, default Personal                                                                   |
| `PLAN_MAX_JOBS`           | Server-enforced monthly job ceiling per user, default 50                                                   |
| `PLAN_MAX_TOKENS`         | Server-enforced monthly token ceiling per user, default 1,000,000                                          |
| `SANDBOX_IMAGE`           | Trusted locally built execution image, default `easysolve-sandbox:local`                                   |
| `WORKER_CONCURRENCY`      | Global active job ceiling, default 1; launch additional worker processes to use higher ceilings            |
| `RUN_TIMEOUT_MS`          | Per-attempt execution budget, default 900,000 ms; checked between bounded operations                       |
| `RECOVERY_WEBHOOK_URL`    | Optional email delivery adapter URL; receives authenticated POST `{email,url}`                             |
| `RECOVERY_WEBHOOK_SECRET` | Bearer secret for the recovery adapter                                                                     |
| `COOKIE_SECURE`           | Defaults true for production; false only for local HTTP production-build tests                             |

Price estimates are configured in **Run settings** as dollars per million input/cached/output tokens. They are explicitly estimates, not billing charges. User token allowances have configurable UTC reset days (1–28) and hours in Run settings. Server plan entitlements reset on the first day of each UTC calendar month; changing a user reset cannot bypass that ceiling. User settings may lower plan ceilings but cannot raise server entitlements. Background jobs wait for allowance reset instead of becoming permanently failed.

### GitHub permissions

Use a fine-grained personal access token restricted to relevant repositories, with Metadata read, Issues read/write, Pull requests read/write, Contents read/write, Checks read, and Commit statuses read. Repository management requires actual `admin` or `maintain` permission verified server-side. Organization SSO or token approval may also be required. Contributor fork creation needs an identity/token allowed to create forks; fine-grained token limitations and organization policies can prevent this. Errors remain visible and publication can be retried after permissions are corrected.

Tokens are validated against `/user`, encrypted with authenticated AES-GCM, and never returned to the browser. Replacing a token for the same login updates its ciphertext. Disconnect deletes it locally; revoke it on GitHub separately. Back up the encryption key independently of the database. Changing the key without a migration makes existing tokens unreadable.

### OpenAI

The official OpenAI SDK targets https://api.openai.com/v1 using streamed Responses requests. Only a final completion receipt with valid usage is accepted as successful; partial stream output is not applied. Chat exposes validated function tools; writing actions require application confirmation. Actual usage is persisted from provider response usage fields, including cached input and reasoning output (reasoning is already included in output and total tokens). Source snippets, issue descriptions, and messages are sent to the configured provider; no GitHub token, database password, or API key is sent as prompt context or exposed inside the sandbox. Configure provider access and data handling for the repositories you use.

Official references consulted: [OpenAI tools](https://developers.openai.com/api/docs/guides/tools), [Prisma 7](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7), [GitHub pull requests](https://docs.github.com/en/rest/pulls/pulls). Simplewk’s site could not be fetched in this environment; the supplied product specification was used as the capability reference.

## Workflow

1. Connect one or more GitHub identities and activate the identities to sync.
2. Browse GitHub issues, import an issue, or let the worker sync assigned issues every 15 minutes. Importing never starts a coding run.
3. Explicitly select issues and confirm a solve. Issues are grouped by repository, at most four per branch and PR.
4. The worker inspects text source, plans, edits, and runs commands inside a disposable offline container. The run records its plan, activity, full replacement diff, artifacts, actual command results, failures, and per-run tokens.
5. Review the exact patch. Default policy requires approval before GitHub commits, branches, or PRs. Publication creates a draft PR, using a verified contributor fork if direct write access is unavailable. Plan-only mode never edits or publishes.
6. Mark the draft ready on GitHub when appropriate. Sync the review queue for actual reviews, checks, and mergeability. Reviews and merges reference the inspected commit SHA. Bulk merges preview exact heads and report each result.

Assignments are proposals, with assignability and configured limits checked before preview and again before applying. Partial failures remain visible and retries skip completed assignments. Wave apply matches live issue candidates against supplied experience and creates editable drafts. Submission and identity verification on Drips stay manual; EasySolve’s counts are local tracking only.

## Delivery status

See [feature and verification checklist](docs/FEATURES.md), [architecture](docs/ARCHITECTURE.md), and [deployment and operations](docs/DEPLOYMENT.md). This implementation is operational within documented sandbox and integration limits. It does not include a payment provider, Drips submission automation, or a shared multi-member organization administration system. Live OpenAI, GitHub writes, email delivery, and Drips interactions require operator credentials and have not been live-verified here.

## Optional direct OpenAI / GPT-6 Astra setup

The server defaults to `OPENAI_MODEL=gpt-6-astra` and `OPENAI_REASONING_EFFORT=low`. Astra supports low, medium, high, xhigh and max; none is rejected. There is no model fallback. The default output ceiling is 6,000 tokens including reasoning, with a 90-second streaming deadline and no automatic SDK retries. Incomplete/refused/interrupted output never triggers tools or edits. Jobs retain bounded retries, cancellation checkpoints, offline Docker execution and review before publication.

In Codespaces, put `OPENAI_API_KEY` in a Codespaces secret (preferred) or ignored private `.env`; add `OPENAI_MODEL` if overriding the default. Restart both web and worker after changing secrets. Keep port 3000 private and use the exact forwarded origin for `APP_URL`. No `NEXT_PUBLIC_` credential is used. Existing process environment values take precedence over `.env`.

In production, inject the same variables through the hosting secret manager into both the web service and worker. Apply `npm run db:migrate`, generate Prisma Client and build before restarting both services. The web service needs outbound HTTPS to api.openai.com; the execution container receives no provider credentials. This change adds usage fields and connection/request tables without rewriting historical provider records.

Set `OPENAI_ADMIN_USER_IDS` to comma-separated existing database User IDs for trusted operators. Empty denies all UI connection tests; account signup and profile changes cannot grant this permission. Administrators see **Test OpenAI connection** on Account; other users see only configuration and verification status and never need their own key. The authenticated POST requires the existing same-origin CSRF check and is rate limited. Verification expires after 24 hours, is bound to the configured key/model, and is revoked after failed AI requests. Configuration never implies connection success.

Server limits: `AI_MAX_INPUT_BYTES` (200000), `AI_MAX_OUTPUT_TOKENS` (6000, max 128000), `AI_REQUESTS_PER_MINUTE` (20/user), `AI_GLOBAL_REQUESTS_PER_MINUTE` (60), `AI_JOB_MAX_TOKENS` (500000/run), `AI_JOB_MAX_REQUESTS` (18/run, across retries including rejected/interrupted attempts), `OPENAI_TIMEOUT_MS` (90000, max 90000), and existing `RUN_TIMEOUT_MS` (900000). Requests reserve a conservative input-byte estimate plus output before admission; recorded usage always comes from actual provider receipts. Without a final receipt, token spend is unknown and no tokens are invented. Request admission counts include rejected attempts. Monthly plan/user allowances still apply. Raising budgets should be deliberate.

Optional `OPENAI_INPUT_PRICE_PER_MILLION`, `OPENAI_CACHED_PRICE_PER_MILLION` and `OPENAI_OUTPUT_PRICE_PER_MILLION` supply defaults for user-editable OpenAI estimates. Blank prices mean no estimate; use your actual contract rates. Historical providers remain in usage totals and are excluded from OpenAI price estimates. Reasoning tokens are shown separately but never billed twice in the calculation.

`npm run ai:verify` authorizes two live calls only: a streaming marker response and a persisted ordinary chat response. It records sanitized outcomes in `docs/openai-live-verification.json` and removes its temporary account. Mocked SDK integration tests cover chat tools, matching/drafts, planning, actual worker repair/test execution in Docker, approval gates, budgets and administrator authorization. No live GitHub writes are included.

Current live result (2026-10-29): OpenAI rejected the supplied key (`AI_AUTHENTICATION`). Connection and live chat remain unverified; a valid project API key is required. No substitute model was attempted.

Implementation references: [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [streaming Responses](https://developers.openai.com/api/docs/guides/streaming-responses), [function calling](https://developers.openai.com/api/docs/guides/function-calling), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Coding actions and contribution matching use strict JSON schemas; tool arguments are still validated server-side before any action.

## AgentRouter gateway

See [AgentRouter configuration and verification](docs/AGENTROUTER.md). This workspace selects `AI_PROVIDER=agentrouter` with `https://co.agentrouter.org/v1`. `AGENTROUTER_MODEL` has no automatic default or fallback. The requested `gpt-6-astra` must appear in the authenticated gateway catalog before EasySolve will generate with it. The current token received HTTP 401, so no available-model list, Astra access, chat, streaming, tools or schema support has been live-verified. Account credit is not proof of API access.

`npm run agentrouter:verify` queries the authenticated catalog, then tests bounded chat, a harmless owned-issue tool, and a strict JSON schema only if the requested model is listed. It writes sanitized status and actual usage to `docs/agentrouter-live-verification.json`. `npm run ai:verify` tests ordinary chat on the selected provider and writes `docs/ai-live-verification.json`. Both consume tokens when access succeeds; neither performs GitHub writes. Tests use provider mocks. Direct OpenAI prices never estimate AgentRouter charges.
