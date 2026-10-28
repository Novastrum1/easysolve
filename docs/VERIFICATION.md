# Local verification record

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
