# VNG — Synthetic A/B Testing & Creative Intelligence

AABW hackathon, VNG track. **The Next.js product app now lives at the repo root**
(flattened 2026-07-11); MiroShark is the simulation backend.

## Layout

- **`app/`, `lib/`, `eval/`, `scripts/`** — the product app (agent, stats engine, MiroShark client). App details: [README-app.md](README-app.md).
- **[MiroShark/](MiroShark/)** — social-simulation engine (Flask + Vue + Neo4j), adapted for Vietnam (Facebook/Threads/TikTok personas). Runs locally, never on Vercel.
- **`lib/miroshark/`** — live-tested 10-step MiroShark client + TinyFish scrape context (ported from creative-intelligence).
- **`lib/creative/`** — creative generation adapters (Nano Banana, graceful fallback to `public/creative/`).
- **[VNG_GRAND_PLAN.md](VNG_GRAND_PLAN.md)** — the phased build plan (paths predate the flatten: `vng-ab-test-agent/` → repo root).
- **[vng.md](vng.md)** — plain-English product story.
- **docs/** — plans, MiroShark wiring notes, and `docs/audits/` (2026-07-11 feature audit).
- **`_archive/vng-creative-intelligence/`** — archived; its MiroShark client, scrape context, gen adapters, and scripts were ported to the root app.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev                  # app only (mock sim data)
npm run dev:miroshark        # app + local MiroShark backend
npm run smoke:miroshark -- --max-rounds 1   # live pipeline smoke test
npm run eval                 # stats + decision eval gate
```

MiroShark backend (separate terminal): `docker compose up -d neo4j` in `MiroShark/`,
then `~/mirovenv/Scripts/python run.py` from `MiroShark/backend` (Windows: venv must
live at a short path, see `MiroShark/docs/VNG_AB_STATUS.md`).
