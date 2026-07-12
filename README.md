# Agamotto — Synthetic A/B Testing for Vietnamese Audiences

AABW hackathon, VNG track. **Type a hypothesis → an agent designs a rigorous A/B test →
two ad variants play to the *same* simulated census-grounded Vietnamese audience → a
hand-drawn agent world shows the crowd reacting live → deterministic statistics deliver
SHIP / ITERATE / KILL → click any character and ask them why.**

The Next.js product app lives at the **repo root** (flattened 2026-07-11); MiroShark is
the simulation backend. Architecture one-pager: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repo map

- **`app/`, `lib/`, `eval/`, `scripts/`** — the product app (agent, deterministic stats engine, world UI, MiroShark client). Deep-dive: [README-app.md](README-app.md).
- **[MiroShark/](MiroShark/)** — social-simulation engine (Flask + Vue + Neo4j), adapted for Vietnam (Facebook/Threads/TikTok personas, census demographics). Runs locally, never on Vercel. Its Vue UI is never demoed.
- **`lib/miroshark/`** — live-tested 10-step MiroShark client + TinyFish scrape context.
- **`lib/creative/`** — Variant Studio: agent-proposed Vietnamese ad variants (`variants.ts`) + image gen adapters (Nano Banana, graceful fallback to `public/creative/`).
- **`demo/`** — [SCRIPT.md](demo/SCRIPT.md), the 3-minute stage script with pre-flight checklist and fallback table.
- **[VNG_GRAND_PLAN.md](VNG_GRAND_PLAN.md)** — the phased build plan (paths predate the flatten: `vng-ab-test-agent/` → repo root). Product story: [vng.md](vng.md).
- **`docs/`** — architecture, MiroShark wiring notes, `docs/audits/`.
- **`_archive/vng-creative-intelligence/`** — archived; useful parts already ported to the root app.

## Demo surfaces

- **`/world` is the demo surface**: the agent world — split-screen A/B ("same 100 people,
  two realities"), live Vietnamese speech bubbles, prediction-market ticker,
  click-to-interview, verdict overlay. Stage default is replay mode
  (`/world?mode=replay&demo=kfc`), which runs entirely offline from bundled timeline JSONs.
- **`/?classic` remains**: the original stats-credibility card view (test brief + readout
  report) — the "show the judges the z-test" surface.

> **Needs a live validation run (deferred pending a paid run):** the pre-baked hero
> experiment JSONs in `public/demo/` and the 90s fallback video `demo/fallback.mp4`.
> Until that run lands, replay mode has no hero dataset — everything else (mock client,
> heuristic/hand-written fallbacks, stats, classic view) works offline today.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev                  # app only (mock sim client — full flow, canned data)
npm run dev:miroshark        # app + local MiroShark backend together
npm run smoke:miroshark -- --max-rounds 1   # live pipeline smoke test (~$, minutes)
npm run eval                 # stats validation (vs scipy/statsmodels) + decision eval gate
```

MiroShark backend by hand (separate terminal): `docker compose up -d neo4j` in `MiroShark/`,
then `~/mirovenv/Scripts/python run.py` from `MiroShark/backend` (Windows: the venv must
live at a short path — see `MiroShark/docs/VNG_AB_STATUS.md`).

## Ops honesty (pilot-grade)

Single sim worker per MiroShark instance — **one experiment at a time** (a second create
gets a 409). Experiment state and results live on **local disk**
(`MiroShark/backend/uploads/experiments/`). This is pilot-grade by design; the app↔engine
contract is plain HTTP, so hardening is deployment work, not a rewrite.
