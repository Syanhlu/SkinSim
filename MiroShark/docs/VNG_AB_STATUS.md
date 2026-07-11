# VNG A/B Testing — Status & Remaining Work

_Last updated: 2026-07-10 (evening). Everything below reflects `main` @ `03831fe`._

## TL;DR

The synthetic A/B testing pipeline **works end-to-end on real OpenAI calls**: one
simulated audience → N ad variants → K replicate runs each → statistical report
(means, 95% CIs, Welch t-test, per-demographic winners). Validated today with a
live 4-sim experiment on the merged codebase (Threads/Facebook platforms,
48 rounds each, ~370 agent actions per run). Full unit suite: **1444 passed**.

## What shipped today

- **OpenAI is the default provider** (gpt-5.4 family; ~$1–2/run). OpenRouter
  still works — every OpenRouter-specific request behavior is auto-detected per
  slot from the base URL, so you can mix providers (e.g. agent loop on
  OpenRouter, reports on OpenAI). Note: direct OpenAI needs
  `max_completion_tokens`, handled automatically.
- **LLM stance judge** replaces the English keyword counter that used to
  produce the bullish/bearish numbers. Batched (1 call/round), language-agnostic
  (works on Vietnamese posts), falls back to keywords on failure.
  Env: `STANCE_JUDGE_ENABLED` (default true), `STANCE_JUDGE_MODEL`.
- **Real market prices in exports**: `signal.json` / `polymarket.json` now carry
  `amm_yes_probability` (the actual simulated AMM price) alongside the
  belief-derived number.
- **Vietnam support**: `vn` country pack wired to `nvidia/Nemotron-Personas-Vietnam`
  (900k census-grounded Vietnamese personas), Nam/Nữ gender mapping, full `vi`
  backend prompt locale (8 modules).
- **Reproducibility knobs**: `SIMULATION_SEED` (seeds every platform, re-seeds
  per round) + `WONDERWALL_TEMPERATURE`. LLM sampling still adds variance —
  hence replicates.
- **A/B harness**: `backend/scripts/ab_experiment.py` (see `README_AB.md`).
  ```
  python backend/scripts/ab_experiment.py \
    --scenario-file brief.txt \
    --variant A=@adA.txt --variant B=@adB.txt \
    --replicates 3
  ```
  Resumable (`--resume`), parallel-capped, writes `report.md` + `results.json`.
- **Merged with the Vietnamese-market platform work** (Threads/Facebook replace
  Twitter/Reddit; TikTok opt-in). Fixed in the merge: the pushed
  `vietnam.json` `country_values` were missing the diacritics form
  `"Việt Nam"` — the country filter would have matched 0 of 100k personas.
  (There is also a zero-row safety net in `demographic_sampler.py` now.)

## What's left

### Must-do before demoing (the one that matters)

1. **Fix the 100%-bullish problem — richer audience.** Today's smoke test used a
   4-agent audience derived from a KFC-only scenario doc, so every variant
   scored 100% positive and A vs B showed zero difference. Two changes:
   - Seed with a **richer scenario document**: name competitors (Lotteria,
     Jollibee…), price-sensitive customers, food reviewers, skeptics.
   - Enable **`DEMOGRAPHICS_COUNTRY=vn`** in `.env` to anchor personas in the
     real Vietnamese census data. First run downloads ~100MB from HuggingFace
     and needs `pip install duckdb huggingface_hub` in the backend venv.
   Then a variant comparison actually discriminates, and the per-region /
   per-age winner tables become the demo's money shot.

### Small polish (5-minute fixes)

2. **Cost shows "n/a" in the A/B report** — `GET /api/simulation/<id>/cost.json`
   is publish-gated; the harness doesn't publish branches. Either auto-publish
   experiment branches or exempt cost for internal-key callers.
3. **Demographic table shows 0.00% "ties"** for segments where no agent was
   bullish — filter those rows from `report.md`.

### Nice-to-haves

4. **Demo dry-run** with Vietnamese personas on (~20 min, ~$2) before judging.
5. **Frontend page for A/B results** — harness is CLI-only; `report.md` is the
   artifact. A simple results view would sell harder.
6. **TikTok in the A/B flow** — TikTok is opt-in standalone; the harness
   currently exercises Threads/Facebook/Polymarket. Wire `tiktok` into the
   synchronized runner + seed it (`_seed_platform_random("tiktok")`) if wanted.

## Known environment quirks (Windows dev)

- Backend venv must live at a **short path** (e.g. `~/mirovenv`) — torch install
  fails inside the OneDrive-nested repo path (Windows 260-char limit).
- Requires `sentence-transformers` (recsys imports it at module load) — it's in
  the camel-smoke CI set but not `requirements.txt`.
- Run the backend with the venv python: `~/mirovenv/Scripts/python run.py`.
- `.env` at repo root is gitignored and holds the real OpenAI key (5 slots, same
  key) + `NEO4J_PASSWORD` + `RERANKER_ENABLED=false` (skips a 1GB model
  download; re-enable for better graph retrieval).

## Today's validation evidence

- Live experiment: parent `sim_257ab60e2cc9`, 4 branch runs, all completed
  48/48 rounds (~187 Threads + ~186 Facebook actions each). Output in the
  operator's `~/ab-exp-3/`.
- Edge cases found live and fixed: OpenAI `max_tokens` rejection, torch
  MAX_PATH install failure, CLI cp1252 crash, missing `sentence-transformers`,
  failed-run pollution of stats tables, diacritics-less country filter.
