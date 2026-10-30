# Owner administration

The dashboard is **`/admin`** on the same origin as the application. Local development: **http://localhost:3000/admin**. For a hosted installation, append `/admin` to your configured `APP_URL` (including the private Codespaces forwarded origin).

## Promote your existing account once

Register normally first. On the trusted application server, using the same private database environment as the web service:

```bash
npm run db:generate
npm run db:migrate
npm run admin:bootstrap -- --email 'your-existing-email@example.com'
```

Alternatively, select the exact existing user ID instead of email:

```bash
npm run admin:bootstrap -- --user-id 'your-existing-user-id'
```

Use **one** selector and run **one** promotion command. Email matching uses the application's normalized lowercase email. The command does not request or print passwords, API keys, database credentials, or session tokens. It changes only the selected account's database `role` to `ADMIN`, atomically creates a one-time bootstrap marker and an audit event, and never creates an account. Unknown accounts and suspended accounts are rejected. Concurrent bootstrap attempts are serialized. If the marker exists or any administrator already exists, it refuses promotion; rerunning it cannot promote another account. No web endpoint grants roles. Server/database access is the trust boundary for this command.

Restart the web and worker services after deploying the migration/code, sign in with your existing credentials, then visit `/admin`. Existing sessions see the current database role on their next request. A new **Owner dashboard** workspace navigation link appears for administrators. No existing real account was promoted during implementation or verification.

## Authorization and account controls

`User.role` defaults to `USER` for every signup and existing account. The first signup gets no special access. Only explicit server-side bootstrap grants the initial owner `ADMIN`. Profile, signup and settings inputs cannot change roles or plan entitlements. The older `AI_ADMIN_USER_IDS` / `OPENAI_ADMIN_USER_IDS` allowlists grant provider connection-test permission only; they do **not** grant dashboard access.

The `/admin` Server Component checks the live database-backed session and role before rendering. Anonymous visitors are redirected to sign-in; ordinary or suspended users receive a 404 page. Every `/api/admin/*` operation independently checks the current session, suspension state, and `ADMIN` role, including direct API requests. Unauthorized API requests return 401/403. Admin responses use `Cache-Control: no-store`; mutations use same-origin CSRF checks, strict input validation, rate limits, and a second role check inside their transaction. There is no middleware/proxy-based trust shortcut.

User search supports email/name substrings and exact user IDs, with 20 accounts per page. Account details show identity/session counts, repository summaries, plan ceilings and usage without passwords, identity tokens, or session IDs. Suspension requires a reason, revokes sessions/reset tokens, cancels active queued/running work and pending review runs, and blocks login, AI admission, job admission, autosync and worker claims. Administrator accounts cannot be suspended from this dashboard. Reactivation does not resurrect sessions, approval or cancelled work. Users sign in again; retries are explicit.

Administrators can permanently delete an ordinary user from **Users and workspaces → View account → Delete user**. Enter the exact account email and a reason, then confirm. This deletes the account, sessions, connected credentials and workspace data; it does not delete repositories or pull requests on GitHub. Administrator and bootstrapped owner accounts are protected. If work is active, suspend the account first and wait for the worker lease to expire before retrying deletion. Payment receipts remain available to prevent payment reuse, and an `account.delete` audit entry records the administrator and reason.

## Plans, jobs and health

Each account currently represents one personal workspace; there is no separate multi-member Workspace model. The dashboard summarizes accounts/workspaces, repositories, runs, job states, monthly/all-time actual token usage and usage by provider/model.

Plan name, monthly plan job ceiling and monthly plan token ceiling are per-account overrides. Blank values inherit `PLAN_NAME`, `PLAN_MAX_JOBS` and `PLAN_MAX_TOKENS`; zero prevents new runs or AI usage. These are server-owned columns, separate from user-editable settings. Effective limits use the lower applicable personal and plan ceiling; personal token windows can reset on their configured day/hour, while plan usage resets at the start of each UTC month. Overrides may raise or lower server defaults for the selected account. They do not erase usage or bypass per-run AI request/token budgets. Changing ceilings does not start jobs automatically or interrupt an already admitted provider request. There is no payment/subscription processor.

Jobs have paginated filtering, sanitized failure details and associated run state. Cancel/retry changes are atomic with the audit entry and conditional on current job/run state. Cancellation is cooperative at existing worker checkpoints; a Docker command or external request already underway may finish. Publication holds the existing run lock, so an already approved publication may finish before cancellation can acquire that lock. Cancellation cannot undo external effects. Retries wait for an outstanding worker lease to expire, keep usage/request history, reject suspended accounts and conflicting runs, and never grant publication approval. A publication retry requires the user's current approved patch and existing worker validation.

Provider health shows only provider/model, whether a credential is configured, and the existing key/model-bound verification receipt (expires after 24 hours). It returns no key, fingerprint, environment dump or raw SDK response, and makes no paid provider request. Diagnostic messages redact configured secrets and common bearer/key patterns; raw job payloads, source artifacts and run logs are omitted.

## Audit and verification

The paginated audit log records the actor ID, target ID, timestamp, action and controlled change details for bootstrap, account suspension/reactivation, plan updates and job cancel/retry. Mutations and their audit record share a transaction. The application exposes no audit edit/delete operation; trusted database operators can still alter database records, so this is not an external tamper-proof audit service. Read-only dashboard views are not recorded.

Tests use dedicated disposable fixture accounts and never promote an existing real account. Run:

```bash
npm run typecheck
npm test
npm run test:integration
npm run build
# Start the updated web app on localhost:3000, then:
npm run test:browser
```

Admin integration tests cover unauthorized direct API access, live page authorization, role-injection attempts, CSRF, field validation, plan enforcement, suspension/session revocation, job state transitions, publication approval, redaction and audit entries. Bootstrap unit tests cover exact selection, nonexistent/suspended accounts, the singleton marker and repeat refusal. Browser tests cover page denial plus the owner workflows at desktop and mobile sizes. As with existing integration tests, use a local disposable database and keep the durable worker stopped while browser/integration fixtures are being exercised.

## Changed files

- Dashboard: `app/admin/page.tsx`, `components/admin-dashboard.tsx`, `components/admin-dashboard.module.css`, `components/workspace.tsx`.
- Authorization and administration: `lib/security.ts`, `lib/admin.ts`, `lib/routes/admin.ts`, `lib/api.ts`, `lib/routes/auth.ts`.
- Entitlements and background work: `lib/policy.ts`, `lib/ai.ts`, `lib/queue.ts`, `lib/routes/bootstrap.ts`, `worker/agent.ts`, `worker/index.ts`.
- Database and bootstrap: `prisma/schema.prisma`, `prisma/migrations/20261029000300_admin/migration.sql`, `scripts/bootstrap-admin.ts`, `package.json`.
- Tests: `tests/admin-bootstrap.test.ts`, `tests/admin.integration.test.ts`, `tests/browser/admin.spec.ts`.
- Documentation: `README.md`, `docs/ADMIN.md`, `docs/ARCHITECTURE.md`, `docs/FEATURES.md`, `docs/VERIFICATION.md`, `docs/HANDOFF.md`.
