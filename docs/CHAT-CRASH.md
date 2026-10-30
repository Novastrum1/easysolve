# Chat crash investigation

The reported global error page was reproduced before changing the application, with the unchanged production build, native Chromium 156, an existing synthetic conversation, and a small real DeepSeek `hi` request. A fresh conversation's first reply did not reproduce it: the failure requires a later message-list update or component unmount after the auto-scroll effect has run with a mounted target.

## Original evidence

Browser exception:

```text
TypeError: i is not a function
    at ix (.../_next/static/chunks/3wbm-994r45kr.js:1:113968)
    at uC (.../_next/static/chunks/3wbm-994r45kr.js:1:142491)
    at uN (.../_next/static/chunks/3wbm-994r45kr.js:1:142401)
```

The original bundle's `ix` function is React's effect cleanup loop: it reads `r.inst.destroy` into `i` and invokes `i()`. Native `scrollIntoView()` returned a Promise in both normal and experimental modes. The browser then displayed the exact “This page couldn’t load” global error UI. See [sanitized native-browser evidence](chat-crash-original-evidence.json), including the original stack and failed-request metadata.

Network/server correlation:

- `POST /api/chat`: HTTP 200 with the streaming content type; Chromium also recorded `net::ERR_ABORTED` for that request.
- Conversation bootstrap refresh: HTTP 200.
- Both the submitted user message and the actual assistant reply were saved. Their `content` fields were strings; `activity` fields were arrays.
- The local production server emitted no chat exception. The production runtime-log query returned no chat errors; production request logs confirmed HTTP 200 streaming requests at 17:50:40 and 17:53:54 UTC on 2026-10-30. No request/response content or credentials was collected.
- The failing browser had zero visible assistant messages after the error; reopening the page displayed its two saved assistant messages.

## Root cause and fix

The chat's auto-scroll effect implicitly returned the result of `scrollIntoView()`. Modern browsers return a Promise from this method. React accepts an effect cleanup function or no return value; on the next message refresh, it attempted to call that Promise as cleanup and crashed the page. [Chrome's scrolling documentation](https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/scroll-completion-effects) documents the Promise return, and [React's effect reference](https://react.dev/reference/react/useEffect) defines the cleanup contract.

The effect now has a block body and explicitly discards the scroll return value. It follows the active conversation and visible stream while returning no cleanup value. The error page was not changed.

Additional chat-flow changes:

- Preserve optimistic user messages and validated, completed server replies while conversation refresh runs or fails; deduplicate them by the existing persisted message ID.
- Keep streaming status/text inside the conversation, with existing messages visible.
- Show network/provider/parser failures inline with a retry button that reuses the original request ID.
- Validate streamed text and completed-message shapes before they enter React state. Empty deltas are harmless; a final frame need not end with a newline. Broken streams preserve their error cause and surface a useful retry message.
- Save ordinary model output literally. Remove a leftover provider-era assumption that every JSON-looking response was an `{answer: ...}` envelope. JSON `null`, object text and fenced code are text, not React children or action instructions. Only validated tool calls create action previews.

No schema migration or existing-message rewrite was required. Authentication, admin, billing, GitHub approvals and the DeepSeek-only provider boundary were preserved. The reproduction and regression accounts are temporary fixtures; their own records are removed after checking.

## Regression evidence

The focused existing-conversation regression failed against the unchanged build: after reply refresh, expected two assistant articles but received zero, with the global error UI. The same test runs with Promise-returning scroll behavior and checks reply refresh, code blocks, tool activity and navigation/reopening. A separate legacy-return test covers network failure, provider failure, retry idempotency and refresh failure. Provider mocks in tests are not evidence of live connectivity.

Final checks: 66 unit tests, 58 integration tests, all 36 distinct desktop/mobile browser cases across the full run and corrected targeted reruns, type checking, and both local/remote production builds passed. The original regression was demonstrated to fail before the fix.

The fix was promoted to https://easysolve-xi.vercel.app (`dpl_J8i8pLySdWdGX6kWcCjJQQyFBMJe`). The production worker is ready with one of one instances. One live browser submission from an existing fixture conversation made two small DeepSeek requests: a read-only `check_jobs` round trip and a final text/code-block reply. It persisted, survived client navigation and reload, and emitted no browser errors with native Promise-returning scrolling.

Local web and worker were restarted with the fix. The local live attempt returned a sanitized authentication error inline, preserved the conversation and retry control, and emitted no browser exceptions. The private root `.env` was modified during the task (18:12 UTC); its current DeepSeek key is rejected. That value was preserved, and further local live requests stopped. Local successful live generation remains blocked until the operator supplies a valid key privately and restarts the services. Production live verification passed.

See `chat-crash-verification.json` for sanitized results and explicit live-check limits. The temporary production diagnostic environment file and diagnostic accounts/sessions were removed.
