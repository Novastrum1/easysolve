# Deployment and operations

The production application is deployed at https://easysolve-xi.vercel.app with
one Vercel worker daemon. The web app and worker share the hosted database and
encryption key; Vercel Sandbox provides isolated code execution.

## Production topology

### Vercel web deployment

`vercel.json` builds the Next.js web app and generates its Prisma client.
`.vercelignore` excludes local secrets, diagnostics and workspace files from uploads.
Vercel hosts the web process and the durable worker declared under `daemons` in
`vercel.json`. `Dockerfile.worker` packages the worker with `SANDBOX_PROVIDER=vercel`.
Coding commands run in disposable Vercel Sandbox VMs with `deny-all` network
policy, a 30-minute lifetime, and no application credentials. Production OIDC
authenticates Sandbox requests automatically. Local workers still use Docker by
default. Both services must use the same hosted PostgreSQL database and the same
`TOKEN_ENCRYPTION_KEY`. A localhost database URL is not reachable from Vercel.

The worker image validates its runtime imports during the build. `tsx` is a
production dependency because the worker executes TypeScript directly. To test
Sandbox separately without touching jobs or calling an AI provider, run
`node --import tsx scripts/verify-vercel-sandbox.ts <private-vercel-env-file>`.
This checks file writes, code execution, blocked network access and absence of
application credentials in the test process, then stops the VM.

Daemons and Sandbox use Vercel compute quotas/billing. Hobby daemon quotas do not
cover uninterrupted operation for a full month, even when waiting for work; see
[Vercel Daemons limits](https://vercel.com/docs/daemons/limits).

Sign in with `npx vercel login`, link the intended project with `npx vercel link`,
and configure production environment variables through Vercel's environment settings.
Set `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `APP_URL` (the exact production HTTPS
origin), `COOKIE_SECURE=true`, and the selected provider's configuration from
`.env.example`. Configure `ADMIN_ORIGIN` only when using a separate admin origin.
Never upload the local `.env` file or print secret values.

Before publishing, back up and migrate the chosen production database using
`npm run db:migrate` with that database's environment. To preserve existing login,
admin access and encrypted GitHub credentials, migrate the existing database data
and retain its encryption key; a fresh database contains none of those accounts.
Publish using `npx vercel --prod`, then verify `/api/health`, sign-in, `/admin`,
and the hosted worker. Migration execution is intentionally separate
from the build to keep preview deployments from modifying production data.

### Docker-capable self-hosting alternative

Run a TLS reverse proxy, a Next.js web process, a separate worker service, PostgreSQL, and an isolated worker execution host. Only the reverse proxy exposes the web app. The web process has no Docker socket. The worker needs the database URL, encryption key, DeepSeek credentials, outbound GitHub/DeepSeek HTTPS, and access to a dedicated Docker daemon. Containers created by it have no network or credentials.

```bash
npm ci
npm run db:generate
npm run db:migrate
npm run build
npm start
# Separate service/process, same version and secrets:
npm run worker:start
```

A multi-stage `Dockerfile` is included for packaging the web or worker process; use `npm run worker:start` as the worker command and provide environment at runtime. It includes the Docker client but no socket mount. Build it with `docker build -t easysolve:local .`. The default command and image health check run the web app. Disable that web health check for a worker-only container and monitor its supervisor and persisted job leases. Give only the worker service access to a dedicated execution daemon.

Use a supervisor (systemd, an orchestrator, or your process manager) to restart both services. `npm run start:all` is the single-command local experience, not a production supervisor. Set worker process count and `WORKER_CONCURRENCY` together; every process executes one job at a time, while PostgreSQL enforces the global ceiling.

Use a production PostgreSQL service with backups, TLS, restricted credentials, and a tested restore process. The supplied Compose password is for local development only. Back up the encryption key separately in a secret manager. Restore the key with the matching data. Do not rotate it by simply editing the environment; decrypt/re-encrypt credentials with a controlled migration or reconnect identities.

Set `APP_URL` to the exact HTTPS origin. Keep `COOKIE_SECURE=true`. A trusted reverse proxy must set client IP headers; strip untrusted forwarded headers for meaningful IP rate limits. Apply an upstream request-size limit as well as the app’s 100 KB JSON limit. Restrict database and Docker access to the processes that need them.

## Health and diagnostics

- `npm run doctor` checks the configured origin, key presence/shape, database access, queue counts, Docker daemon and sandbox image; it never prints credential values or makes live provider requests.
- `GET /api/health` checks PostgreSQL, returns 503/500 on failures, and reports whether AI/encryption are configured. Configuration does not claim that a live provider request succeeded.
- Worker stdout reports startup, retry loops, and job IDs. Job errors and future availability are persisted in `Job`. Run pages show execution failures and actual output.
- If issues do not sync: ensure `npm run worker:start` is running, autosync is enabled, identities are active, and token permissions/SSO are valid. Manual sync queues work; it does not execute it in the request.
- If a run is queued: inspect allowance, `Job.availableAt`, concurrent jobs, worker connectivity, and leases. User allowance reset days/hours are configured in Run settings; server plan ceilings reset at UTC month boundaries.
- If sandbox creation fails: run `docker info`, then `docker build -t easysolve-sandbox:local sandbox`. The worker must have Docker access, and the configured image must exist.
- If tests cannot run: the default sandbox is offline and includes Node, Git, and Python. It has no repository dependencies. Supply a vetted image for additional preinstalled tools; do not give the sandbox internet access or credentials to make tests appear successful.
- If publication fails after fork creation: GitHub may still be preparing the fork, or the token cannot access it. Correct permissions and retry the failed publication job through run approval. Inspect any existing branch rather than deleting it blindly.
- If writes return 403 Origin rejected: correct `APP_URL` and restart both services.
- If a token becomes unreadable: restore the matching encryption key or replace the credential through Account. Existing plaintext tokens are never recoverable in the UI.

## Account recovery

Configure `RECOVERY_WEBHOOK_URL` and `RECOVERY_WEBHOOK_SECRET` with a trusted email delivery adapter. EasySolve POSTs `{email,url}` with `Authorization: Bearer <secret>`. Return 2xx only after accepting delivery. The adapter must restrict and authenticate callers, use an approved sender, and avoid logging recovery URLs. Links expire after 30 minutes and invalidate all sessions when redeemed. Without the adapter, recovery reports setup required rather than pretending an email was sent. Keep operator access to database backups; do not manually set weak passwords.

## Billing

There is no payment provider or fabricated checkout. Plans describe configurable self-hosted entitlements. If subscriptions are added, introduce a real test-mode provider, verified signatures, event-ID uniqueness, replay-safe state transitions, and server-side entitlement updates before enabling live payments. That integration is outside this delivery.

## Sandbox limits

The current agent targets text repositories up to 3,000 tree entries and 2 MB of inspected source, skips blobs above 150 KB, excludes binaries/symlinks/secret paths and dependency lockfiles, and blocks `.git`, `.github`, and `.env*` modifications. It supports text creation/replacement, not binary edits, renames, or file deletion. It uses full-file replacement diffs clearly labeled in the UI. It makes at most 18 model action steps, runs each command for at most 60 seconds, and checks a default 15-minute execution budget between bounded operations. Cancellation stops at the next checkpoint; a running command may finish before cancellation is observed. Containers expire after 30 minutes even if the worker dies; resumed work recreates its named container.

The default limits are intentional operational constraints. Repositories needing network installation, special toolchains, binary changes, or large artifacts require a dedicated execution-image/infrastructure extension. Do not advertise successful tests for unsupported repositories.

## Data and access limits

Each user has a private workspace; collaboration roles/invites are not implemented. UI bootstrap currently loads complete issue/application collections and run/conversation history. GitHub list operations reject more than 2,000 records rather than silently truncating. Chat context is limited to 50 owned issues, 30 runs, and 16 messages. Large installations should add cursor pagination, incremental provider sync, retention policies, object storage, provider webhooks, and audit exports. Initial autosync of large repositories can occupy queue capacity; size worker capacity accordingly.

Review merge uses squash; disable or use GitHub directly where repository settings require another method. Draft PR readiness is changed on GitHub manually. Drips submission, official counts, identity verification, and recovery email delivery remain external manual/configured-provider boundaries. No shared leaderboard is exposed.

## Updating and verification

Install using the committed lockfile (`npm ci`), generate the client, migrate once per release, and run type checks, unit tests, integration tests against a disposable database, browser tests, and the production build. Build the sandbox image separately. Pin and scan the deployment image digest for production. Keep dependencies patched and test upgrades; never run remote repository install scripts in the web or worker host process.

## DeepSeek configuration

For DeepSeek, inject the same `AI_PROVIDER=deepseek`, `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL=https://api.deepseek.com` and `DEEPSEEK_MODEL=deepseek-flash` into both web and worker. Allow outbound HTTPS to api.deepseek.com. Never pass credentials to execution containers. Restart both services after configuration changes.
