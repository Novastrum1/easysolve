# EasySolve functional health check

Checked October 29, 2026 while Amazon Bedrock MiniMax inference is blocked by the AWS daily token quota. This check made no live AI requests and no GitHub writes.

## Passed

- TypeScript: npm run typecheck.
- Unit tests: 73 passed across 10 test files.
- Integration tests: 49 passed across 12 test files, using local PostgreSQL, real isolated Docker containers, and mocked external AI/GitHub boundaries.
- Browser tests: 18 passed across desktop and mobile against the running production web service.
- PostgreSQL connectivity, encryption-key configuration, Docker daemon and sandbox image readiness.
- Actual connected GitHub account authentication (GET /user) and assigned-issue access (GET /issues with per_page=1). One active identity was checked; no token or issue contents were printed. See [sanitized GitHub results](github-health-check.json).
- Web and worker both running with matching provider, Region, model, endpoint and credential configuration. MiniMax remains selected in eu-north-1. See [configuration results](bedrock-runtime-configuration.json).

## Functional coverage

Authentication and validation, signup/login/logout, autofill, password changes and one-use reset logic, session revocation, settings persistence, desktop/mobile navigation, admin controls and auditing, user/workspace resource isolation, CSRF, entitlement and allowance enforcement, durable job admission/retry/cancellation, issue-sync idempotency and ownership, assignment previews/application boundaries, pull-request reviews and publication approval checks, fork publication logic, and Docker read/edit/failing-test/repair/passing-test isolation.

Provider-based chat, tool validation, drafts, analysis and coding-agent decisions were tested with SDK mocks. This validates application behavior without claiming successful live model generation.

## Limits and outstanding setup

- AWS generation remains blocked by HTTP 429 ThrottlingException, “Too many tokens per day, please wait before trying again.” The real connection-health receipt was preserved/restored after mocked-provider tests and remains Connection failed / Verified=false. No mock receipt was left as live verification.
- Password-recovery delivery is not configured: RECOVERY_WEBHOOK_URL and RECOVERY_WEBHOOK_SECRET are absent. Recovery/reset logic passes mocked-delivery tests; actual reset-link delivery requires an operator-configured delivery adapter.
- There are no connected repository records. GitHub account and assigned-issue reads were live-verified, but repository-specific writes, reviews and merges were tested with mocks only. No live GitHub write was attempted.

## Test isolation and cleanup

The standalone worker was stopped during tests so it could not claim fixture jobs or make unintended live provider requests. All integration tests then passed, including the Docker agent workflow that had failed during an earlier run with the worker active. This is consistent with competing execution of fixture jobs; no production agent code change was needed.

Temporary test accounts and their fixture records were cleaned up, original provider-health receipts were restored when absent, and the worker was restarted. The final queue check reported zero queued and zero running jobs. Existing application data, credentials, conversations and GitHub approval gates were preserved. No migrations, IAM changes, model activation or subscription changes were performed.
