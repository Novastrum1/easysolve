# Feature and verification checklist

This is an implemented application, with real database persistence and provider-backed operations. Live provider access is not established by key presence. A configured API key is not labeled a successful provider health check. All live integration limitations are explicit below.

## 1. Implemented and tested

| Area            | Delivered behavior                                                                                                                                                                                                 | Verification                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Account         | Signup/login/logout, private user workspaces, password changes, hashed expiring sessions, session revocation, profile editing                                                                                      | Real API and browser flows; cross-user run access/read/cancel denied                                             |
| Secrets         | Server-only identities, AES-256-GCM token encryption, tamper detection, random nonces, public error redaction, exact-origin writes                                                                                 | Unit tests; browser bootstrap checks                                                                             |
| Interface       | Original mark/favicon, consistent Lucide icons, Instrument Sans/Figtree/monospace, dark/light themes, collapsible sidebar, mobile drawer with focus handling, command menu, shared component system                | Desktop/mobile browser traversal of all 14 routes; settings/theme persistence; overflow checks                   |
| Overview        | Real issue/run counts, review handoffs, recent activity, configured integration states, next actions                                                                                                               | Browser coverage; uses persisted records without fixtures                                                        |
| Maintainer      | Repository/issue/assignment/PR/merge snapshots and contributor activity, links to assignments/reviews                                                                                                              | Browser coverage; provider requests implemented, see live-verification section                                   |
| Assignments     | Input by account/repository/organization name, usernames, issue numbers, labels, additional count, Wave-only filter, proposal preview and confirmation, assignability checks, limits, honest partial results       | Unit proposal tests; PostgreSQL apply/retry/ownership tests with mocked GitHub                                   |
| Find issues     | Real open-issue browsing, search/labels/unassigned filtering, descriptions, manual import, editable approach draft, copy and confirmed public comment                                                              | Browser route coverage; provider request boundaries tested; live actions unverified                              |
| Wave apply      | Account/Wave/complexity/language preferences, supplied-experience matching, up to five application drafts, editable drafts/copy/links/local tracking                                                               | Implemented through real provider adapter; browser form coverage; live matching unverified                       |
| Issues          | Multi-identity assigned sync, manual queue, worker autosync at 15-minute intervals, all required status tabs and filters, individual/batch solve, four issues per repo group                                       | Grouping, transactional duplicate prevention and no-auto-run tests; browser route coverage                       |
| Runs            | History/search/filter, run details, branch/PR links, plan/activity/diff/tests/artifacts, per-run tokens, live polling, approve/cancel/retry/request changes                                                        | Workflow integration and browser tests                                                                           |
| Execution       | Separate durable worker, real Docker sandbox commands, OpenAI inspection/edit/test loop, explicit states, bounded attempts, timeouts, cancellation checkpoints, restart leases, idempotency                      | Actual Docker Node test; UID/network/path restrictions; queue recovery and publication tests with provider mocks |
| Publication     | Approval bound to stored canonical patch, no preapproval commits/branches/PRs, plan-only mode, explicitly opted-in automatic publication, verified fork path, deterministic commits and existing-PR lookup         | PostgreSQL workflow tests with mocked GitHub and agent output; actual sandbox tested separately                  |
| Review          | Live PR/review/check/mergeability queries, categories/filters/diffs, head-bound reviews/merge, stale-head rejection, GitHub refusal honored, confirmed bulk sequence with per-item results                         | Unit state-derivation tests; PostgreSQL review-action tests with provider mocks; browser route coverage          |
| Repositories    | Onboarding with server-side admin/maintain check, identity grouping, health sync, safe disconnect                                                                                                                  | Browser coverage and ownership/provider boundaries; live management unverified                                   |
| AI usage        | Actual input/cached/output/total tokens and request counts, daily chart, purpose breakdown, monthly allowance with configurable UTC reset day/hour, configured cost estimates, server plan ceilings, queue waiting | Mocked provider SDK responses persisted in real PostgreSQL; reset/entitlement/allowance tests                    |
| Settings        | Persisted approval/automatic/plan mode, autosync, active identities, assignment limits, allowances and estimate pricing                                                                                            | Browser persistence; backend policy tests; worker enforcement                                                    |
| Billing         | Honest current-plan/limits/actual usage page, enforced entitlements; no fabricated payment checkout                                                                                                                | Entitlement tests and browser page coverage                                                                      |
| Developer setup | Devcontainer, PostgreSQL Compose, checked-in migrations, generated random local encryption key, explicit seed, app+worker command, health endpoint, CI workflow                                                    | Local migration/build/test execution; sandbox image built                                                        |

### Verification commands

```bash
npm run db:generate
npm run db:migrate
npm run typecheck
npm test
npm run test:integration
npm run test:browser
npm run build
npm audit
```

Deterministic tests mock only provider/execution boundaries where specified. Database integration tests use actual PostgreSQL. The dedicated sandbox test uses actual Docker and commands. Browser tests use the actual app/database with ephemeral fixture accounts and no live provider calls. Test-only fixture data is removed; there is no runtime fixture fallback.

## 2. Implemented but not live-verified

Live attempt on 2026-10-29: local diagnostics passed, but the first OpenAI request was rejected for invalid authentication (`AI_AUTHENTICATION`). No live AI workflow was verified. Replace the configured server credential and rerun `npm run ai:verify`; the sanitized attempt report is in `docs/openai-live-verification.json`.

- OpenAI Responses calls, chat function tools, coding quality, experience matching, provider usage receipts, and API/model availability for an operator’s account.
- GitHub token permissions/SSO, issue sync against a real account, managed repository onboarding, assignment writes, application comments, fork readiness, commits/branches/PR creation, reviews, protected-branch merges and bulk merges.
- Recovery delivery through the configured authenticated email webhook adapter. Reset token/password/session logic exists; an actual mail adapter must be configured and exercised.
- Drips external links, manual submission and identity verification. EasySolve never claims official application counts or automatic Drips submission.
- Codespaces forwarded-origin behavior on a fresh Codespace and production reverse-proxy/TLS deployment. Configuration is included; no public deployment was performed.
- The checked-in CI workflow has not been run by GitHub Actions in this session. Equivalent local checks are reported in the delivery response.

## 3. Incomplete, intentionally unsupported, or externally blocked

- No payment provider/subscriptions. This was optional; billing shows self-hosted entitlements honestly. Live payment configuration is not disguised as implemented functionality.
- No automated Drips integration or identity verification. Those remain manual as required unless a supported integration is configured.
- No shared multi-member workspaces, invitations, organization roles, or public usage leaderboard. Each account has a private workspace; no cross-user information is exposed.
- Sandbox edits are limited to bounded text files. Binary changes, symlinks, file deletion/renames, very large repositories, internet dependency installation, special toolchains, and CI-equivalent environments need an execution backend extension. Tests that cannot run fail or explicitly say they were not run.
- Full-file replacement diffs are readable and honestly labeled; line-preserving unified diff generation, inline code review comments, syntax highlighting, and provider webhook-driven instant updates are not implemented. Reliable polling is used instead of streaming.
- Draft-to-ready transition happens on GitHub. EasySolve publishes draft PRs and uses squash merging only, subject to GitHub protections. Other merge methods are not currently selectable.
- Chat offers read/query/status/sync/start-run/propose-assignment/prepare-publication tools. Applying assignments and posting reviews/merges require their dedicated preview screens. Voice uses browser Web Speech support; unsupported browsers get an explicit message and retain editable text.
- Production-grade public multi-tenant sandbox hosting, microVM isolation, centralized audit exports, object-storage lifecycle, cursor pagination, provider webhook ingestion, and operational monitoring require further infrastructure work. The local/private application should not be represented as a fully hardened public SaaS deployment.

The remaining live boundaries require credentials and explicit authorization for disposable-repository writes. No deterministic test claimed a live external write, email, official Drips submission, or payment occurred.
