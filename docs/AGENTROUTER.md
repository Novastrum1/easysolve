# AgentRouter setup and verification

EasySolve supports two distinct providers: `agentrouter` (Chat Completions) and `openai` (Responses). `AI_PROVIDER` selects one provider; there is no automatic provider, endpoint or model fallback. Existing installations without this setting retain direct OpenAI behavior. The current workspace explicitly selects AgentRouter.

Configure real credentials privately in `/workspaces/easysolve/.env` or in Codespaces secrets, then restart both web and worker. Never paste credentials into source, the browser, documentation, or `.env.example`. Inherited process variables take precedence over files. Next.js may additionally prioritize `.env.production.local` and `.env.local`; the worker loads root `.env` through dotenv. This workspace audit found no competing env file or inherited provider key. The root `.env` is ignored, untracked and mode 0600.

Server configuration:

| Variable | Value or purpose |
| --- | --- |
| AI_PROVIDER | agentrouter |
| AGENTROUTER_BASE_URL | https://co.agentrouter.org/v1 |
| AGENTROUTER_API_KEY | Private AgentRouter token; never committed |
| AGENTROUTER_MODEL | Exact ID from the token's authenticated catalog; no default |
| AGENTROUTER_TIMEOUT_MS | Optional, default/max 90000 ms |
| AI_ADMIN_USER_IDS | Comma-separated trusted User IDs allowed to test shared connection |

The prior OPENAI_ADMIN_USER_IDS setting remains a compatibility fallback for administrator IDs. UI users cannot change shared credentials, endpoint, provider or model. If direct OpenAI is deliberately selected later, use its own separate key; the adapter rejects a key equal to AGENTROUTER_API_KEY before sending a request to OpenAI.

Production hosting must inject these variables into both web and worker from its secret manager. Restart both after changing them. No database or sandbox recreation is needed for a key change. The sandbox gets no API keys. Existing monthly, input/output, per-minute and per-run budgets apply to both providers. Provider usage keeps cached and reasoning tokens where returned, including incomplete response receipts; reasoning tokens are already included in output totals. Missing receipts never become fabricated zero-token success.

## API compatibility

The [current official co.agentrouter.org guide](https://co.agentrouter.org/portal/guide) specifies an OpenAI-compatible /v1 endpoint, documents Chat Completions clients and directs users to /v1/models for model discovery. It describes token-specific resource pools. Public model examples are not an entitlement list. The guide's client setup and public model page do not establish access to GPT-6 Astra, Responses compatibility, or strict JSON-schema support for a particular token.

EasySolve therefore uses the documented Chat Completions endpoint and queries the authenticated model catalog before generation. It translates function tools and JSON schemas into Chat Completions format and preserves server-side validation and confirmation. Streaming requires a terminal finish reason and actual stream usage; truncated/interrupted/missing-usage output never executes actions. Unsupported streaming, tools or schema parameters produce explicit errors; EasySolve does not silently remove them or relax approval gates. No unverified reasoning settings are sent to the gateway.

Run `npm run agentrouter:verify` after configuring credentials. It checks authentication/catalog, exact model availability, one streamed marker response, a harmless query_issues tool on a temporary workspace, and strict structured output. The temporary account is deleted afterward. It never posts to GitHub or starts a coding run. A missing requested model produces the available catalog and requires an explicit user choice; no alternative is selected automatically. Responses support stays unverified and is not used. To verify it later, obtain current gateway documentation or explicit provider confirmation before adding a Responses adapter mode.

## Current live result and support

On 2026-10-29 the configured token received HTTP 401 from the authenticated catalog. Model availability is unknown, not an empty confirmed entitlement list. No chat, tool, streaming, schema or Responses capability was live-verified, and no usage receipt was returned. See `agentrouter-live-verification.json`.

If AgentRouter responds “unauthorized client detected, contact support for assistance”, EasySolve reports AI_CLIENT_RESTRICTED and stops. It does not spoof a client, change identity headers, retry another hostname, or bypass access controls. For any persistent 401, confirm the token was issued for this gateway and has the intended resource-pool/API permissions. Ask [AgentRouter support](https://co.agentrouter.org/portal/guide) at neo@agentrouter.org to authorize EasySolve as a custom OpenAI-SDK client using /v1/models and /v1/chat/completions, and to confirm enabled model IDs and capabilities. The current guide does not document an EasySolve-specific allow-list header, so none was invented.

Direct OpenAI pricing is not AgentRouter billing. Gateway records remain in token totals but are excluded from the direct OpenAI cost estimate. Check actual charges and resource-pool balances in AgentRouter's dashboard; no gateway dollar cost is fabricated.
