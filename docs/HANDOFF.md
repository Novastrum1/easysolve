# Current handoff — 2026-10-29

## Latest login repair

The reported login error was reproduced as HTTP 422: `FormData.get("name")` returned null because login has no signup-only name input, and the shared schema's optional string rejected null. `token` was also null but ignored by that schema. `lib/auth-input.ts` now defines separate login/signup/recovery/reset/change schemas and per-action payload construction. Missing credentials are rejected with useful field errors. `components/workspace.tsx` renders those errors and uses a consistent nonempty reset token for both form controls and submission; `?reset=` now displays normal login. Sign-in reads current DOM values for autofill and only submits email/password. Creation/reset/change use an eight-character minimum and "Use at least 8 characters." guidance; sign-in verifies existing hashes without applying the new-password length rule. No real accounts/passwords were changed.

New files: `lib/auth-input.ts`, `tests/auth-input.test.ts`, `tests/auth.integration.test.ts`, `tests/browser/auth.spec.ts`. Other login changes: `components/workspace.tsx`, `components/ui.tsx`, `components/pages/settings.tsx`, `app/globals.css`, `lib/routes/auth.ts`, `lib/routes/account.ts`, `lib/api.ts`, and these verification/handoff notes. Existing uncommitted owner-dashboard changes are preserved.

TypeScript, production build, 57 unit tests, 45 integration tests and all 18 desktop/mobile browser tests passed. The production web app was rebuilt/restarted on localhost:3000, and the durable worker was restarted after the final suite. Keep the live worker stopped while database/job fixtures run. Autofill regression uses DOM population without input events, not an external password manager. See the current verification record for reproduction and test details.

## Owner dashboard delivery

The latest request added site administration because only a per-user maintainer dashboard and provider-test allowlists existed. `/admin` is a dynamic Server Component gated by the current database session and `ADMIN` role; `/api/admin/*` independently authorizes every operation, with CSRF, strict inputs and transactional audit entries for changes. Additive migration `20261029000300_admin` is applied locally. Signup and existing accounts default to `USER`; no existing real account has been promoted. Provider-test environment allowlists do not grant site administration.

Owner must run `npm run admin:bootstrap -- --email 'their-existing-email@example.com'` (or `--user-id`) on the trusted server. Exactly one selector is required. A singleton marker and an existing-admin check prevent reuse; the real bootstrap remains unconsumed. See [ADMIN.md](ADMIN.md) for account suspension/reactivation, per-account plan ceilings, job inspection/cancel/retry, safe provider health, audit semantics and cooperative cancellation limits.

Final checks passed: TypeScript, production build, 53 unit tests, 40 integration tests and 8 desktop/mobile browser tests. New integration/browser fixtures were removed; no live AI/GitHub writes occurred. The old web/worker processes were stopped for testing; the updated production web on local port 3000 was restarted after the final build. Local HTTP production testing uses `COOKIE_SECURE=false`; hosted HTTPS should use secure cookies. The durable worker is restarted after tests with the new suspension checks.

## Latest maintenance check

The user is arranging a paid DeepSeek or OpenAI API credential later. No live provider calls were made during this maintenance pass, and no credential was changed. The current environment selects AgentRouter; direct OpenAI is supported separately. Direct DeepSeek is not currently a selectable provider.

The local PostgreSQL container was stopped. Started it with its existing data volume, confirmed all five migrations are applied, and added `restart: unless-stopped` to Compose. Applied that policy and confirmed the database is healthy. Corrected README documentation for the provider-neutral verifier and its actual `docs/ai-live-verification.json` report path.

Current checks: TypeScript and production build passed; 49 unit tests, 32 integration tests, and all 4 desktop/mobile browser tests passed. Diagnostics passed with an empty queue; production dependency audit reported zero vulnerabilities. Production web is running on port 3000 with local HTTP cookies enabled, and the durable worker is running. Paid-provider authentication, billing, and generation remain unverified. Earlier reports below are historical.

## Earlier OpenAI migration

The user's latest request supersedes the former DeepSeek task. EasySolve now targets OpenAI GPT-6 Astra through the official SDK Responses API, with no model fallback. The ignored local environment contains the supplied server credential; never display it. OpenAI rejected the live connection test with AI_AUTHENTICATION. No live chat response or agent action succeeded. See docs/openai-live-verification.json. A valid OpenAI project API key is required before repeating the two-call verifier.

Preserve historical provider usage and stored app/GitHub data. OpenAI schema migrations are additive. Admin-only testing uses server OPENAI_ADMIN_USER_IDS (empty denies all users). Model defaults to gpt-6-astra, reasoning low. See README.md for budgets, setup and deployment.

No live GitHub writes, publication, merges or deployment were authorized. The earlier DeepSeek live report is historical and does not describe the current provider. Existing devcontainer image edits and its backup predate this migration.

Final checks: production build and TypeScript passed; 35 unit tests, 29 integration tests and 4 desktop/mobile browser tests passed. Actual Docker worker repair/testing was verified with mocked OpenAI SDK responses. Both local services are running (production web on port 3000, durable worker). Browser dependencies were installed. No live AI success is claimed. Replace the rejected server API key, restart both processes and run npm run ai:verify to complete live connection/chat verification. Configure OPENAI_ADMIN_USER_IDS for trusted operators if the UI connection test is needed.
