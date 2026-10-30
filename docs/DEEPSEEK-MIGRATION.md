# Direct DeepSeek migration — 2026-10-30

DeepSeek is the only active provider. All generation routes through `lib/ai.ts` and `lib/providers/deepseek.ts`. The OpenAI-compatible SDK remains only as a client for the official DeepSeek endpoint. Bedrock, AgentRouter and direct OpenAI adapters and operator commands were removed, along with the Bedrock SDK dependency. There is no fallback.

The adapter follows the current [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/) and [thinking-mode history requirements](https://api-docs.deepseek.com/guides/thinking_mode/). It assembles fragmented tool arguments, validates tool and structured-output schemas, and keeps reasoning private in transient tool history. Chat streams visible text, supports cancellation, and returns tool results for up to five steps. Existing write confirmation and publication approval remain required. Actual usage receipts retain provider attribution; no historical usage was rewritten.

Enter a valid `DEEPSEEK_API_KEY` in the private root `/workspaces/easysolve/.env`. A nonempty root key overrides an older injected DeepSeek key. Both services load this configuration; restart both after changing it. `.env` and `.env.local` remain ignored and untracked. No credential was included in reports or browser assets. Unrelated AWS configuration and application data were preserved.

DeepSeek prices have separate settings and are not inherited from earlier provider price estimates. Blank prices mean no estimate. Set documented applicable rates through `DEEPSEEK_INPUT_PRICE_PER_MILLION`, `DEEPSEEK_CACHED_PRICE_PER_MILLION`, `DEEPSEEK_OUTPUT_PRICE_PER_MILLION`, or Run settings. [Official pricing](https://api-docs.deepseek.com/quick_start/pricing/) varies by peak/off-peak hours; estimates are never billing receipts.

## Verification evidence

- TypeScript and final production build passed.
- 61 unit tests passed, including fragmented tools, reasoning history, missing usage, incomplete streams, invalid JSON, sanitized errors, cancellation, browser stream parsing and price isolation.
- 55 integration tests passed against a newly created disposable local database, including real Docker execution, tool continuation, streamed chat persistence, usage and budgets, admin access, Basic/Pro entitlements, GitHub overrides, invoice/payment boundaries and approval gates.
- All 32 distinct desktop/mobile browser cases passed across the full run and targeted rerun. Initial run: 29 passed, two new test selectors collided with Next's alert announcer, and one mobile navigation test timed out during a concurrent rebuild. Corrected selector and stable-build rerun: all six chat/workspace cases passed. Billing checks include local invoice QR decoding and payment-verification UI.
- Built browser assets scanned: no configured DeepSeek credential found.
- Configuration diagnostics passed for PostgreSQL, encryption, Docker and sandbox image.
- After the private key was updated, all bounded live checks passed: streamed response with actual usage, normal persisted chat, harmless `check_jobs` tool-call round trip, and actual Chromium browser chat through the production web service. The browser received visible streamed text, rendered and persisted `BROWSER_OK`, and confirmed verified DeepSeek status. Five total generation requests were used; no GitHub action was performed. Temporary fixture accounts were removed. See `ai-live-verification.json`. The earlier authentication failure is resolved.

Existing staged work was left staged; no reset, commit, public deployment, application-data deletion, or Codex account/provider change was performed. Test databases and test accounts were isolated fixtures.

Final runtime check: production web and durable worker are online. Their provider, model, official endpoint and private credential receipts match. `/`, `/admin/login` and `/api/health` returned HTTP 200; health reports `provider: deepseek`. These local health checks do not verify upstream connectivity.

Updated-key verification: web and worker were restarted to load the private root key. The browser check is reproducible with `node --import tsx scripts/verify-ai-browser.ts` after `npm run ai:verify`; it performs one live request and removes only its temporary account. No credential was printed or included in the report.

Production release: the tested working tree was deployed and promoted to https://easysolve-xi.vercel.app (`dpl_Kgq4pKdomaBV8vznvNMXvAnzS9pG`). Remote build/typecheck, public health, and Chromium user/admin sign-in checks passed. The hosted worker is ready with 1/1 instances on the same deployment and logs DeepSeek startup. The hosted database and encryption key were retained. See `production-deployment.json`.
