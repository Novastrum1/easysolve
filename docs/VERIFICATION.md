# Local verification record

## Latest maintenance — 2026-10-29

TypeScript, production build, 49 unit tests, 32 integration tests (including actual Docker sandbox execution), and 4 desktop/mobile browser tests passed. `npm audit --omit=dev` reported zero vulnerabilities. Diagnostics confirmed the database, encryption configuration, Docker daemon, and sandbox image; there were no queued or running jobs. The stopped PostgreSQL container was restored without deleting its data and now uses `restart: unless-stopped`. Web and worker were started. No live AI call was made; the current configured provider is AgentRouter and key presence remains unverified. The user will supply a paid provider credential later.

The records below describe earlier verification runs.

Verified in the development workspace on 2026-10-28, using Node 24.21.0, PostgreSQL 17 in Docker, Docker 29.8.0, Prisma 7.10.1, Next.js 16.4.3, Vitest 5.0.5, and Chromium through Playwright.

| Check                      | Result                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Prisma Client generation   | Passed                                                                                                        |
| PostgreSQL migrations      | Both migrations applied; subsequent deploy reports no pending migrations                                      |
| `npm run typecheck`        | Passed, including application, worker and tests                                                               |
| `npm test`                 | 18 passed in 4 files                                                                                          |
| `npm run test:integration` | 23 passed in 7 files                                                                                          |
| `npm run test:browser`     | 4 desktop/mobile tests passed; full navigation, persistence and isolation                                     |
| `npm run build`            | Passed; application and API routes compile for production                                                     |
| Sandbox Docker image       | Built; actual non-root command/test, denied network, denied unsafe path, captured failures verified           |
| Application Docker image   | Built; final packaging includes OpenSSL and a database-backed health check                                    |
| `npm run doctor`           | PostgreSQL, Docker, sandbox image and encryption configuration passed; OpenAI honestly reports setup required |
| `npm audit --json`         | 0 known vulnerabilities                                                                                       |
| `git diff --check`         | Passed                                                                                                        |

The browser suite initially exposed an accessibility-label issue and a mobile navigation issue, both corrected before a passing run. A subsequent run under concurrent Docker/Next builds exceeded its 30-second total traversal timeout; the full 14-page test now has a 90-second timeout. These failures were not hidden or reported as passes.

Provider tests use deterministic mocks. Actual PostgreSQL and Docker are used for relevant integration tests. The coding loop’s provider boundary is mocked in workflow tests; actual sandbox execution is tested independently. No OpenAI generation, GitHub write, real recovery email, Drips application, or payment was live-verified. No disposable external repository was authorized or modified.

See [FEATURES.md](FEATURES.md) for implemented/live-unverified/incomplete distinctions and [DEPLOYMENT.md](DEPLOYMENT.md) for operational constraints.

The workspace’s Docker bridge resolved database DNS but cross-container TCP timed out. Packaged runtime verification uses `--network container:easysolve-db-1` with localhost PostgreSQL instead; this is a local test arrangement, not the recommended production topology. Host-based development/database integration and offline execution sandbox networking work as documented.

## Continuation checks

Rechecked on 2026-10-28 after the DeepSeek adapter changes: `npm run typecheck` passed; `npm test` passed 29 tests in 5 files; `npm run test:integration` passed 23 tests in 7 files. `npm run doctor` confirmed PostgreSQL, Docker, sandbox image, and encryption configuration. A DeepSeek key is configured; no live provider request was made in this continuation. The earlier table records the original verification run.

## OpenAI migration — 2026-10-29

- Default provider is OpenAI, model gpt-6-astra, supported reasoning low. No fallback model.
- Prisma Client generated; both additive OpenAI migrations applied successfully. Historical Usage provider/model values were not rewritten.
- Final TypeScript check passed; 35 unit tests passed in 5 files.
- 29 integration tests passed in 8 files. New SDK-boundary tests cover persisted chat/tool confirmation, issue analysis, editable drafts, contribution matching, worker planning, actual offline Docker worker execution (read → failing test → repair → passing test → awaiting review), administrator-only connection tests, key/model-bound verification, input/rate/run budgets, and actual reasoning/cached usage receipts including incomplete output.
- Production build passed. Web production server and durable worker started using the updated environment. Doctor passed PostgreSQL, Docker, sandbox image and encryption checks; queue was empty before worker startup.
- Credential scan found no supplied key in tracked or unignored files. Local .env is mode 0600 and Git-ignored. Every .env.example assignment is an empty placeholder.
- A real OpenAI request returned AI_AUTHENTICATION. No live connection, chat response, model access or agent quality is claimed. The persistent live chat check could not proceed after authentication failed. See openai-live-verification.json. No substitute model or external GitHub writes were attempted.
- Browser regression: all 4 desktop/mobile tests passed after installing missing Chromium and system dependencies. Includes all workspace screens, persisted settings, logout/CSRF/cross-user isolation and OpenAI model labels with no ordinary-user connection-test control. Initial browser launch failures were environment dependency failures, not reported as passes.
- Restart smoke test found and fixed a worker import-order bug: dotenv/config now loads before the provider/database dependency graph. The corrected worker established a PostgreSQL connection and stayed running without database retry errors. TypeScript was rechecked after this fix.
