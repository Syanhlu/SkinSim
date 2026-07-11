# E2E Report

Story: the app renders a hypothesis-driven A/B test UI at `/`, sends AI SDK UIMessage traffic to `/api/agent`, and should return streamed agent output when configured or controlled JSON errors when input/configuration is invalid.

Assumptions: local AI Gateway credentials are intentionally absent, so a valid agent request is expected to fail gracefully without attempting a model stream. HTTP probes used `curl.exe` with `--max-time 15`.

## Findings

| Probe | Expected | Actual | Fixed / reported |
| --- | --- | --- | --- |
| `npm.cmd run build` | Green production build | Final build green. During concurrent edits, one run failed in `lib/miroshark/client.ts:182` because `??` and `||` were mixed without parentheses; this later resolved outside my owned files. | Reported transient out-of-lane issue; final gate passed. |
| `npm.cmd run start` | Production server starts on port 3000 | After final green build, `next start` served `http://localhost:3000` and was stopped after each sweep. During the transient failed-build window, `next start` reported missing `.next/BUILD_ID`. | Reported as downstream of out-of-lane build failure; final gate passed. |
| `GET /` | `200`; HTML contains main UI, hypothesis textarea, scenario controls | `200 text/html`; HTML contained `Hypothesis`, `id="hypothesis"`, and `Ask agent`. | Passed. |
| `POST /api/agent` valid UIMessage body, no AI key | Controlled graceful error, no hang/crash | Two runs returned `503 application/json`, `missing_ai_gateway_credentials`. | Fixed in `app/api/agent/route.ts`. |
| `POST /api/agent` empty body | Controlled JSON error | Two runs returned `400 application/json`, `empty_body`. | Fixed in `app/api/agent/route.ts`. |
| `POST /api/agent` invalid JSON | Controlled JSON error | Two runs returned `400 application/json`, `invalid_json`. | Fixed in `app/api/agent/route.ts`. |
| `POST /api/agent` with `{"messages":"not-an-array"}` | Controlled JSON error | Two runs returned `400 application/json`, `invalid_messages`. | Fixed in `app/api/agent/route.ts`. |
| `POST /api/agent` with 1MB text message | Controlled JSON error; no hang/crash | Two runs returned `413 application/json`, `payload_too_large`. | Fixed in `app/api/agent/route.ts`. |
| `POST /api/agent` missing content-type | Controlled JSON error | Two runs returned `415 application/json`, `unsupported_media_type`. | Fixed in `app/api/agent/route.ts`. |
| `GET /api/agent` | Clean `405` or `404` | `405 application/json`, `method_not_allowed`, with `Allow: POST`. | Fixed in `app/api/agent/route.ts`. |
| `GET /nonexistent` | 404 page | `404 text/html`. | Passed. |
| Stress cycle 1 | 30 concurrent `GET /`, 10 concurrent malformed `POST /api/agent`; no hangs >15s; server stays up | 40/40 completed, 0 hung, 30 GET 200, 10 POST 400, max curl time 0.039s, server still 200 afterward. Memory 95.8MB -> 103.3MB. | Passed. |
| Stress cycle 2 | Same check after rebuild-free restart | New PID 27104. 40/40 completed, 0 hung, 30 GET 200, 10 POST 400, max curl time 0.037s, server still 200 afterward. Memory 95.7MB -> 103.4MB. | Passed. |
| Stress cycle 3 | Same check after rebuild-free restart | New PID 10792. 40/40 completed, 0 hung, 30 GET 200, 10 POST 400, max curl time 0.036s, server still 200 afterward. Memory 96.5MB -> 104.2MB. | Passed. |
| Final shutdown | Server stopped cleanly | `netstat` showed only `TIME_WAIT` entries, no `LISTENING` process on port 3000; curl no longer received a response. | Passed. |

## Fixes Made

- `app/api/agent/route.ts`: replaced unchecked `await req.json()` with content-type checks, body-size checks, JSON parse handling, AI SDK `safeValidateUIMessages`, message count/text caps, and structured JSON error responses.
- `app/api/agent/route.ts`: added local AI Gateway credential preflight so valid UIMessage requests return a useful `503` JSON error when `AI_GATEWAY_API_KEY`/Vercel auth is unavailable.
- `app/api/agent/route.ts`: wrapped stream creation in `try/catch`, added stream `onError`, and added explicit `GET` handling with `405` JSON plus `Allow: POST`.

## Architectural Decisions To Escalate

- Confirm the request limits: current guardrails are 256KiB body, 50 messages, and 64KiB total text.
- Decide whether local no-key behavior should always be `503`, or whether the app should offer an offline deterministic agent/demo mode.
- Consider formalizing the route contract with a shared schema/test fixture so the UI transport and E2E probes stay aligned.
