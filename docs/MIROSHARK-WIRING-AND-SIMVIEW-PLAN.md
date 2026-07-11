# MiroShark full wiring + simulation view — implementation TODO

**Date:** 2026-07-11. **Scope:** `vng-creative-intelligence` only (no app-side changes needed in
`vng-balance-copilot`). **Grounding:** re-read the live code, not just docs — `lib/sim-client.ts`,
`lib/gen.ts`, `app/dashboard.tsx`, `app/api/generate/route.ts` in this repo, and the actual Flask
route definitions in `miroshark/backend/app/api/simulation.py` + `miroshark/backend/app/__init__.py`
(not `miroshark/docs/API.md`, which was flagged as possibly stale — see §0.3 for what that check
found). Builds on `_shared/MIROSHARK-VIETNAM-FIT-PLAN.md` §10 and `_shared/MIROSHARK-WEBSCRAPING-PLAN.md`.

---

## 0. Where things actually stand (verified against code just now)

### 0.1 What's already real
`lib/sim-client.ts`'s `MiroSharkClient` already implements the full 10-step flow (ontology →
graph build → simulation create → prepare → start → poll run-status → publish → signal.json +
posts) and was live-verified end-to-end against a real local instance per
`MIROSHARK-WEBSCRAPING-PLAN.md` §0/§4 (real Vietnamese-language agent posts, `Bullish 61.5%` result
on a 3-source scrape-enriched run). `app/api/generate/route.ts` already has `maxDuration = 300`
(bumped from the original 60s landmine) and `sim-client.ts`'s default `runTimeoutMs` was bumped
5min→10min in commit `37d204a`. This is further along than `PLAN.md`'s Phase 2.2/2.3 assumed.

### 0.2 What's still mocked / broken
- `getSimClient()` (`lib/sim-client.ts:359`) still returns `MockSimClient` unless `MIROSHARK_URL`
  is set in the deployed environment — today it's very likely unset in the actual Vercel deploy, so
  the live demo is running mock scores (`40 + hash(document) % 55`) end to end.
- `gen.ts:171` passes `options: { horizon: "7d", personas: 240, market: true }` to
  `client.simulate()`. Neither `horizon` nor `personas` are fields on `SimOptions`
  (`sim-client.ts:42-56` defines `country`/`platforms`/`maxRounds`/`simulationRequirement`/
  `projectName`) — they silently fall into the `[key: string]: unknown` catch-all and do nothing.
  Only `market: true` actually takes effect.

### 0.3 New findings from re-reading the real backend code (this session)
The docs (`miroshark/docs/API.md`) turned out to be accurate on *endpoint existence* — every route
named below was confirmed by grepping actual `@simulation_bp.route(...)` decorators in
`miroshark/backend/app/api/simulation.py`. But re-reading the actual handlers surfaced two things
the docs don't mention at all, because they're infra-level, not part of the documented API contract:

1. **Critical: wrong auth header, current client would 401 against any real deployment.**
   `miroshark/backend/app/__init__.py:92-158` (`internal_auth_guard`) gates *every* `/api/*` route
   (with a short keyless-probe allowlist that doesn't include anything this app calls) behind a
   header named **`x-miroshark-internal-key`**, checked against `MIROSHARK_INTERNAL_KEY`. It
   **fails closed** — returns `503` if that env var is unset on any deployed/non-debug instance, so
   a real MiroShark deployment (Railway per `miroshark/README_DEPLOYMENT.md`) will have it set.
   `MiroSharkClient.request()` (`sim-client.ts:141-181`) never sends this header — it only ever
   sends `Authorization: Bearer ${apiKey}` (from `MIROSHARK_API_KEY`), which the internal-key guard
   doesn't look at. **Every one of the 10 calls in `simulate()` would 401 against a real deployment
   today.** This is separate from and in addition to `MIROSHARK_ADMIN_TOKEN`, which is real and
   correctly wired (`simulation.py:47-58,98-120`: a distinct decorator, `require_admin_token`, gates
   only the mutation endpoints `/publish`, `/resolve`, `/outcome`, via `Authorization: Bearer
   <MIROSHARK_ADMIN_TOKEN>` — `sim-client.ts:301-306` already does this correctly for `/publish`).
   Net: `MIROSHARK_API_KEY` as currently used is dead weight; a new `MIROSHARK_INTERNAL_KEY` env
   var and header need to be added to every request.
2. **Score-is-zero bug when `MIROSHARK_ADMIN_TOKEN` isn't set.** `mapVerdict()`
   (`sim-client.ts:321-345`) computes `score = clampScore(signal?.confidence_pct ?? bullish)`, and
   `signal` is only fetched `if (this.opts.adminToken)` (`sim-client.ts:308-311`) — because
   `signal.json` is itself publish-gated and publishing is admin-token-gated. Without an admin
   token, `signal` is `null`, `bullish` defaults to `0`, `clampScore(0)` returns `0`. **Every
   concept scored by a live MiroShark run without `MIROSHARK_ADMIN_TOKEN` set gets score 0**, which
   breaks `pick_best`'s ranking (`gen.ts:190-196`, sorts by `reception.score` descending — ties at 0
   get resolved by array order, not by actual reception). This makes `MIROSHARK_ADMIN_TOKEN`
   effectively **required**, not optional, for a real run to produce a meaningful pick.
3. **Endpoint gating is per-endpoint, not uniform** (confirmed by reading handlers, not assumed):
   `/profiles`, `/timeline`, `/agent-stats` (checked directly) have **no** `is_public` check — they
   work immediately after a sim exists, no publish/admin-token needed. `/agents.json` **does**
   check `is_public` and 403s with `"POST /api/simulation/<id>/publish to enable"` otherwise
   (`simulation.py:6199-6207`). Docs describe several more (`agents/sparklines`, `trajectory.jsonl`,
   `quality`, `demographics`, `interaction-network`) as "publish-gated" but this wasn't individually
   verified for each — treat as unconfirmed until read (task 2.1 below).

### 0.4 Decision this plan needs from you before Task 1 starts
`MockSimClient` and the whole labeled-fallback pattern (`source: "live"|"mock"`, honest badges,
`fallbackReason`) is a load-bearing architectural principle across every planning doc in this repo
(`SCAFFOLD.md`, `PLAN.md` §1, `WINNING-PLAYBOOK.md`) — "deploys green on labeled fallbacks... no
silent fallbacks, ever." Removing `MockSimClient` outright would mean local dev and any zero-infra
deploy breaks entirely (MiroShark needs Neo4j + OpenRouter + a running backend, not a Vercel-native
dependency). This plan assumes **"no more mock simulation" means: the deployed demo always runs the
real client, real MiroShark infra is provisioned and reliable enough that mock never actually
triggers in practice, and any fallback that does occur is loud, not silent** — not that
`MockSimClient`'s code is deleted. Flag if you actually want the mock path removed entirely; that
changes 1.1 below and removes the "keep local dev working" requirement.

---

## Task 1 — Fully wire `simulate_reception` to real MiroShark

### 1.1 Fix the internal-key auth header (blocking everything else)
- **File:** `lib/sim-client.ts` — `MiroSharkClient.request()`.
- Add `internalKey` to the constructor's `opts`, sourced from a new `MIROSHARK_INTERNAL_KEY` env
  var. Send it as `"x-miroshark-internal-key": this.opts.internalKey` on every request (not just
  the mutation ones) alongside the existing `Authorization: Bearer` (keep that for the admin-gated
  calls; it's unrelated and already correct).
- Retire `MIROSHARK_API_KEY`/`apiKey` as currently wired (it maps to the wrong header for a guard
  that doesn't exist server-side under that name) — repoint `.env.example` and `getSimClient()`
  (`sim-client.ts:359-367`) at `MIROSHARK_INTERNAL_KEY` instead. Decide whether to keep
  `MIROSHARK_API_KEY` as a deprecated alias or drop it; either way document the real var.
- **Done when:** a request against a real deployed MiroShark instance with `MIROSHARK_INTERNAL_KEY`
  set returns `200`/expected envelope instead of `401`.

### 1.2 Fix the score-without-publish bug
- **Files:** `lib/sim-client.ts` (`mapVerdict`, `simulate`), `.env.example`, deploy env docs.
- Make `MIROSHARK_ADMIN_TOKEN` a **required** var for the real path, not optional — document it
  plainly (README + `.env.example` comment already hints at this but doesn't say "required").
- Add a startup/first-call check in `getSimClient()`: if `MIROSHARK_URL` is set but
  `MIROSHARK_ADMIN_TOKEN` is not, either (a) throw loudly so this fails at config time, not
  silently at score-time, or (b) fall back to a **non-zero, clearly-labeled** score derived from
  `/posts` sentiment (e.g., a cheap keyword/LLM sentiment pass over citations) with
  `fallbackReason: "no MIROSHARK_ADMIN_TOKEN — signal.json unavailable, score derived from posts"`.
  Recommend (a): simpler, and matches the repo's "no silent fallbacks" rule — a 0 score silently
  winning or losing a pick is exactly the kind of bug that rule exists to prevent.
- **Done when:** a real run with `MIROSHARK_ADMIN_TOKEN` set produces non-zero, plausible scores;
  a real run *without* it fails loudly at config/request time instead of silently zeroing scores.

### 1.3 Reconcile `SimOptions` at the `gen.ts` call site
- **File:** `lib/gen.ts:168-172`.
- Replace `options: { horizon: "7d", personas: 240, market: true }` with real fields:
  `{ country: "vn", platforms: ["threads", "facebook"], market: true, maxRounds: <decide>,
  simulationRequirement: <derive from concept/theme instead of the generic default> }`.
- Decide `maxRounds` deliberately — cost and latency scale with it (`sim-client.ts:206` defaults to
  3; the one real verified run in `MIROSHARK-WEBSCRAPING-PLAN.md` §4 used `max_rounds: 1` and still
  took ~6.6 min with `threads+facebook`). Pick a number and write down why elsewhere in this repo
  (probably 1–2 for demo-day latency budget, not the SimOptions default of 3).
- **Done when:** `simulate_reception`'s actual request body matches what a judge/reviewer sees
  documented in `SimOptions` — no dead fields, no silently-ignored knobs.

### 1.4 Fix the route timeout budget (real landmine, will fail live on stage)
- **Files:** `app/api/generate/route.ts` (`maxDuration = 300`), `lib/sim-client.ts` (`runTimeoutMs`).
- The one real end-to-end verified run took **~6.6 minutes** (`MIROSHARK-WEBSCRAPING-PLAN.md` §4) —
  past the current 300s (5 min) route budget. `runGenerationPipeline` runs `simulate_reception` for
  **every** generated concept (`gen.ts:238`, `Promise.all` over 2–4 concepts) — if MiroShark calls
  run in parallel, that's fine latency-wise but multiplies cost; if the intent was sequential for
  cost reasons, wall-clock is worse, not better.
- Two options, pick one and commit:
  - **(a) Raise the ceiling.** Vercel Fluid Compute allows longer `maxDuration` on paid plans —
    confirm the actual plan's ceiling (check Vercel project settings) and set `maxDuration` to
    match, with margin over the observed 6.6 min (e.g., 600–800s if the plan allows it).
  - **(b) Convert to job-start + polling**, as `PLAN.md` §2.2 originally recommended and never did.
    `POST /api/generate` kicks off the pipeline async (store state — Supabase already exists in
    this app, `lib/supabase.ts` — or in-memory if single-instance), returns a job id immediately;
    client polls `GET /api/generate/:id`. No hard ceiling, and it's a strict UX upgrade (progress
    UI, survives a tab refresh) — but more surface area to build and test this week.
- Given this is meant to run live on stage (`PRODUCT.md`: "3 minutes of stage time"), recommend
  **(a) as the immediate fix** (small, unblocks the demo) and treat **(b)** as the Task 2
  prerequisite anyway, since a real-time simulation view (Task 2) needs incremental state to show
  *during* the run, not just a result after a 6.6-minute blocking wait. See §2.2.
- **Done when:** a real `threads+facebook` run completes on the **deployed** Vercel URL (not
  localhost) without hitting the route timeout, verified at least twice for variance.

### 1.5 Provision real infra + environment
- Stand up (or confirm) a MiroShark deployment per `miroshark/README_DEPLOYMENT.md` (Railway) with
  Neo4j + an OpenRouter key configured — this is the actual "Day-1 spike" `WINNING-PLAYBOOK.md`
  flags as the one setup step that can eat a day if left late.
- Set in the Vercel project for `vng-creative-intelligence`: `MIROSHARK_URL`,
  `MIROSHARK_INTERNAL_KEY` (new, from 1.1), `MIROSHARK_ADMIN_TOKEN` (now required, from 1.2),
  `MIROSHARK_TIMEOUT_MS` if the default needs overriding.
- Confirm the deployed MiroShark instance's own `MIROSHARK_INTERNAL_KEY` and `MIROSHARK_ADMIN_TOKEN`
  are set server-side too (Railway env) — both sides need the same values.
- **Done when:** `MIROSHARK_URL` resolves from Vercel's network (not just your laptop), and a
  request from the deployed Next.js app reaches it successfully.

### 1.6 Observability for a live demo
- **Files:** `lib/sim-client.ts`, wherever server logs land (Vercel function logs).
- Add structured logging (one line per of the 10 steps: step name, `simulation_id`, elapsed ms,
  outcome) so a failure mid-demo is diagnosable from Vercel logs in seconds, not by re-reading the
  10-step method. This directly serves `PLAN.md`'s "every number a judge sees must trace to a
  computation we can defend live" principle — extend it to "every failure must be debuggable live."
- **Done when:** a deliberately-broken run (e.g., wrong `MIROSHARK_URL`) produces a log trail that
  identifies which of the 10 steps failed and why, without needing to reproduce locally.

### Testing plan — Task 1

| Level | What | How |
|---|---|---|
| Unit | `mapVerdict()` with `signal=null` vs populated `signal`, with 0/partial/full `posts` | Pure function, fixture-driven; assert no more silent 0-scores post-1.2 |
| Unit | `MiroSharkClient.request()` sends `x-miroshark-internal-key` on every call, `Authorization: Bearer` only on admin-gated calls | Mock `fetch`, assert headers per call in the 10-step sequence |
| Unit | `simulate()`'s error path (any of the 10 steps throws) still produces a labeled `[MOCK fallback]` verdict via `gen.ts`'s catch, not an unhandled rejection | Mock `fetch` to reject at each step in turn |
| Integration (gated, needs live infra) | Full `simulate()` against a real local MiroShark (`docker compose up -d neo4j && npm run dev` per `miroshark/CLAUDE.md`) | Commit this as an actual test file (not the earlier throwaway `smoke-test.mjs`), guarded behind an env var (e.g. `MIROSHARK_INTEGRATION_TEST=1`) so CI/default `npm test` doesn't require live infra |
| Integration | Auth failure modes: wrong/missing `MIROSHARK_INTERNAL_KEY`, wrong/missing `MIROSHARK_ADMIN_TOKEN` | Confirm 401/503 surfaces as a labeled `fallbackReason`, not a stack trace to the user |
| Manual, deployed | Run `/api/generate` on the actual Vercel preview URL, 3+ times, with real keys | Confirm: `source: "miroshark"` badges, non-zero scores, citations populated, completes under `maxDuration`, no silent fallback in Vercel logs |
| Manual, timeout stress | Run with `platforms: ["threads","facebook"]` (the slower, previously-verified combo) end-to-end on the deployed URL | Confirm real wall-clock stays under whatever ceiling 1.4 picked, with margin — run at least 3x to catch variance, not just once |
| Manual, kill-switch | Unset `MIROSHARK_URL` mid-deploy (or point it at a dead host) | Confirm graceful, clearly-labeled fallback to mock per the existing Phase-0 "loud fallbacks" principle — this must still work even after 1.1–1.4, it's the safety net for a wifi-dies-on-stage scenario |

---

## Task 2 — Simulation view for MiroShark's agents on the frontend

### 2.1 Confirmed usable endpoints (verified against `simulation.py` route handlers, not docs)

| Endpoint | Gated on `is_public`? | What it gives the UI |
|---|:---:|---|
| `GET /<id>/profiles` | No (confirmed) | Raw agent persona files per platform — available immediately, even mid-run |
| `GET /<id>/timeline` | No (confirmed) | Round-by-round summary — good for a live progress view |
| `GET /<id>/agent-stats` | No (confirmed) | Per-agent engagement/posting counts |
| `GET /<id>/agents.json` | **Yes** (confirmed — 403 until published) | Roster: name, persona preview, demographics, `final_stance`, karma — richest single view of "who was in the debate" |
| `GET /<id>/posts` | No (already used today for citations) | Already wired; Task 2 just needs to render more than the current 10-citation slice |
| `GET /<id>/agents/sparklines` | Docs say gated, **not individually verified** | Per-agent belief-over-time — stretch goal, verify gating before committing to it |
| `GET /<id>/trajectory.jsonl` | Docs say gated, **not individually verified** | Aggregate belief-over-time (bullish/neutral/bearish %) per round — feeds the headline chart |
| `GET /<id>/polymarket/markets` | Not verified | Prediction-market odds, only relevant if `market: true` (it is, per `gen.ts`) |
| `GET /<id>/quality` | Not verified | Run health diagnostics — one badge, cheap to add |

**First step of 2.1 is literally to read the remaining unverified handlers** (`trajectory.jsonl`'s
`_serve_trajectory` helper, `agents/sparklines`, `quality`, `polymarket/markets`) the same way 0.3
did for `agents.json`/`profiles`/`timeline` — confirm gating and exact response shape before writing
frontend code against assumed shapes. Budget ~1–2h; this is cheap insurance against building UI
against a 403 or a field that doesn't exist.

### 2.2 Data plumbing — this is the real work, not the chart components
Today `MiroSharkClient.simulate()` runs all 10 steps and returns a mapped `SimVerdict`, discarding
`simulationId` once it returns (`sim-client.ts:199-317`). To show a simulation view, the frontend
needs that id and a way to fetch richer detail — and, per §1.4, the run itself takes minutes, so a
"view" that only appears after the whole thing finishes is a much weaker demo moment than one that
updates live.

- **Minimum viable (post-hoc detail, no architecture change):** extend `SimVerdict` with an
  optional `simulationId` and a `detail` object (agent roster, trajectory, timeline), populated by
  `MiroSharkClient.simulate()` making 2-4 extra `GET` calls after publish, before returning. Cheapest
  to build, but the simulation view only appears after the ~6-minute wait — no live feel.
- **Better (matches 1.4's job-polling option):** if 1.4 goes with job-start + polling, the
  simulation view becomes a live panel that polls `GET /<id>/timeline` and `GET /<id>/profiles`
  *during* the run (both unauthenticated by publish-gate, per 2.1 — they work mid-run) and switches
  to the full `agents.json`/`trajectory.jsonl` detail once the run completes and publishes. This is
  the version that actually earns "wow" — a judge watches personas post and belief shift in real
  time, which is a stronger demo than a static post-hoc summary. **Recommend this**, and treat 1.4's
  timeout fix and 2.2's live view as one combined piece of work, not two.
- New types in `lib/sim-client.ts`: `SimAgentProfile` (name, persona_preview, demographics,
  final_stance, karma), `SimTrajectoryPoint` (round, bullish_pct/neutral_pct/bearish_pct,
  participating_agents), `SimTimelineRound` (whatever `/timeline`'s per-round summary actually
  contains once 2.1 confirms it).
- New route or extension of the existing one: either `GET /api/generate/:id/simulation` (detail
  fetch, thin proxy to MiroShark) if going the polling route, or just bundle detail into the
  existing `/api/generate` response if staying with the "minimum viable" option above.

### 2.3 UI — new panel(s) on the Stage
Per `DESIGN.md`'s "Lab & Stage" system (dark stage, mint `--stage-accent`, one hue family, no
Legend-box charts, motion rules already defined) — this is an addition to the existing dark
"Stage" section (`dashboard.tsx:540-692`), not a new visual language.

- New kicker panel, e.g. **"08 Live simulation"**, placed between the existing "06 3D preview" and
  "07 Agent console" (or as a full-width section if the agent roster needs the room — decide once
  §2.1's real field counts are known; hundreds of agents doesn't fit a sidebar).
- **Belief trajectory chart:** Recharts line/area, x = round, three lines (bullish/neutral/bearish)
  — reuse the existing chart rules (`DESIGN.md` "Chart rules"): one axis, thin marks, direct labels
  instead of a Legend box, mono axis ticks. Color mapping needs a decision: stage tokens
  (`--stage-accent` mint, `--stage-warn`) only currently cover two roles (pick/fallback); a
  three-way bullish/neutral/bearish split needs either a third stage color defined here or reuse of
  the lab's `SIGNAL`/`WARN`/`NEUTRAL` on the dark surface (check contrast against `--stage` per the
  existing "Validation" note in `DESIGN.md` before shipping either choice).
- **Agent roster:** compact scrollable list/table on the stage surface — name, persona preview
  (truncate further than the API's 280 chars for a card), stance badge, demographics as small mono
  tags. Given "hundreds of agents" is the product's own pitch (`MIROSHARK-VIETNAM-FIT-PLAN.md`),
  this needs virtualization or a hard cap ("showing top 20 by influence" — `/<id>/influence` exists
  as a source for that ranking) rather than rendering the full roster unbounded.
- **Live post feed:** expand today's 10-citation slice (`gen.ts` citations, capped in `mapVerdict`)
  into a real scrolling feed with agent attribution, sourced from `/posts` with pagination — the
  raw material for the "watch agents argue" moment `STRATEGY.md`'s brief promises.
- **Prediction-market strip:** if `/polymarket/markets` confirms real data (2.1), a one-line odds
  strip — this is a small, cheap addition once the endpoint's shape is confirmed.
- **Mock/empty state:** when `pipeline.concepts[].reception.source === "mock"` or detail is
  unavailable, show an explicit `[MOCK] simulation detail only available for live MiroShark runs`
  state — never a blank panel (the exact defect Phase 0.1 in `PLAN.md` already had to fix once for
  the dashboard; don't reintroduce the pattern here).

### 2.4 Performance
- Agent count could be large (the Vietnam-fit plan mirrors Singapore's 500/250 default, "tune down
  for hackathon LLM-cost budget" — the actual configured count needs confirming, it directly
  determines whether the roster view needs virtualization).
- `agents.json` is cached 1h server-side and is "structural" (doesn't change round to round) —
  fetch once per completed run, not on a polling interval; only `timeline`/`profiles`/`run-status`
  need to be polled during an in-progress run.

### Testing plan — Task 2

| Level | What | How |
|---|---|---|
| Fixture render | Dashboard with a fixture `pipeline` result carrying a full `detail` payload (agents, trajectory, timeline) | No test runner is currently configured in `package.json` (`next lint` is the only check) — either add one (Vitest + React Testing Library is the lightest fit for a Next 16 / React 19 app) or, if time is tight, do this as a manual browser check against a hardcoded fixture route; note the decision explicitly rather than silently skipping automated coverage |
| Fixture render | Mock/empty state (no `detail`, `source: "mock"`) renders the honest placeholder, not a blank panel or a crash | Same fixture approach, second fixture with `detail: undefined` |
| Manual, live | Run the full pipeline against real MiroShark infra (post-Task-1), confirm the belief-trajectory chart's final-round numbers match the `signal.json`-derived `scenarios` array already shown elsewhere on the page (cross-check, not just "did it render") | Compare the new chart's last data point to `pipeline.best.reception.scenarios` bull/neutral/bear percentages — they're the same underlying numbers and must agree |
| Manual, live | If 2.2 goes the polling route: confirm the roster/timeline panel actually updates mid-run (not just after completion) | Watch a real run in the browser, confirm at least 2 distinct intermediate states render before completion |
| Visual | Dark-mode "Stage" styling matches `DESIGN.md` (font scale, hairline seams, motion/reveal rules, `prefers-reduced-motion` respected) | Manual check with reduced-motion OS setting toggled on/off |
| Visual, responsive | Judges view the deployed app "on their own devices" post-demo (`PRODUCT.md`) — roster/feed panels must not break on a phone-width viewport | Manual check at common phone widths (375px, 414px) |
| Accessibility | New chart colors (bullish/neutral/bearish on dark) pass the same CVD/contrast bar `DESIGN.md`'s "Validation" section already holds the lab palette to | Run through the same dataviz validator process referenced in `DESIGN.md` before finalizing the three-way color choice from §2.3 |
| Load | Render with a realistic agent count (confirm actual configured `max_agents` first, per §2.4) | Manual perf check — no visible jank scrolling the roster/feed at the real count, not just a 5-agent dev fixture |

---

## Sequencing

Task 2 is not meaningfully startable before Task 1's §1.1–1.2 (auth + score fix) land — there's no
real simulation to view until the client can actually complete a run against production infra. §1.4
(timeout/job-polling) and Task 2's "live" vs "post-hoc" design decision (§2.2) are the same fork in
the road — decide both together, don't build 1.4 as blocking-request-then-later-retrofit polling for
Task 2.

**Recommended order:** 1.1 → 1.2 → 1.5 (infra, needed to test 1.1/1.2 for real) → 1.3 → 1.4 (pick
job-polling if Task 2's live view is in scope) → 1.6 → Task-1 testing pass → 2.1 (confirm remaining
endpoint shapes) → 2.2 → 2.3 → 2.4 → Task-2 testing pass.

## Effort rollup (rough, one engineer, sequenced)

| Item | Estimate |
|---|---|
| 1.1 Auth header fix | ~1–2h (small diff, but re-verify all 10 calls) |
| 1.2 Score-without-publish fix | ~2h |
| 1.3 SimOptions reconciliation | ~1h |
| 1.4 Timeout fix (job-polling variant) | ~0.5–1 day |
| 1.5 Infra provisioning | ~0.5 day (assuming Railway deploy already exists per `README_DEPLOYMENT.md`; ~1 day if starting fresh) |
| 1.6 Observability | ~2h |
| Task 1 testing pass | ~0.5 day |
| 2.1 Endpoint verification | ~1–2h |
| 2.2 Data plumbing (live-polling variant) | ~1 day |
| 2.3 UI panels | ~1–1.5 days |
| 2.4 Performance pass | ~0.5 day, folded into 2.3 rehearsal |
| Task 2 testing pass | ~0.5 day |
| **Total** | **~4.5–5.5 days**, one engineer |
