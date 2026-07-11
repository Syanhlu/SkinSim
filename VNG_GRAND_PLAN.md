# VNG GRAND PLAN — Synthetic A/B Testing, production-ish

> **How to use this file:** run `/goal` (executes phases in order) or `/goal phase-2` /
> `/goal 2,3` (specific phases). Each phase has exact files, contracts, acceptance
> criteria, and fallbacks — treat acceptance criteria as the definition of done and do
> not stop a phase until they pass or are explicitly blocked.
>
> Plain-English product story: [`vng.md`](./vng.md). Current MiroShark status:
> [`MiroShark/docs/VNG_AB_STATUS.md`](./MiroShark/docs/VNG_AB_STATUS.md).

## The product in one paragraph

**Type a hypothesis → an agent designs a statistically rigorous A/B test → two ad
variants are broadcast to the *same* simulated Vietnamese audience (census-grounded
personas on fake Facebook/Threads + a prediction market) → a hand-drawn "agent world"
shows the crowd reacting live → real statistics (never LLM math) deliver a
SHIP / ITERATE / KILL verdict with per-region winners → click any character and
interview them about why.**

## Repo map (who does what)

| Piece | Path | Role |
|---|---|---|
| Sim engine | `MiroShark/` (Flask + Vue + Neo4j) | Generates the experiment data. We add ONE new API blueprint. Never demo its Vue UI. |
| Product app | **repo root** (`app/`, `lib/`, `eval/` — flattened 2026-07-11; Next.js 16, AI SDK v5) | The face: agent, stats engine, agent-world UI. Almost all new code lands here. Where phases below say `vng-ab-test-agent/`, read repo root. |
| MiroShark client (ported) | `lib/miroshark/` + `scripts/smoke-miroshark.ts` | Live-tested 10-step single-sim client + TinyFish scrape context, grafted from creative-intelligence 2026-07-11. Phase 3 builds on this. |
| Archived | `_archive/vng-creative-intelligence/` | Graft complete (gen-adapters → `lib/creative/`, assets → `public/creative/`, sim client → `lib/miroshark/`). Ignore. |

## Non-negotiable constraints

1. **The LLM never computes statistics.** All numbers come from `vng-ab-test-agent/lib/stats.ts` (validated vs scipy). The model only chooses tests and narrates.
2. **Everything must demo with MiroShark down.** Every real integration keeps a mock/replay fallback behind the same interface. `MockSimClient` and pre-exported frame JSONs are load-bearing, not throwaway.
3. **MiroShark conventions** (`MiroShark/CLAUDE.md`): new endpoints are contract-first (`openapi.yaml` + drift test + offline unit test), blueprints registered in `app/__init__.py`, `/api/*` is behind the `x-miroshark-internal-key` guard — don't widen exemptions.
4. **Windows quirks:** MiroShark backend venv lives at `~/mirovenv` (torch fails under the OneDrive path). Run backend as `~/mirovenv/Scripts/python run.py` from `MiroShark/backend`. `.env` at MiroShark root holds the OpenAI key (5 slots) + `NEO4J_PASSWORD`. Neo4j: `docker compose up -d neo4j`.
5. **Budget:** a full sim run ≈ $1–2 and 10–20 min. Validation runs are fine; don't loop them carelessly.

---

# PHASE 1 — Make the audience disagree (MiroShark)

**Why first:** the last live experiment scored 100% bullish on every variant — A vs B
showed zero difference. Until variants discriminate, every downstream phase demos
nothing. (Ref: `docs/VNG_AB_STATUS.md` §"Must-do".)

### Tasks

1.1 **Rich demo scenario document** → `MiroShark/backend/scenarios/vng_demo_scenario.txt`
(create `scenarios/` dir; plain text). Content requirements — a KFC Vietnam ad-campaign
scenario that *names*:
  - Competitors: Lotteria, Jollibee, Texas Chicken, Popeyes, local cơm gà vendors.
  - Audience segments with friction: price-sensitive students, families comparing combo
    value, health-conscious office workers, food reviewers/KOLs who criticize for
    engagement, loyal fans, and outright fast-food skeptics.
  - Market context: delivery apps (ShopeeFood/GrabFood) price wars, 2026 inflation
    sensitivity, Gen Z Threads/TikTok discourse patterns.
  - An explicit open question the market bets on (e.g. "Will this promotion drive a
    visible sales lift within 2 weeks?") so prediction-market stances can split.

1.2 **Enable Vietnamese census personas.** In `MiroShark/.env`: `DEMOGRAPHICS_COUNTRY=vn`.
Preflight: `~/mirovenv/Scripts/python -m pip install duckdb huggingface_hub` (first run
downloads ~100MB Nemotron-Personas-Vietnam from HuggingFace). Verify
`sentence-transformers` is importable in the venv.

1.3 **Skeptic floor (only if needed after 1.5).** If a validation run still >90% bullish:
add a persona-mix knob — e.g. env `PERSONA_CRITIC_RATIO=0.3` consumed in
`backend/app/services/wonderwall_profile_generator.py` to bias generated personas toward
critical/price-sensitive archetypes (append trait text to the persona_generation prompt
for that share of profiles). Keep it flag-guarded, default off.

1.4 **5-minute polish items** from the status doc:
  - Cost "n/a": in the cost endpoint handler (`backend/app/api/simulation.py`, cost.json
    route) allow internal-key-authenticated callers to read cost for unpublished sims
    (do NOT widen the public exemption list).
  - Filter spurious `0.00% (tie)` rows from `ab_experiment.py` report demographics table.

1.5 **Validation run** (~$3–5, ~30 min wall):
```bash
cd MiroShark/backend
~/mirovenv/Scripts/python scripts/ab_experiment.py \
  --scenario-file scenarios/vng_demo_scenario.txt \
  --variant A="Gà Rán Giòn Cay — combo 89k, giảm 30% cho đơn đầu tiên trên app" \
  --variant B="KFC x Bạn Thân — mua 1 tặng 1 thứ Ba hàng tuần, chỉ tại cửa hàng" \
  --replicates 3 --parallel 2 --out experiments/phase1-validation
```

### Acceptance criteria
- [ ] Final bullish % is strictly between 20% and 85% for every run (no 0%/100% walls).
- [ ] Variant A and B mean bullish % differ, and per-demographic winner tables are non-degenerate (at least one segment splits from the overall winner OR shows a visibly different margin).
- [ ] Personas in `profiles` output show Vietnamese names/regions from the census pack.
- [ ] Cost appears (not "n/a") in `report.md`; no 0.00% tie rows.
- [ ] `cd backend && pytest -m "not integration"` still green.

### Fallback
If the census download or duckdb fails on this machine, run with the richer scenario doc
only (personas still LLM-generated from KG entities) — acceptance bar drops to "variants
discriminate", and note the gap in the phase report.

---

# PHASE 2 — The experiment API (MiroShark grows a product-grade endpoint)

**Goal:** everything `ab_experiment.py` does, as an async HTTP job the Next.js app can
create and poll. CLI keeps working.

### 2.1 Refactor CLI logic into a service

New: `MiroShark/backend/app/services/ab_experiment_service.py`
- Extract the orchestration from `backend/scripts/ab_experiment.py` (parent prep →
  `branch-counterfactual` per variant×replicate → start with `--parallel` cap →
  batch-status polling → metrics collection → stats) into an `ABExperimentService`
  class that calls the existing service layer / internal HTTP identically.
- Runs each experiment in a **background thread** (mirror the pattern in
  `services/simulation_runner.py`; in-process registry keyed by `experiment_id` —
  single-worker constraint is accepted and documented).
- Persists state after every transition to
  `backend/uploads/experiments/<experiment_id>/state.json` (same schema the CLI already
  writes, plus `status`, `progress`, `error`) so polling reads disk, restarts don't
  lose finished work, and the CLI `--resume` mental model carries over.
- `ab_experiment.py` becomes a thin wrapper importing the service (CLI flags unchanged).

### 2.2 New blueprint: `MiroShark/backend/app/api/experiments.py`

Register in `app/__init__.py`; document all routes in `openapi.yaml` under a new
`Experiments` tag; add the prefix to the drift test's map. All routes behind the
internal-key guard (no new exemptions).

**`POST /api/experiments/ab-test`** → `202`
```jsonc
// request
{
  "hypothesis": "string, required — free text, stored for the report",
  "scenario": "string — parent scenario text (or use parent_simulation_id)",
  "parent_simulation_id": "string — reuse an existing prepared parent",
  "variants": [ {"name": "A", "text": "ad copy A"}, {"name": "B", "text": "ad copy B"} ], // ≥2
  "replicates": 3,          // default 3
  "parallel": 2,            // default 2
  "trigger_round": 0        // default 0
}
// response
{ "experiment_id": "exp_ab12cd34", "parent_simulation_id": "sim_...", "status": "preparing" }
```
Validation: 400 if neither scenario nor parent_simulation_id, or <2 variants. 409 if
another experiment is actively running (single-worker).

**`GET /api/experiments/<experiment_id>/status`** → `200`
```jsonc
{
  "experiment_id": "exp_ab12cd34",
  "status": "preparing" | "running" | "complete" | "failed",
  "progress": { "runs_total": 6, "runs_done": 2, "runs_active": 2, "current_round_max": 31, "rounds_per_run": 48 },
  "runs": [ { "variant": "A", "replicate": 1, "simulation_id": "sim_...", "state": "completed", "rounds_done": 48 } ],
  "error": null
}
```

**`GET /api/experiments/<experiment_id>/results`** → `200` when complete (409 otherwise).
Returns **exactly the TS `ExperimentResults` contract** (`vng-ab-test-agent/lib/stats.ts:44`)
plus a `raw` extension:
```jsonc
{
  "id": "exp_ab12cd34",
  "metric": "positive stance rate",
  "metricType": "binary",
  "primaryUnit": "agents",
  "alpha": 0.05,
  "requiredSampleSizePerVariant": 0,      // filled by the Next.js side from its power analysis
  "plannedDays": 1, "observedDays": 1,
  "variants": [
    { "name": "control",   "visitors": 300, "conversions": 141 },   // variant A: Σ agents, Σ bullish across replicates
    { "name": "treatment", "visitors": 300, "conversions": 172 }
  ],
  "guardrails": [],
  "notes": ["replicate means A: [46%, 48%, 47%]", "replicate means B: [56%, 59%, 57%]"],
  "raw": {
    "per_replicate": [ { "variant": "A", "replicate": 1, "simulation_id": "sim_...", "bullish_pct": 46.0, "agents": 100, "amm_yes_probability": 0.44 } ],
    "per_demographic": { /* passthrough of demographics winner data */ },
    "welch_cli": { /* the harness's own t-test block, for cross-checking */ }
  }
}
```
**Stance→binary mapping rule (the important decision):** each agent's final stance from
`belief-drift` (LLM stance judge) is one Bernoulli observation — `visitors` = total
agents across all replicates of that variant, `conversions` = total bullish. This gives
the two-proportion z-test real n (hundreds), while per-replicate means stay in
`raw`/`notes` for honesty about clustering. Do not invent per-agent data that doesn't exist.

**`GET /api/experiments/list`** → `200` `{ experiments: [{experiment_id, status, created_at, hypothesis}] }` (reads the uploads dir).

### 2.3 Tests (CI-shaped)
- `backend/tests/test_unit_experiments.py` — offline: request validation, state-machine
  transitions on a mocked service, results-mapping math (stance counts → contract JSON,
  hand-computed fixture), openapi drift stays green.
- Extend the drift test prefix map for `/api/experiments`.

### Acceptance criteria
- [ ] `pytest -m "not integration"` green including the new test file; openapi drift test green.
- [ ] Live: `curl -X POST .../api/experiments/ab-test` (with internal key, tiny config: 2 variants × 1 replicate) returns 202; status polls through `running` → `complete`; results JSON validates against the TS shape (field-for-field).
- [ ] CLI `ab_experiment.py --dry-run` still works.

---

# PHASE 3 — Wire the product app to the real engine (vng-ab-test-agent)

### 3.1 Async sim client — rewrite `lib/sim-client.ts`
```ts
export interface ExperimentJob { experimentId: string; status: "preparing"|"running"|"complete"|"failed"; progress?: {...}; }
export interface SimClient {
  createExperiment(input: CreateExperimentInput): Promise<ExperimentJob>;
  getStatus(experimentId: string): Promise<ExperimentJob>;
  getResults(experimentId: string): Promise<ExperimentResults>;
}
```
- `MiroSharkClient` → the three Phase-2 endpoints, sending `x-miroshark-internal-key`
  (env `MIROSHARK_INTERNAL_KEY`, server-side only — never expose to the browser).
- `MockSimClient` → `createExperiment` returns a fake job that "completes" after ~8
  polls, then serves the scenario-appropriate canned dataset from `lib/mock-results.ts`.
  Same interface, so the UI can't tell.
- Selection stays `MIROSHARK_URL`-based; add `?sim=mock` URL override for stage safety.

### 3.2 Server proxy routes (key stays server-side)
- `app/api/experiment/route.ts` — `POST` create (body: hypothesis, variants, scenario),
  `GET ?id=` → status; `GET ?id=&results=1` → results. Thin passthrough to `getSimClient()`.

### 3.3 Kill the keyword parser
- `lib/experiment.ts`: replace `parseHypothesis` keyword matching with LLM structured
  extraction — new `extractHypothesis(text)` in `lib/extract.ts` using AI SDK
  `generateObject` + zod: `{ metric, metricType, unit, direction, baselineGuess, mdeGuess, rationale }`.
  Keyword version stays as the deterministic fallback when no API key / on parse failure
  (label the source in the UI: "extracted by agent" vs "heuristic").
- The extracted brief renders as an **editable form** before the experiment launches —
  the human confirms metric/MDE (this is also the honest answer to "where do baselines
  come from": the operator, seeded by the agent).
- Agent route `app/api/agent/route.ts`: `parse_hypothesis` tool now calls
  `extractHypothesis`; add a `run_experiment` tool that creates the job and a
  `get_experiment_status` tool so the agent can narrate progress.
- Update `eval/agent-consistency.ts` expectations accordingly (extraction is LLM →
  consistency check pins on everything *downstream* of the confirmed brief, which stays
  deterministic).

### Acceptance criteria
- [ ] `npm run build` and `npm run eval` green (stats validation + decisions must stay 100%).
- [ ] With `MIROSHARK_URL` unset: full flow works on mock (create → poll → readout card) — no behavior regression.
- [ ] With MiroShark running locally: launching from the UI creates a real experiment, progress updates, and the readout card shows real numbers with the correct significance test (two-proportion z on the pooled stance data).
- [ ] Hypothesis extraction: 5 test hypotheses (ARPU, retention, crash-rate, conversion, weirdly-worded) each produce a sensible brief; the weird one visibly falls back or asks for confirmation instead of silently guessing.

---

# PHASE 4 — The Agent World (the wow)

**Vision:** hand-drawn minimalist world (grass-textured light canvas, sketchy
characters — the reference is a "point & click" crowd around a TV). The prompt/variant
is the **TV in the middle**; personas are characters scattered around it; they react
live; you click one to interview it. A/B = **split world, same people, two realities**.

**Where:** `vng-ab-test-agent/app/world/page.tsx` becomes the primary demo surface
(link from home; keep the existing card UI as `/classic` for the stats-credibility view).
**Tech:** plain React DOM + absolutely-positioned sprites + CSS transforms/transitions
(≤200 sprites is fine without canvas); `framer-motion` optional — prefer CSS. No heavy
deps. All visuals theme-tokened in one file (`app/world/world.css`).

### 4.1 Data model & drivers — `lib/world/`
- `types.ts`:
```ts
interface WorldAgent { id: string; name: string; avatarSeed: number; demographics: { age?: number; gender?: string; region?: string; occupation?: string }; personaSummary: string; }
interface WorldFrame { round: number; states: Record<string, AgentFrameState>; marketYesProb?: number; }
interface AgentFrameState { stance: "bullish"|"bearish"|"neutral"|"unknown"; post?: { text: string; platform: "threads"|"facebook" }; action?: string; }
interface WorldTimeline { agents: WorldAgent[]; frames: WorldFrame[]; variantLabel: string; injectionText: string; }
```
- `adapters.ts`: build `WorldTimeline` from MiroShark: `GET /api/simulation/<id>/profiles`
  (agents), `/actions` + `/posts` + `/belief-drift` per round (frame states),
  `/polymarket/markets`+prices (marketYesProb). Stance per round from belief-drift's
  per-agent series; when only aggregate exists, distribute by the per-agent final stance
  ramped over rounds (document the approximation in a comment).
- `drivers.ts`: `ReplayDriver` (takes a `WorldTimeline` JSON, emits frames on a timer —
  speed 0.5×–8×, pause, scrub) and `LiveDriver` (polls the Phase-3 proxy every 5s while
  an experiment runs, appends frames). Both expose the same
  `subscribe(onFrame)` interface.
- `export`: `scripts/export-world-timeline.ts` (run with `tsx`) — pulls a completed
  simulation from MiroShark and writes `public/demo/timeline-<variant>.json`. **These
  bundled JSONs are the stage fallback.**

### 4.2 Components — `app/world/components/`
- `WorldCanvas.tsx` — the stage. Light paper/grass background (inline SVG scribbles,
  reference-image style). Agents positioned by deterministic seeded layout
  (`seedrandom(agent.id)` → jittered ring/cluster placement around the TV, min-distance
  enforced). Resize-safe (positions in % of viewport).
- `AgentSprite.tsx` — inline SVG characters, hand-drawn style: 3 body types × simple
  head shapes (match the reference: rectangular/round heads, dot eyes, stick bodies),
  deterministic pick from `avatarSeed`. States: idle sway (CSS keyframes, randomized
  delay), stance tint/expression (bullish = leaning toward TV + small heart/spark;
  bearish = turned away + scribble cloud; neutral = idle), talking (bubble). Movement:
  bullish agents drift a few % closer to the TV over rounds, bearish drift outward —
  `transition: transform 1.2s ease` so it reads as walking. Hover → name + one-line
  persona tooltip. Click → interview.
- `TVBillboard.tsx` — center TV (sketchy CRT with antennas, per the reference) showing
  the variant: text marquee or creative image (Phase 5). Below it, a small live ticker:
  `marketYesProb` as "Market: 58% believe it works" — animates on change.
- `SpeechBubble.tsx` — real post text (Vietnamese!), max ~90 chars + "…", pops with a
  slight scale-in, lives ~4s, at most 6 concurrent bubbles (queue the rest) so the
  screen never soups.
- `PromptDock.tsx` — bottom-center input: hypothesis + variant A/B texts + Launch. On
  launch: brief-confirmation (Phase 3.3 form) → world spawns → experiment starts.
- `InterviewPanel.tsx` — right drawer on sprite click: persona card (name, age, region,
  occupation, bio from profiles) + chat. Backend: new proxy `app/api/interview/route.ts`
  → MiroShark `POST /api/simulation/interview` (body: simulation_id, agent name,
  question). Prefill suggested questions: "Bạn nghĩ gì về quảng cáo này?" / "Why didn't
  this convince you?". Show the transcript; keep history per agent (interview/history
  endpoint exists).
- `VerdictOverlay.tsx` — when the experiment completes: world dims/freezes, the stats
  card drops in center — verdict badge (SHIP/ITERATE/KILL), p-value, CI, effect,
  per-region winner chips. Reuse the readout rendering from the classic page (extract
  shared components into `components/readout/` rather than duplicating).
- `TimeScrubber.tsx` — bottom bar: round slider + play/pause + speed. Drives ReplayDriver.
- `DemographicLens.tsx` — toggle chips (Region / Age / Off): tints sprites by segment
  and shows a mini-legend; per-segment winner appears on the verdict card.

### 4.3 Split-world A/B
`app/world/page.tsx` layout: **one world, vertical center divide** (sketchy fence line),
variant A's TV on the left half, variant B's on the right. The *same* `WorldAgent[]`
(personas come from the shared parent) render mirrored on both halves; each half binds
to its own timeline/driver. Header line: **"Same 100 people. Two realities."** A
sync-scrub lock keeps both halves on the same round.

### 4.4 Modes & safety
- `/world?mode=live&experiment=<id>` — real run.
- `/world?mode=replay&demo=kfc` — bundled JSONs, replays a 48-round experiment in ~60–90s.
  **This is the stage default.** Interview panel in replay mode targets the (still
  extant) completed simulation on the local backend; if backend is down, interview
  gracefully degrades to 3 pre-recorded Q&As per highlighted agent bundled in the JSON.
- Empty/loading states: world renders with silhouette sprites + "preparing audience…"
  while an experiment is in `preparing`.

### Acceptance criteria
- [ ] `npm run build` green; no new heavy deps (bundle for /world < 300KB gz excluding demo JSONs).
- [ ] Replay mode runs the full arc offline: spawn → reactions with real Vietnamese post bubbles → stance drift visible (crowd visibly reorganizes) → verdict overlay with correct stats from `lib/stats.ts`.
- [ ] Split-world shows the same named characters on both halves with different behavior.
- [ ] Click-to-interview returns an in-persona answer live (backend up), and canned Q&A (backend down).
- [ ] 100+ sprites animate at 60fps on a mid laptop (no per-frame React re-render of all sprites — memoize; state updates per changed agent only).
- [ ] It looks like the reference: hand-drawn, monochrome-ish + one accent per variant, zero "dashboard" chrome on the world screen.

---

# PHASE 5 — Variant Studio (creative-intelligence graft)

**Goal:** variants aren't typed by hand — the agent proposes them, optionally with
generated creative. Lift from `vng-creative-intelligence`, don't merge it.

- ~~Copy `gen-adapters.ts` → `lib/creative/gen-adapters.ts` + fallback PNGs → `public/creative/`~~
  **DONE 2026-07-11** (kept its pattern: live Nano Banana when `NANO_BANANA_KEY` present,
  labeled fallback assets otherwise; Meshy/3D skipped as planned).
- New `lib/creative/variants.ts`: `proposeVariants(hypothesis, brief)` — LLM
  (generateObject) returns 2–3 ad-copy variants (Vietnamese, ≤140 chars each, distinct
  angles: price / social / novelty) with a one-line strategy note each.
- New agent tool `propose_variants` in the agent route.
- `PromptDock` flow becomes: hypothesis → brief confirm → **variant cards (editable,
  each with optional generated image)** → pick 2 → launch. Generated image, when
  present, displays on that variant's TV in the world.
- Env: `NANO_BANANA_KEY` optional; everything green without it.

### Acceptance criteria
- [ ] From a single hypothesis, the app proposes 2–3 editable Vietnamese variants with strategy notes; user can launch with zero typing beyond the hypothesis.
- [ ] With no creative key: labeled fallback images appear, nothing errors.
- [ ] `npm run build` + `npm run eval` stay green.

---

# PHASE 6 — Demo hardening & the pitch

- **Pre-bake the hero experiment:** run the Phase-1 validation config once more at full
  size (2 variants × 3 replicates, `DEMOGRAPHICS_COUNTRY=vn`) → export world timelines +
  results JSON into `public/demo/`. Verify the replay end-to-end twice.
- **Record the fallback video** of the replay (screen capture, 90s) → `vng-ab-test-agent/demo/fallback.mp4` (gitignore if >50MB).
- **The 3-minute script** (write as `vng-ab-test-agent/demo/SCRIPT.md`):
  1. Type hypothesis → agent extracts brief + proposes variants (15s).
  2. World spawns: "100 real census-grounded Vietnamese consumers." Split-screen, same
     people, two realities. Crowd reacts, Vietnamese bubbles, market ticker moves (60s).
  3. Click the skeptic who walked away → interview: "why not?" → in-persona answer (30s).
  4. Verdict drops: correct z-test, p-value, CI, per-region winners. Then the trap:
     load the underpowered scenario → agent says **ITERATE, don't ship on noise** (45s).
  5. Credibility slide: stats validated vs scipy to 4dp + `npm run eval` decision score (15s).
- **Eval numbers for the deck:** run `npm run eval`, screenshot; run MiroShark unit suite count.
- **README refresh** for `vng-ab-test-agent` describing the combined system + a
  `docs/ARCHITECTURE.md` one-pager (boxes: Next.js app ↔ experiments API ↔ sim engine).
- **Ops honesty note** in the README: single sim worker per instance, results on local
  disk — pilot-grade, one experiment at a time.

### Acceptance criteria
- [ ] Full dry run works twice in a row from a cold start, on this machine, with a stopwatch under 3:30.
- [ ] Every live element has a rehearsed fallback (replay mode, canned interviews, video).

---

## Suggested execution order & parallelism (tomorrow)

```
Morning:  Phase 1 (validation run bakes in background)  +  Phase 2 in parallel (pure code, testable offline)
Midday:   Phase 3 (needs Phase 2 shape, mock-first so it can start anytime)
Afternoon:Phase 4 (biggest chunk; 4.1/4.2 can start on mock data any time — only adapters.ts needs Phase 2)
Evening:  Phase 5 (small)  →  Phase 6 (must be last)
```
Phases 2+3+4 can run as parallel agents/worktrees if orchestrated — the contracts above
are the interfaces between them; do not drift from them without updating this file.

## Env var summary (new/changed)

| Where | Var | Purpose |
|---|---|---|
| MiroShark `.env` | `DEMOGRAPHICS_COUNTRY=vn` | census personas |
| MiroShark `.env` | `PERSONA_CRITIC_RATIO` (optional, Phase 1.3) | skeptic floor |
| vng-ab-test-agent | `MIROSHARK_URL=http://localhost:5001` | real engine on |
| vng-ab-test-agent | `MIROSHARK_INTERNAL_KEY` | server-side auth to MiroShark |
| vng-ab-test-agent | `NANO_BANANA_KEY` (optional) | live creative gen |
| app root `.env.local` | `MIROSHARK_ADMIN_TOKEN` | publish gate for `signal.json` (must match MiroShark `.env`; set 2026-07-11) |
| app root `.env.local` | `TINYFISH_API_KEY` (optional) | web-scrape context for simulations |
| app root `.env.local` | `MIROSHARK_SCRAPE_ENABLED` | opt-in flag for scrape context |

## Definition of DONE for the whole plan

One command starts MiroShark, one starts the app; typing a hypothesis produces proposed
variants; launching runs a real synthetic experiment OR a replay indistinguishable in
the UI; the world shows the crowd reacting; an interview answers in persona; the verdict
card shows real statistics; `npm run eval` and MiroShark's unit suite are green; and the
whole story survives the WiFi dying.
