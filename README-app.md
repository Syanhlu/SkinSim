# SkinSim app — deep-dive

The Next.js 16 (AI SDK v5) product app at the repo root: an **A/B test design & readout
agent** (VNG P11, Gaming/LiveOps track) fused with a synthetic Vietnamese audience
(MiroShark) and a hand-drawn agent-world UI. Repo overview: [README.md](README.md) ·
diagrams + env vars: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · stage script:
[demo/SCRIPT.md](demo/SCRIPT.md).

**Win condition (the track's):** % of experiments closed with a statistically sound
decision, and cycle time per test. The moat is trust: agentic convenience with a
biostatistician's rigor.

## The one rule

**The LLM never computes statistics.** Every number — sample size, p-value, CI, effect
size, guardrail state, ship/iterate/kill — comes from `lib/stats.ts`, a deterministic
TypeScript implementation validated against scipy/statsmodels to ~4 decimal places by
`npm run eval` (Welch t with Welch–Satterthwaite df, two-proportion z, 2×2 Pearson χ²,
Mann-Whitney with tie/continuity correction, binary + continuous power analysis).
`eval/agent-consistency.ts` asserts the agent's tool chain and the direct
`evaluateExperiment()` path produce identical numbers, so the rule is enforced, not aspirational.
The model's job is to **choose** the right test and **narrate** — never to compute.

## Layout

| Path | What |
|---|---|
| `app/page.tsx` | classic view (`/?classic`): test-brief + readout report cards |
| `app/world/` | the demo surface: split-world A/B crowd, TV billboards, interviews, verdict overlay (Phase 4, built in parallel) |
| `app/api/agent/route.ts` | the agent loop (`streamText` + tools: parse_hypothesis, power_analysis, design_test, significance_test, check_guardrails, recommend; Phase 3/5 add extraction, run_experiment, propose_variants) |
| `app/api/experiment/` | server proxy to MiroShark — the internal key never reaches the browser (Phase 3) |
| `lib/stats.ts` | the deterministic stats engine — single source of statistical truth |
| `lib/experiment.ts` | brief parsing, test design, decision rule (failing `watch` guardrail ⇒ at least ITERATE; `critical` ⇒ KILL) |
| `lib/sim-client.ts` | `SimClient` interface: `MiroSharkClient` (real) / `MockSimClient` (canned) — selected by `MIROSHARK_URL`, forceable with `?sim=mock` |
| `lib/creative/variants.ts` | Variant Studio: `proposeVariants(hypothesis, brief)` → 2–3 Vietnamese ad variants (≤140 chars; price/social/novelty angles + strategy notes) via `generateObject`; deterministic hand-written fallback when no AI key — never throws |
| `lib/creative/gen-adapters.ts` | Nano Banana image gen behind a key check; `generateVariantImage` always returns a bundled `/creative/*.png` fallback too |
| `lib/miroshark/` | live-tested 10-step single-sim client + TinyFish scrape context |
| `eval/` | the gate: stats reference tests, decision cases (incl. traps: underpowered, peeking, novelty, guardrail), agent-consistency guard |
| `scripts/` | `smoke-miroshark.ts` (live pipeline smoke), `dev-with-miroshark.mjs` |

## Flow

1. **Hypothesis → brief.** LLM structured extraction (metric, type, direction, MDE guess),
   rendered as an **editable form** — the operator confirms baselines (that's the honest
   answer to "where do baselines come from"). No AI key ⇒ labeled keyword-heuristic fallback.
2. **Brief → variants.** `proposeVariants` suggests Vietnamese ad copy across distinct
   angles; user edits, picks two, launches. No key ⇒ labeled hand-written KFC-style fallback.
3. **Run.** The proxy creates a MiroShark experiment (same parent personas, one
   counterfactual branch per variant × replicate); the world UI polls and renders the
   crowd live. `MIROSHARK_URL` unset ⇒ mock client, same interface, UI can't tell.
4. **Readout.** Final stances pool into per-variant Bernoulli counts → two-proportion
   z-test → verdict card with p, CI, effect, per-region winners. Per-replicate means stay
   in `raw`/`notes` for honesty about clustering. Underpowered/noisy input ⇒ **ITERATE,
   don't ship on noise** — the refusal is the demo's money shot.

## Commands

```bash
npm run dev                  # mock data, zero external deps
npm run dev:miroshark        # app + MiroShark backend together
npm run smoke:miroshark -- --max-rounds 1
npm run eval                 # must stay green: stats validation + decision score
npx tsc --noEmit             # typecheck
```

Env vars: see the table in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Everything runs
green with **no** keys set (mock sim, heuristic brief, hand-written variants, bundled images).

## Ops honesty

Pilot-grade on purpose: one background sim worker per MiroShark instance (**one
experiment at a time**, concurrent creates 409), results and experiment state persist to
**local disk** on the machine running MiroShark. The app↔engine contract is plain HTTP
behind `SimClient`, so productionizing is deployment work, not a rewrite.

## Status notes (2026-07-11)

- Phases 3–5 (proxy, extraction, world UI, variant wiring) are landing in parallel lanes;
  the contracts above come from [VNG_GRAND_PLAN.md](VNG_GRAND_PLAN.md).
- **Deferred pending a paid validation run:** the pre-baked hero experiment
  (`public/demo/*.json`) and the fallback video (`demo/fallback.mp4`).
