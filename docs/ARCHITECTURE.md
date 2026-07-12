# Agamotto Architecture — one-pager

Type a hypothesis → agent designs the test → variants broadcast to the same simulated
Vietnamese audience → deterministic statistics deliver SHIP / ITERATE / KILL.
**Design rule:** every arrow below has an offline fallback behind the same interface,
so the full demo survives with MiroShark (or the WiFi) down.

```
┌────────────────────────────── Next.js app (repo root) ──────────────────────────────┐
│                                                                                     │
│  /world  agent-world UI (split A/B crowd, TV, interviews)      /?classic  stats UI  │
│  app/api/agent      agent loop (AI SDK v5, Claude Opus)                             │
│  lib/stats.ts       deterministic stats: power, z/t/χ²/MW, CI  ← the LLM NEVER      │
│  lib/experiment.ts  brief extraction + design + decision rule    computes numbers   │
│  lib/creative/      variant proposals + image gen (Nano Banana)                     │
│                                                                                     │
│         fallbacks here: heuristic hypothesis parser (no AI key),                    │
│         hand-written Vietnamese variants, bundled /creative/*.png images            │
└──────────────────────────────────────┬──────────────────────────────────────────────┘
                                       │ browser never sees keys
                                       ▼
                        ┌──────────────────────────────┐
                        │  /api/experiment proxy       │  app/api/experiment/route.ts
                        │  POST create · GET status ·  │  attaches x-miroshark-internal-key
                        │  GET results                 │  server-side (lib/sim-client.ts)
                        └──────────────┬───────────────┘
                                       │ fallback: MIROSHARK_URL unset → MockSimClient
                                       │ (canned datasets); ?sim=mock forces it;
                                       │ /world?mode=replay plays bundled timeline JSONs
                                       ▼
                        ┌──────────────────────────────┐
                        │  MiroShark experiments API   │  MiroShark/backend/app/api/
                        │  POST /api/experiments/      │  experiments.py (Flask blueprint,
                        │    ab-test · /status ·       │  internal-key guard, contract-first
                        │    /results · /list          │  in openapi.yaml)
                        └──────────────┬───────────────┘
                                       │ fallback: state.json persisted per experiment on
                                       │ disk → restarts don't lose finished work; CLI
                                       │ ab_experiment.py drives the same service
                                       ▼
                        ┌──────────────────────────────┐
                        │  Sim engine                  │  wonderwall multi-agent sim:
                        │  census personas (Nemotron   │  personas post on fake FB/Threads,
                        │  Vietnam) · belief drift ·   │  bet on a prediction market;
                        │  prediction market (AMM)     │  Neo4j stores the knowledge graph
                        └──────────────────────────────┘
```

## Data flow (happy path)

1. User types a hypothesis → agent extracts a brief (metric, MDE, direction) → user
   confirms in an editable form → agent proposes 2–3 Vietnamese variants (Phase 5).
2. `/api/experiment` POST → MiroShark clones one prepared parent simulation per
   variant × replicate (same personas, different injected ad = controlled counterfactual).
3. App polls status every ~5s; the world UI renders per-round stances, posts, and the
   market probability as a live crowd.
4. On completion, results map each agent's final stance to one Bernoulli observation
   (`visitors` = agents, `conversions` = bullish) → `lib/stats.ts` runs the
   two-proportion z-test → verdict card. Per-replicate means stay in `raw`/`notes`.

## Fallback matrix

| Link | Live | Fallback |
|---|---|---|
| Hypothesis → brief | LLM `generateObject` extraction | keyword heuristic parser (labeled) |
| Brief → variants | LLM `proposeVariants` | 3 hand-written Vietnamese variants (labeled) |
| Variant images | Nano Banana (`NANO_BANANA_KEY`) | bundled `/creative/*.png`, deterministic pick |
| App → experiment | MiroShark HTTP (`MIROSHARK_URL`) | `MockSimClient` canned datasets; `?sim=mock` |
| World playback | LiveDriver polling the proxy | ReplayDriver on `public/demo/*.json` |
| Interviews | MiroShark interview endpoint | 3 canned Q&As per highlighted agent |
| Statistics | — | none needed: `lib/stats.ts` is deterministic, offline, scipy-validated |

## Environment variables

| Var | Where | Purpose |
|---|---|---|
| `MIROSHARK_URL` | app `.env.local` | MiroShark base URL (e.g. `http://localhost:5001`); **unset ⇒ mock client** |
| `MIROSHARK_INTERNAL_KEY` | app `.env.local` | server-side `x-miroshark-internal-key` auth for `/api/*` — never sent to the browser |
| `MIROSHARK_ADMIN_TOKEN` | app `.env.local` | bearer token for MiroShark's admin-gated publish step (must match MiroShark `.env`) |
| `TINYFISH_API_KEY` | app `.env.local` (optional) | TinyFish web-scrape context enrichment before simulation ingest |
| `NANO_BANANA_KEY` | app `.env.local` (optional) | live ad-creative image generation; absent ⇒ labeled fallback assets |
| `DEMOGRAPHICS_COUNTRY` | MiroShark `.env` | `vn` ⇒ census-grounded Vietnamese personas (Nemotron-Personas-Vietnam) |

## Ops honesty (pilot-grade)

One background sim worker per MiroShark instance (single experiment at a time; concurrent
create returns 409), experiment state and results persist to local disk
(`backend/uploads/experiments/`), and the backend runs on one local machine. This is a
pilot, not a platform — the contracts are HTTP so scaling out is a deployment problem,
not a rewrite.
