# SCAFFOLD — VNG P5 Creative Intelligence

> Session brief. Read `../_starter/README.md` first. Goal: a green-deploying dashboard
> that (a) analyzes ad performance vs pLTV and (b) runs a skin-gen pipeline with the
> sim/gen steps MOCKED. See `./README.md`.

## Stack
- Fork `_starter/`. Surface = **dashboard**: Recharts (ROAS/pLTV) + `<model-viewer>` 3D.
- **Analysis:** pLTV join + theme clustering — Python (pandas/scikit-learn) or DuckDB.
- **Gen pipeline (all behind adapters):** Nano Banana (images), **MiroShark** (reception),
  Meshy (image→3D). Use `getSimClient()` → `MockSimClient` by default.
- **Data:** ad-platform exports (CSV) → DuckDB or Supabase. Schema prefix `vng_ci_`.

## Env
`AI_GATEWAY_API_KEY`, Supabase vars. Optional/mocked: `NANO_BANANA_KEY`, `MESHY_KEY`,
`MIROSHARK_URL` (leave empty → mock).

## Add these files
```
app/page.tsx                 # dashboard: theme clusters, pLTV-ROAS charts, skin gallery, 3D viewer
app/api/agent/route.ts       # analysis agent (join → tag → cluster → recommend)
lib/analysis.ts              # join_perf_ltv, tag_themes (LLM vision), cluster, recommend_direction
lib/gen.ts                   # gen_skins (mock→NanoBanana), to_3d (mock→Meshy)
lib/sim-client.ts            # from _starter — MiroShark reception (mock by default)
data/ads.sample.csv          # synthetic ad-platform export
eval/backtest.ts             # pLTV-weighted ROAS lift if you follow agent's theme picks
```

## Two halves (keep them separate)
- **[A] Analysis (must be rigorous):** `join_perf_ltv` → `tag_themes` → `cluster` on
  **high-value-player share** (not spend) → `recommend_direction`. This is what's scored.
- **[B] Gen (spectacle, all mockable):** `gen_skins(theme)` → `simulate_reception` (MiroShark
  mock) → `pick_best` → `to_3d`. Ship placeholder images + a sample .glb so it deploys green.

## Mock
Synthetic ads CSV; `gen_skins`/`to_3d` return bundled placeholder assets; MiroShark →
mock verdict. Everything renders with zero external APIs.

## Eval (`npm run eval` → backtest)
On historical data, "following the agent's theme picks would lift pLTV-weighted ROAS by X%."
Optional: MiroShark calibration ("ranked 4/5 known hits above flops"). Headline number.

## Deploy
Vercel, Root Directory `vng-creative-intelligence`. Green with mocks.
MiroShark/Nano-Banana/Meshy wired during build week (Day-1 spike for MiroShark).

## Done when
Dashboard shows theme clusters + a pLTV-ROAS chart from data; a "generate" button runs
the (mock) pipeline end-to-end to a 3D model; backtest prints a number.
