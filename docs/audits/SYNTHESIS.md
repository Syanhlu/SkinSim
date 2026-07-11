# VNG Repo — Deep Feature Audit & Suggestions (2026-07-11)

Synthesis of three deep audits (GPT 5.5 xhigh, read-only) — raw reports in this folder:
`audit-ab-test-agent.md`, `audit-miroshark.md`, `audit-creative-intelligence.md`.

## Verdict in one line

The foundations are genuinely strong (validated stats engine, working CLI A/B harness,
tested VN census-persona support) — but **the two apps are not connected, none of grand-plan
phases 1–6 is implemented, and the current UI is an instant-recompute mock that would not
survive a "show me it running" question from a judge.**

## What actually works today

| Feature | State | Evidence |
|---|---|---|
| Stats engine (power, z-test, Welch, chi², Mann-Whitney) | Real, scipy-validated | `vng-ab-test-agent/lib/stats.ts`, `eval/stats.test.ts` |
| Deterministic eval harness (13 decision cases) | Real | `eval/run.ts`, `eval/decisions.ts` |
| Agent route with 6 deterministic tools | Works, but stream doesn't update UI cards | `app/api/agent/route.ts:93-177` |
| Mock demo scenarios (6 canned outcomes) | Real, instant | `lib/mock-results.ts` |
| A/B CLI harness (branch, parallel, resume, report) | Real, live-validated | `MiroShark/backend/scripts/ab_experiment.py` |
| VN census personas (Nemotron-Personas-Vietnam) | Coded + unit-tested, **not enabled** (`.env` commented) | `wonderwall_profile_generator.py:1070`, `.env:47` |
| Internal-key auth guard | Real, fails closed | `MiroShark/backend/app/__init__.py:91-158` |
| Creative gen adapters (Nano Banana, graceful fallback) | Real, transplant-clean | `vng-creative-intelligence/lib/gen-adapters.ts` |

## Critical gaps (blockers, in fix order)

1. **The cable isn't in the socket.** `MiroSharkClient` POSTs to `/api/experiments/ab-test` —
   an endpoint that **does not exist** in MiroShark — with no internal key, expecting a
   synchronous result the planned API would never return (`lib/sim-client.ts:21-29`).
2. **The audience still agrees on everything.** 100%-bullish problem unfixed: no
   `scenarios/vng_demo_scenario.txt`, `DEMOGRAPHICS_COUNTRY=vn` commented out. Until variants
   discriminate, every demo shows A = B.
3. **The UI fakes completion.** Readout recomputes instantly on keystroke (`app/page.tsx:15`);
   there is no launch → preparing → running → done lifecycle; "Ask agent" streams text that
   never updates the cards — a dead end.
4. **No fallback when MiroShark is configured but down** (fetch failure throws; grand-plan
   constraint #2 violated).
5. **Phases 4 (world), 5 (variant studio), 6 (demo hardening): 0% built.**

## Feature suggestions

### Tier 1 — make it real (prerequisites, do first)
1. Experiments API in MiroShark (`app/api/experiments.py` + `ABExperimentService`) — plan Phase 2. [L]
2. Async job sim client + `/api/experiment` proxy with internal key, polling, mock-parity fallback. [M]
3. Scenario doc + enable `vn` personas + validation run (plan Phase 1). [S code / $ run]
4. Real experiment lifecycle in the UI: Launch button, preparing/running progress, error states. [M]

### Tier 2 — the wow & UX (what judges see)
5. `/world` agent-world replay (split world, same personas, speech bubbles, verdict overlay) — replay-first so it demos offline. [L]
6. Editable brief confirmation form (LLM `extractHypothesis` + heuristic fallback, source labeled). [M]
7. Variant Studio: `proposeVariants` → editable Vietnamese variant cards + Nano Banana images (graft `gen-adapters.ts`, skip Meshy). [M]
8. Click-to-interview persona drawer (MiroShark interview endpoint + canned fallback). [M]
9. Live tool-log timeline (harvest creative-intelligence's log pattern, make it stream). [S/M]
10. Provenance badges — live / mock / fallback honesty labels everywhere. [S]
11. Belief-drift chart: bullish % per round per variant + market ticker. [M]
12. Segment explorer: per-region/age winner chips with drilldown. [M]

### Tier 3 — prod-readiness & polish
13. Runtime zod validation of all external JSON (stop casting `res.json()`). [S]
14. Error/empty/loading states + graceful "no AI key" and "engine down" banners. [S/M]
15. Accessibility pass: aria-pressed on scenario chips, aria-live on streams/status, focus styles, 44px touch targets, alt text. [S]
16. Env hygiene: `MIROSHARK_INTERNAL_KEY` in `.env.example`, model via env not hardcoded. [S]
17. Experiment history page (list past runs → reopen readout/replay). [M]
18. Shareable report export (MD/PDF of verdict + stats + segment winners). [M]
19. Cost + ETA meter during live runs (fix cost.json internal-key gate first). [S/M]
20. Extract shared readout components (`components/readout/`) for `/classic` + `/world`. [M]
21. Demo hardening: pre-baked hero experiment JSONs, fallback video, `demo/SCRIPT.md`, `docs/ARCHITECTURE.md`, README ops-honesty note. [M]
22. Fix harness nits: pass `resume=true` on restart, filter 0.00% tie rows, TikTok in the synchronized runner (optional). [S]

## Quick wins (under an hour each)
- Uncomment `DEMOGRAPHICS_COUNTRY=vn`; write the scenario doc.
- Add `MIROSHARK_INTERNAL_KEY` env + header to the client.
- Label the scenario buttons "Demo outcome preset" visibly.
- aria-live + aria-pressed fixes.
- README refresh (stale Supabase/STATS_URL references in SCAFFOLD.md).
