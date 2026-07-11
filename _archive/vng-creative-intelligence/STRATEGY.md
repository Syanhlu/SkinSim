# VNG P5 — Creative Performance Intelligence Agent

**Partner:** VNG Games · **Track:** Gaming (Bucket 2 — Growth / UA & Marketing) · **Category:** Consumer AI
**URL:** https://aitalent.genaifund.ai/tracks/gaming/creative-intelligence
**Biggest lever for us:** **Demo wow-factor** — this is the highest-ceiling "jaw-drop" project (creative → 3D asset
pipeline). Win by making the *generation* moment spectacular while keeping the *analysis* genuinely data-grounded.

---

## 1. The brief (condensed)

UA teams know which creatives **spend**, not which bring **high-value players vs. tourists**. Build an agent that
**joins ad-platform performance with predicted LTV (pLTV)**, **clusters winning themes**, tells UA which themes
deliver high-intent players, and **recommends the next creative direction**.

- **Inputs:** ad-platform exports (TikTok/Meta/Google or an MMP); pLTV or early-monetization signals by cohort.
- **Win condition:** lift in **pLTV-weighted ROAS** on agent-recommended themes.
- **Build direction:** join ad performance + pLTV → cluster winning themes → recommend next creative directions.

## 2. Our original notes

- Find successful **skin lines / themes**, then generate more on that theme.
- Scrape **Threads/Facebook** for context → feed **Mirofish** → **simulate a skin release + its reception** → take the
  best skin line.
- Then **Nano Banana** generates more skins → **Meshy AI** turns them into 3D models.

> **Resolved:** "Mirofish" is a real, open-source swarm-simulation engine — and we're standardizing on its English
> reimplementation **[MiroShark](https://github.com/aaronjmars/MiroShark)** (see §4). It's no longer something we
> build; it's a tool we integrate, which is both more credible and less work.

## 3. The winning insight

Two different projects are hiding in your notes — **the brief's analysis loop** and **your generative pipeline**. The
winning move is to **fuse them into one closed loop** nobody else will attempt:

> **Analyze what wins (grounded) → decide the next theme (agentic) → generate it (spectacular) → simulate its
> reception before spend (defensible).**

That closed loop — *from ad data all the way to a 3D asset you could ship* — is the wow. But the **credibility** comes
from the front half (real pLTV-weighted analysis), and the **honesty** comes from labeling the sim as a plausibility
check, not truth. Do both and you're uncatchable on this brief.

## 4. Agentic architecture

```
Ad-platform exports + pLTV/cohort signals
   │
   ▼
[A] Creative Intelligence agent  (the brief's core — this must be rigorous)
   ├─ tool: join_perf_ltv(creatives, cohorts)   → per-creative pLTV-weighted ROAS, not just installs
   ├─ tool: tag_themes(creative_meta)            → theme labels (art style, hero, motif) via LLM vision/metadata
   ├─ tool: cluster(themes)                      → winning theme clusters by high-value-player share
   └─ tool: recommend_direction(clusters)        → "make more of theme T; avoid tourist-magnet theme U" + why
   │
   ▼  (recommended theme T)
[B] Generative pipeline  (your notes — the spectacle)
   ├─ tool: gather_context(Threads/FB scrape)    → current fan sentiment/motifs for theme T
   ├─ tool: gen_skins(theme T)                   → Nano Banana concepts on-theme
   ├─ tool: simulate_reception(concept)          → MiroShark: swarm-sim → predicted reception + prediction-market odds
   ├─ tool: pick_best(scored concepts)           → top skin line
   └─ tool: to_3d(best)                           → Meshy AI → previewable 3D model
```

- **The rigorous half [A]** is what the brief scores. Get pLTV-weighted ROAS right; *tourist vs. whale* separation
  is the whole point. Cluster themes on **high-value-player share**, not spend.
- **Theme tagging** — use LLM vision over creative thumbnails + ad metadata to label art style/hero/motif so themes
  are analyzable objects, not vibes.
- **MiroShark `simulate_reception`** — [aaronjmars/MiroShark](https://github.com/aaronjmars/MiroShark) is a real
  swarm-sim engine: feed it a skin concept (image + blurb), it spawns hundreds of Neo4j-grounded fan personas that
  post/argue/trade across simulated Twitter/Reddit + a **prediction market**, and returns a report + machine-readable
  verdict citing actual simulated posts. Run locally via `./miroshark` (Python 3.11+, Node 18+, Neo4j, **OpenRouter —
  route Claude through it**), ~**$1 and <10 min** per run, or hit its **HTTP API** (Swagger at `/api/docs`). We use its
  auto-generated Bull/Bear/Neutral scenarios + prediction-market odds as a **plausibility ranker** — good enough to
  rank concepts, not ground truth. **Calibrate** against 2–3 historically known hits/misses so scores aren't arbitrary.

## 5. Data grounding & eval

- Use provided ad exports (or a realistic synthetic set with documented assumptions if none arrive).
- **Evidence slide:** show the agent correctly separating **high-pLTV themes from tourist-magnet themes** on a
  held-out set, and a **back-test**: "on past data, following the agent's theme picks would have lifted pLTV-weighted
  ROAS by ~X%." That back-test is the brief's exact win condition — make it your headline.
- **Sim calibration** (optional): report how MiroShark scored known hits vs. flops — "ranked 4/5 real hits above
  flops." Turns a hand-wavy sim into a defensible ranker.

## 6. The killer demo (3 minutes)

1. Agent ingests ad data → **"Theme A (neon-mecha) brings whales; Theme B (chibi-cute) brings tourists"** — with the
   pLTV-weighted ROAS chart. *(credibility earned here)*
2. Agent recommends: "double down on neon-mecha." → **Nano Banana generates 4 on-theme skins live.**
3. **MiroShark scores them** (predicted reception + market odds), picks the winner → **Meshy spins it into a rotating
   3D model on screen.** **Wow moment.**
4. Back-test slide: projected pLTV-weighted ROAS lift. Close: "analysis → asset in one agent loop."

**Fallbacks:** pre-generate skins + 3D models as backup (gen APIs are slow/flaky); record the whole pipeline. Never
let a live Nano Banana/Meshy call be the single point of failure on stage.

## 7. 5-day plan (4–6 team)

- **D1** — ad-data ingest + join_perf_ltv; storyboard; decide synthetic-vs-provided data; stub the gen pipeline.
- **D2** — theme tagging + clustering + recommend_direction; the analysis half works end-to-end.
- **D3** — back-test eval (the ROAS-lift number); stand up MiroShark (Neo4j + OpenRouter) and wire Nano Banana →
  MiroShark score → pick_best.
- **D4** — Meshy 3D step; UI to show charts + gallery + 3D viewer; pre-render all fallbacks.
- **D5** — deck (lead with back-test), README, 5 dry-runs.

**Roles:** ML/data (pLTV join + clustering + back-test) · agent lead (loop + gen tools) · frontend (charts + 3D
viewer) · designer (deck + the reveal choreography) · glue (scrapers + gen-API orchestration/caching).

## 8. Risks & mitigations

- **Two-projects-in-one scope blowout** → the **analysis half [A] is the MVP and must be bulletproof**; the gen
  pipeline [B] is the "wow" layer — if time runs out, demo [A] rigorously + [B] with pre-rendered assets.
- **MiroShark credibility + setup time** → it's a real tool but a fork; do the Neo4j+OpenRouter install as a **Day-1
  spike** so it isn't a surprise. Label its output a plausibility ranker; calibrate on known hits/misses; never claim
  it predicts revenue. Keep the HTTP API path as a fallback if the local launcher fights us.
- **Gen-API latency/cost/flakiness** → pre-generate; cache; keep live calls to one hero example.
- **Scraping Threads/FB ToS + noise** → use it as soft context only; have a cached context bundle; don't build the
  demo's critical path on a live scrape.
- **IP/brand safety on generated skins** → keep concepts original/abstract; note a human-review gate for production.

## 9. Scorecard

| Judge lever | How we hit it |
|---|---|
| Live demo wow | Ad data → recommended theme → generated skins → **live 3D model**. Highest ceiling of the six. |
| Business/ROI fit | Directly targets **pLTV-weighted ROAS lift** with a back-test number |
| Agentic depth | A closed analyze→decide→generate→simulate loop with real tool use across data + gen APIs |
| Data grounding | pLTV-weighted analysis + held-out back-test; sim calibrated against known outcomes |

**Verdict:** the boldest, most memorable option — but the **riskiest scope**. Only pick it if the team can keep the
analysis half rigorous *and* wrangle the gen pipeline. Discipline (MVP = analysis) is what turns wow into a win.
