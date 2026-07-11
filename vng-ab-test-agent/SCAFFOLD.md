# SCAFFOLD — VNG P11 A/B Test Agent

> Session brief. Read `../_starter/README.md` first. Goal: a green-deploying UI that
> designs a test from a hypothesis and reads out results, with REAL stats in tools and
> MiroShark as the demo-data generator (mocked). See `./README.md`.

## Stack
- Fork `_starter/`. Surface = **test-brief card** (metric, n, duration, guardrails) +
  **readout report card** (p-value, CI, effect, ship/iterate/kill).
- **Stats (the moat — must be REAL, never LLM math):** Python (scipy/statsmodels) as
  Vercel Python functions, or a stub returning correct values from a known dataset.
- **MiroShark:** generates plausible experiment result data (mock by default).

## Env
`AI_GATEWAY_API_KEY`, Supabase vars (minimal). Optional/mocked: `MIROSHARK_URL`, `STATS_URL`.

## Add these files
```
app/page.tsx                 # hypothesis input → test brief → (run) → readout report
app/api/agent/route.ts       # orchestrator: parse → design → (run) → significance → recommend
api/power.py                 # power_analysis (real; or lib/stats.ts stub with known values)
api/significance.py          # significance_test: picks t/z/χ²/Mann-Whitney, returns p/CI/effect
lib/experiment.ts            # parse_hypothesis, design_test, check_guardrails, recommend
lib/sim-client.ts            # MiroShark result generator (mock by default)
eval/decisions.ts            # % experiments closed with a statistically-sound decision
eval/stats.test.ts           # validate stats tools against textbook/known values
```

## Agent tools (LLM orchestrates; it does NOT compute stats)
- `parse_hypothesis(text)` → `{metric, unit, direction, mdeGuess}`
- `power_analysis(baseline, mde, alpha, power)` → required n + duration (real formula)
- `design_test()` → variants, allocation, guardrail metrics, stop conditions
- `significance_test(results)` → correct test + p-value + CI + effect size
- `check_guardrails(results)` → did retention/spend/crash regress?
- `recommend(decision)` → ship / iterate / kill + plain-language rationale

**Include trap cases** (underpowered, peeking, novelty) so it correctly says "iterate,
don't ship on noise" — that refusal is the demo's wow.

## Mock
MiroShark → mock result sets; stats functions run for real on those inputs (they're
deterministic). Deploys with zero external services.

## Eval (`npm run eval`)
- **Stats validation:** tools match statsmodels/textbook values (the credibility slide).
- **Decision quality:** % of past experiments closed with the statistically-sound call,
  including refusing bad calls. Headline number.

## Deploy
Vercel, Root Directory `vng-ab-test-agent`. Green with mocks + real stats functions.

## Done when
Hypothesis → test brief with a real power-analysis n; a run → correct significance test +
ship/iterate/kill; a trap case triggers "iterate"; eval prints validation + decision numbers.
