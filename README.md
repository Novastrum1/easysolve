ther# EasySolve
p
**From issue to reviewed pull request.**

A self-hosted GitHub coding-agent application with a Next.js interface, PostgreSQL persistence, a durable worker, the direct DeepSeek Chat Completions API, and isolated Docker execution. The interface includes contributor and maintainer workflows, original branding, dark/light themes, and responsive navigation. There are no simulated live issues, runs, usage figures, or provider connections.

## Start in Codespaces or locally

Requires Node.js 24, npm, Docker with Compose, and access to a Docker daemon. The devcontainer supplies Node and Docker. Keep the Codespaces preview **private**.

```bash
npm ci
npm run setup
npm run start:all
```

`setup` creates a private `.env` with a random encryption key if it does not exist, starts PostgreSQL, generates Prisma Client, applies migrations, and builds the sandbox image. `start:all` starts both the web app and durable worker. Open port **3000**. The web server binds `0.0.0.0`; PostgreSQL is bound to localhost:5432 only. No Redis is required: the queue uses PostgreSQL row locks, leases, and unique idempotency keys.

Create your account in the application. Connect GitHub in **Account**. Enter `DEEPSEEK_API_KEY` privately in the **root `/workspaces/easysolve/.env`**, preserving any existing value. Set `AI_PROVIDER=deepseek`, `DEEPSEEK_BASE_URL=https://api.deepseek.com`, and `DEEPSEEK_MODEL=deepseek-flash`, then restart both web and worker. A nonempty root `.env` key takes precedence over an older injected DeepSeek key in both services. `.env` stays ignored and untracked. No credential belongs in `NEXT_PUBLIC_*`, source code, screenshots, or reports. GitHub workflows work without an AI key. Key presence alone does not verify connectivity.

Owner administration is available at **`/admin`**. Promote only your existing account once with `npm run admin:bootstrap -- --email 'your-existing-email@example.com'` on the trusted server after applying migrations. Signup never grants administrator access. See [owner setup and administration](docs/ADMIN.md) for user controls, plans, job operations, authorization and auditing.

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

`node scripts/test-isolated.mjs` runs integration tests in a new local database and removes only that disposable database. Add `--browser` to start a temporary production web process and run the browser suite. The application database and services must not be used for billing fixtures.

`npm run ai:verify` makes live requests to the DeepSeek, consumes provider tokens, and writes a sanitized report to `docs/ai-live-verification.json`. It uses temporary database fixtures for bounded connection, chat and tool requests; it performs no coding-agent or GitHub actions. Run it only when live provider verification is intended.

Browser setup: `npx playwright install --with-deps chromium`. Integration/browser tests create uniquely named fixture accounts and remove their own records. Use a local disposable database. Stop standalone worker processes before integration/browser tests: they can otherwise claim test fixture jobs and bypass the test process’s mocked AI/GitHub boundaries. Restart the worker after fixtures are cleaned up. They never call live AI providers or GitHub write APIs. Do not point the test environment at production.

## Credentials and configuration

Copy the documented names in [.env.example](.env.example); never commit `.env`.

| Variable                     | Meaning                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | PostgreSQL connection string; production records, sessions, jobs, artifacts, usage        |
| `POSTGRES_PASSWORD`          | Local Compose database password; change with `DATABASE_URL` for production                |
| `APP_URL`                    | Exact browser origin, no trailing slash; CSRF and recovery links                          |
| `TOKEN_ENCRYPTION_KEY`       | Base64-encoded 32-byte AES-256-GCM key; `openssl rand -base64 32`                         |
| `DEEPSEEK_API_KEY`           | Server-only key entered in the private root `.env`; shared by web and worker              |
| `DEEPSEEK_MODEL`             | Default `deepseek-flash`; no fallback model                                               |
| `DEEPSEEK_BASE_URL`          | Official `https://api.deepseek.com` only (optional `/v1` is accepted)                     |
| `DEEPSEEK_THINKING`          | `disabled` by default; `enabled` retains private reasoning only in transient tool history |
| `DEEPSEEK_TIMEOUT_MS`        | Streaming deadline, default and maximum 90000 ms                                          |
| `AI_MAX_OUTPUT_TOKENS`       | Per-request output ceiling, default 6,000                                                 |
| `PLAN_NAME`                  | Self-hosted plan label, default Personal                                                  |
| `PLAN_MAX_JOBS`              | Server-enforced monthly job ceiling per user, default 50                                  |
| `PLAN_MAX_TOKENS`            | Server-enforced monthly token ceiling per user, default 1,000,000                         |
| `SANDBOX_IMAGE`              | Trusted locally built execution image, default `easysolve-sandbox:local`                  |
| `WORKER_CONCURRENCY`         | Global active job ceiling, default 10; one worker dispatches jobs concurrently            |
| `WORKER_ACCOUNT_CONCURRENCY` | Per-account active job ceiling, default 10                                                |
| `AGENT_MAX_STEPS`            | Maximum model actions per coding run, default 36 and minimum effective value 18           |
| `RUN_TIMEOUT_MS`             | Per-attempt execution budget, default 900,000 ms; checked between bounded operations      |
| `RECOVERY_WEBHOOK_URL`       | Optional email delivery adapter URL; receives authenticated POST `{email,url}`            |
| `RECOVERY_WEBHOOK_SECRET`    | Bearer secret for the recovery adapter                                                    |
| `COOKIE_SECURE`              | Defaults true for production; false only for local HTTP production-build tests            |

Price estimates are configured in **Run settings** as dollars per million input/cached/output tokens. They are explicitly estimates, not billing charges. User token allowances have configurable UTC reset days (1–28) and hours in Run settings. Server plan entitlements reset on the first day of each UTC calendar month; changing a user reset cannot bypass that ceiling. User settings may lower plan ceilings but cannot raise server entitlements. Background jobs wait for allowance reset instead of becoming permanently failed.

### GitHub permissions

Use a fine-grained personal access token restricted to relevant repositories, with Metadata read, Issues read/write, Pull requests read/write, Contents read/write, Checks read, and Commit statuses read. Repository management requires actual `admin` or `maintain` permission verified server-side. Organization SSO or token approval may also be required. Contributor fork creation needs an identity/token allowed to create forks; fine-grained token limitations and organization policies can prevent this. Errors remain visible and publication can be retried after permissions are corrected.

Tokens are validated against `/user`, encrypted with authenticated AES-GCM, and never returned to the browser. Replacing a token for the same login updates its ciphertext. Disconnect deletes it locally; revoke it on GitHub separately. Back up the encryption key independently of the database. Changing the key without a migration makes existing tokens unreadable.

### DeepSeek

All chat, analysis, planning, coding, review, summary and worker generation uses the same DeepSeek configuration. The OpenAI-compatible SDK is used exclusively with DeepSeek's official Chat Completions endpoint; OpenAI, AgentRouter and Bedrock adapters are removed. Provider errors never select another provider. Historical usage and attribution remain unchanged.

Chat streams visible answer text, supports cancellation, and returns validated tool results to DeepSeek for up to five steps. Tool arguments are assembled across streamed chunks and validated before use. Thinking mode retains `reasoning_content` for every assistant message in the transient tool conversation, as required by DeepSeek; reasoning is never displayed or persisted as messages. Write tools still produce previews requiring existing approval. Structured JSON is validated locally against the workflow schema.

Account and admin views distinguish not configured, configured but unverified, verified, and connection failed. Only an administrator (`ADMIN` role) may test the connection. Verification follows a successful real request with valid usage, expires after 24 hours, and is bound to endpoint, model and key. Failures revoke verification. Authentication, balance, rate-limit, timeout and upstream errors are sanitized.

Limits remain configurable through `AI_MAX_INPUT_BYTES`, `AI_MAX_OUTPUT_TOKENS`, `AI_REQUESTS_PER_MINUTE`, `AI_GLOBAL_REQUESTS_PER_MINUTE`, and `RUN_TIMEOUT_MS`. Run-scoped AI requests are not stopped by token budgets; execution remains bounded by request limits, rate limits, timeouts, and the agent's finite action-step limit. SDK retries are disabled; the durable queue retains its bounded retry policy. Usage comes only from actual provider receipts, including cache hits. Missing usage is never estimated as actual consumption.

Prices are optional configurable USD per million tokens: `DEEPSEEK_INPUT_PRICE_PER_MILLION`, `DEEPSEEK_CACHED_PRICE_PER_MILLION`, `DEEPSEEK_OUTPUT_PRICE_PER_MILLION`. Blank means no estimate. Estimates apply only to DeepSeek records. DeepSeek uses separate price settings, so previous providers’ saved prices are never silently reused. [Official pricing](https://api-docs.deepseek.com/quick_start/pricing/) currently varies between peak and off-peak hours; choose the applicable documented rates or a conservative peak estimate and review them when rates change. Per-user Run settings can override estimates; estimates are not payment receipts.

References: [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/), [thinking and tool history](https://api-docs.deepseek.com/guides/thinking_mode/), [tool calls](https://api-docs.deepseek.com/guides/tool_calls/).

## Workflow

1. Connect one or more GitHub identities and activate the identities to sync.
2. Browse GitHub issues, import an issue, or let the worker sync assigned issues every 15 minutes. Importing never starts a coding run.
3. Explicitly select issues and confirm a solve. Issues are grouped by repository, at most four per branch and PR.
4. The worker inspects text source, plans, edits, and runs commands inside a disposable offline container. The run records its plan, activity, full replacement diff, artifacts, actual command results, failures, and per-run tokens.
5. The agent validates the implementation and publishes a normal PR automatically for explicitly started runs, using a verified contributor fork if direct write access is unavailable. Review mode keeps the patch behind a manual publication gate; plan-only mode never edits or publishes.
6. Sync the review queue for actual reviews, checks, and mergeability. Reviews and merges reference the inspected commit SHA. Bulk merges preview exact heads and report each result.

Assignments are proposals, with assignability and configured limits checked before preview and again before applying. Partial failures remain visible and retries skip completed assignments. Wave apply matches live issue candidates against supplied experience and creates editable drafts. Submission and identity verification on Drips stay manual; EasySolve’s counts are local tracking only.

## Delivery status

See [feature and verification checklist](docs/FEATURES.md), [architecture](docs/ARCHITECTURE.md), and [deployment and operations](docs/DEPLOYMENT.md). This implementation is operational within documented sandbox and integration limits. It does not include a payment provider, Drips submission automation, or a shared multi-member organization administration system. Live DeepSeek, GitHub writes, email delivery, and Drips interactions require operator credentials and have not been live-verified here.
