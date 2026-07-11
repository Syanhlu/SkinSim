# VNG P5 Creative Intelligence — Max-Out Build-Week Plan

**Date:** 3 July 2026 · **Basis:** deep code audit (every source file read, build + eval executed, PR #11 diff inspected, adversarial probes run) · **Build week:** Jul 8–12 · **Team:** 4–6
**Companion docs:** [`STRATEGY.md`](./STRATEGY.md) (the pitch) · [`README.md`](./README.md) (current state) · [`/report.md`](../report.md) (fleet audit)

---

## 0. Where we actually stand (judge-eye verdict)

| Judge lever | Today | Target EOW | Gap owner |
|---|:---:|:---:|---|
| Live demo wow | **4/10** | 9 | Frontend + glue |
| Business / ROI fit | **6/10** | 9 | ML/data |
| Agentic depth | **3/10** | 8 | Agent lead |
| Data grounding / eval | **4/10** | 8 | ML/data |

**Honest rating today: Solid-minus** (report.md's "Solid+" was generous). The plumbing is disciplined — real history/holdout split, top-1-aligned backtest, no hardcoded UI numbers, honest `source` labels, schema-validated CSV parsing. But the two levers the STRATEGY.md says win this brief (wow + evidence) are unbuilt, and several truthfulness seams open under one probing question.

### The seven findings that drive this plan (with evidence)

1. **A naive D7-ROAS picker recommends the identical theme.** Computed from `data/ads.sample.csv`: history D7 ROAS — neon-mecha 1.27x (best), celestial 1.18x, chibi 0.61x. The dataset has no "high-D7 / low-pLTV trap" theme, so the pLTV-weighting machinery — the brief's entire point — demonstrates **nothing** over naive ROAS on this data. Kill question: *"Would D7 alone pick the same theme?"* Today: yes.
2. **The headline (+61.6% / +85.3%) is a property of the CSV, not the agent.** Holdout rows are noisy clones of history rows per theme; `predicted_ltv_d30` is an authored input (not a model output) and is correlated with the selection signal (HVP share) — selecting on X and scoring X on a correlated split. n=2 selected holdout creatives ($21.1k of $123.1k spend); no CI, no permutation test, no baselines.
3. **The flagship vision fix is dead at runtime.** `lib/vision.ts:140` sends `data:image/svg+xml;base64,…` to `CHEAP_MODEL` (= `anthropic/claude-haiku-4-5`, `lib/ai.ts:13`) — Anthropic accepts only JPEG/PNG/GIF/WebP → the keyed call errors and silently falls back (`vision.ts:72-77`). The dashboard never calls the vision path anyway (`app/page.tsx:9` uses `buildAnalysisSnapshot`, not `buildAnalysisSnapshotWithVision`). And `app/api/agent/route.ts:57` reports `taggingSource: "llm-vision"` merely because a key exists — contradicted by per-creative `source: "metadata"` in the same payload.
4. **The generation "agent" is a fixed chain with a hardcoded trace.** `runGenerationPipeline` (`lib/gen.ts:158-190`) calls gen→sim→pick→3d unconditionally; its `toolLog` entries are all hardcoded `status: "ok"` (`gen.ts:38, 169-188`). `MockSimClient` scores concepts by string hash — `40 + hash(doc) % 55` (`lib/sim-client.ts:43`) — so the highlighted "best skin" is deterministic noise shown as "X/100 simulated reception" (`app/dashboard.tsx:264`) without a mock label on the tile.
5. **Real-integration landmines will detonate the moment keys are added.** MiroShark client timeout 120s (`sim-client.ts:95`) and Meshy poll deadline 90s (`gen-adapters.ts:75`) both exceed the route's `maxDuration = 60` (`app/api/generate/route.ts:4`). Meshy is fed relative `/skins/*.svg` URLs it cannot fetch (`lib/gen.ts:147` ← `:48`). Every failure is `.catch(() => null)` (`gen.ts:103,147`) → silently swapped for mock output. You would demo a placeholder believing the real pipeline ran.
6. **Data plausibility is broken.** `high_value_players > payers` on **all 37 rows** (e.g. cr_001: 610 payers, 1,320 HVP); HVP share of installs ≈ 5–24% vs. real whale rates of 1–2%. The "92% confidence" badges are fabricated arithmetic: `min(92, max(58, round(64 + share*100 + (roas-1)*7)))` (`lib/analysis.ts:288-291`) and `0.72 + metadataFields*0.05` (`:445-448`).
7. **Presentation defects:** a literal blank gray test box mid-dashboard (`app/dashboard.tsx:295`, `app/globals.css:572-578`, merged via PR #13); a hardcoded "Mock services active" pill (`dashboard.tsx:104`) wrong in both directions once keys exist; raw tool-call JSON in `<pre>` blocks (`dashboard.tsx:411-418`); `/` statically prerendered (build output `○ /`) so the snapshot, `agentEnabled`, and the Supabase persist freeze at build time — post-deploy env changes do nothing without a rebuild.

---

## 1. Operating principles for the week

- **The analysis half is the MVP; the gen pipeline is the wow layer** (STRATEGY.md §8). If time runs out, demo analysis rigorously + pre-rendered gen assets. Never the reverse.
- **No silent fallbacks, ever.** Every adapter returns `{ result, source: "live"|"mock", fallbackReason?: string }` and the UI shows it. A fallback the team can't see is a demo we can't trust.
- **Every number a judge sees must trace to a computation we can defend live.** If we can't explain a badge in one sentence, delete the badge.
- **Demo storyboard is written Day 1 morning and everything is built backward from it** (playbook rule).
- **Definition of done for every task includes a verification step** — "wired" ≠ done; *executed and observed* = done.

---

## 2. Phase 0 — Day 1 morning: stop lying to ourselves (~4h, whole team)

| # | Task | Files | How | Done when | Est |
|---|------|-------|-----|-----------|-----|
| 0.1 | **Delete the blank box** | `app/dashboard.tsx:295`, `app/globals.css:572-578` | Remove the `<section className="blankBox">` and its CSS; ask teammate whether PR #13 had a purpose before deleting the branch | Dashboard has no empty panel | 5 min |
| 0.2 | **Set every key and execute every dormant path once** | env | `AI_GATEWAY_API_KEY`, Supabase pair, `MIROSHARK_URL`, `NANO_BANANA_KEY`, `MESHY_KEY`. Run: agent chat turn, vision tagging, one gen-pipeline run, one Supabase persist. Log every failure | A written failure list exists (this is the real Day-1 backlog) | 2h |
| 0.3 | **Make the page dynamic** | `app/page.tsx` | `export const dynamic = "force-dynamic"` (or route-level revalidate 0) so snapshot, `agentEnabled` (`page.tsx:15`), and `persistAnalysisSnapshot` (`page.tsx:13`) run per-request, not once at build | Toggling a key changes the live page without redeploy | 30 min |
| 0.4 | **Honest status pills** | `app/dashboard.tsx:104` + API responses | Replace hardcoded "Mock services active" with per-service live/mock badges derived from actual `source` fields returned by the pipeline | Pill state changes when a key is added/removed; verified both ways | 1.5h |
| 0.5 | **Loud fallbacks** | `lib/gen.ts:103,147`, `lib/vision.ts:72-77`, `lib/sim-client.ts` | Replace every `.catch(() => null)` / silent `console.warn` fallback with a captured `fallbackReason` surfaced in `toolLog` and the UI (small amber "fell back: {reason}" note) | Kill a key mid-run → the UI says so | 1.5h |

**Phase 0 exit criteria:** no dead UI, every service's real/mock state visible on screen, page reflects env at request time, and we hold a complete list of what actually breaks when live.

---

## 3. Phase 1 — Day 1 afternoon → Day 2: make the evidence unattackable (ML/data lead + 1)

This is the credibility spine. The brief's win condition is *"lift in pLTV-weighted ROAS on agent-recommended themes"* — our number must survive a stats-literate judge.

### 1.1 Add the trap theme (the single highest-leverage change in the project) — 3–4h
- **File:** `data/ads.sample.csv` (+ the generator script from 1.3).
- **What:** add a theme (e.g. `hypercasual-candy`) engineered as the *tourist magnet that fools naive UA*: **highest D7 ROAS in the dataset** (cheap installs, quick shallow payers) but **bottom-quartile pLTV** and low HVP share. 3 history + 2 holdout creatives, consistent economics across splits.
- **Why:** with the trap present, a D7-ROAS picker recommends the trap and loses on holdout pLTV-ROAS; our agent doesn't. That's the demo of the brief's entire thesis.
- **Done when:** `recommend_direction` still picks neon-mecha; a D7 picker picks the trap; holdout pLTV-ROAS of trap < portfolio.

### 1.2 Baseline comparators in the eval — 2–3h
- **Files:** `lib/analysis.ts` (new `pickByD7Roas`, `pickByInstalls`, `pickBySpend` selectors over history clusters), `eval/backtest.ts`.
- **What:** extend the printed eval to a table: **our agent vs D7-ROAS picker vs installs picker vs spend picker**, each with its top-1 theme and holdout pLTV-ROAS. Render the same table on the dashboard backtest panel (`app/dashboard.tsx:203-232`).
- **Done when:** `npm run eval` prints e.g. `Agent: neon-mecha 3.10x | D7 picker: hypercasual-candy 1.41x | Installs picker: chibi 1.12x` and the dashboard shows it. This slide is the pitch.

### 1.3 Commit the data generator + fix plausibility — 4–6h
- **Files:** new `data/generate.ts` (npm script `data:gen`), regenerate `data/ads.sample.csv`.
- **What:**
  - Enforce `high_value_players ≤ payers ≤ installs`; HVP share of installs 1–3% (whales), payers 3–8%.
  - Document the metric semantics in a header comment + README (`hvp = predicted top-decile LTV cohort`, etc.).
  - Generate holdout **independently** from theme-level latent parameters + real noise (not by cloning history rows), with a fixed seed committed.
  - Document every assumption (CPM ranges, LTV curves per theme archetype) in the script.
- **Done when:** any judge can run `npm run data:gen` and read exactly how the synthetic world works; no row violates the funnel invariants.

### 1.4 Uncertainty on the headline — 3h
- **Files:** `lib/analysis.ts` (new `bootstrapLift`), `eval/backtest.ts`, `app/dashboard.tsx`.
- **What:** creative-level bootstrap (resample holdout creatives 10k×) → 95% CI on the lift; permutation test (shuffle theme labels) → p-value. Print both; show CI on the dashboard bars.
- **Done when:** headline reads like `+62% (95% CI +18%…+109%, perm p=0.03)` — imperfect and believable beats perfect and toy.

### 1.5 Replace fabricated confidence — 2–3h
- **Files:** `lib/analysis.ts:288-291`, `:445-448`, `app/dashboard.tsx:115,154`.
- **What:** delete the magic formulas. Either (a) show *bootstrap probability the picked theme beats the portfolio on holdout* as "win probability", or (b) remove the % badge entirely. No third option.
- **Done when:** every on-screen % has a one-sentence defensible definition, or doesn't exist.

### 1.6 Fix vision end-to-end — 3–4h
- **Files:** `public/skins/*.svg` → PNG (or rasterize in `loadThumbnail`, `lib/vision.ts:135-142`), `app/page.tsx:9`, `app/api/agent/route.ts:57`.
- **What:**
  - Rasterize all 12 thumbnails to PNG (Claude accepts jpeg/png/gif/webp only). Give the two themes currently sharing `gothic-vampire-01.svg` (cr_008–cr_011) **distinct art** — vision dedupes by thumbnail (`vision.ts:53`) and would otherwise silently merge two themes.
  - Switch the dashboard to `buildAnalysisSnapshotWithVision` (now safe post-0.3 dynamic rendering); keep metadata as the labeled fallback.
  - Fix the over-claim: derive `taggingSource` from the actual per-tag `source` values, not `isVisionEnabled()`.
- **Done when:** with a key, the dashboard pill says "Themes: llm-vision", per-creative sources agree, and one full keyed run is observed in logs. Without a key, everything still green on metadata.

**Phase 1 exit criteria:** the eval slide is `agent vs 3 baselines, trap theme, CI + p-value, generator committed` — and no judge question from the audit's list lands.

---

## 4. Phase 2 — Days 2–3: real agency (agent lead + glue)

### 2.1 Close the loop — one prompt drives analyze → decide → generate → simulate → 3D — 1 day
- **Files:** `app/api/agent/route.ts` (tools list at `:55-91`), `lib/gen.ts:158-190`.
- **What:**
  - Add tools to the analysis agent: `run_generation_pipeline(themeKey)` (wraps `runGenerationPipeline`), `run_backtest()`, and `compare_baselines()` (from 1.2).
  - Raise `stopWhen: stepCountIs(6)` → `stepCountIs(12)` to allow the full chain.
  - **Delete the hardcoded `toolLog`** (`gen.ts:169-188`): record steps as they actually execute, with real statuses and `source`/`fallbackReason` from Phase 0.5. `pick_best` must record *why* (scores compared), not just the winner.
  - System prompt (`route.ts:18`): stop dictating the plan step-by-step; state the goal and let the model sequence tools — the trace is only impressive if the model actually planned it.
  - Have the agent end with a **decision memo** (theme chosen, evidence cited from tool results, risks) rendered as the final chat message.
- **Done when:** typing "Analyze the ad data and produce the next skin line" in the chat produces a genuine multi-step trace ending in a 3D asset, with zero hand-pushed entries. This moves agentic depth 3→8.

### 2.2 Defuse the timeout/URL landmines — 2–3h *(prerequisite for anything live)*
- **Files:** `app/api/generate/route.ts:4`, `lib/gen-adapters.ts:56-88`, `lib/gen.ts:147`.
- **What:** `maxDuration = 300` (Fluid compute allows it) **or** convert `/api/generate` to job-start + client polling (better UX anyway — enables the stepped progress UI in 3.2). Pass Meshy an absolute public URL (deployment origin + path) or a data URL — never a relative path. Align client timeouts under the route budget (MiroShark ≤ 240s, Meshy poll ≤ 240s).
- **Done when:** a keyed Meshy run completes on the deployed Vercel preview, not just localhost.

### 2.3 MiroShark spike + calibration eval — 1 day, parallelizable (glue owner)
- **Files:** `lib/sim-client.ts:85-165`, new `eval/sim-calibration.ts`, `app/dashboard.tsx:264`.
- **What:**
  - Stand up MiroShark per STRATEGY.md §4 (Python 3.11+, Node 18+, Neo4j, OpenRouter — the known day-eater; that's why it's Day 2, not Day 4). Verify the **guessed** endpoint path `/api/simulate` (`sim-client.ts:92` admits it "mirrors" the contract) against the real Swagger at `/api/docs`; fix the `verdict.json` mapping against a real response.
  - Ship the calibration eval STRATEGY.md §5 promised: feed it 5 historically known hit/flop skin concepts, report "ranked N/5 hits above flops" as a second section of `npm run eval`.
  - Until live: label every mock score `[MOCK]` **on the concept tile itself** (`dashboard.tsx:264`), not only in the small summary line.
- **Done when:** one real MiroShark run returns through our client on the deployed app, and the calibration number prints. If the spike fails by EOD Day 2 → fallback decision: demo sim with pre-recorded MiroShark output, clearly labeled, and cut scope here.

### 2.4 Live Nano Banana + reveal choreography — 1 day (frontend + glue)
- **Files:** `lib/gen-adapters.ts:21-50`, `app/dashboard.tsx:240-300, 411-418`.
- **What:**
  - Verify the Gemini image call live; add generation caching (keyed by theme+prompt hash) so dry-runs don't re-spend; pre-generate a full fallback gallery per theme (checked into `public/skins/generated/`).
  - Replace raw-JSON `<pre>` tool dumps with a **stepped timeline** ("① Joining pLTV… ✓ ② Tagging themes (llm-vision)… ✓ ③ Generating 4 concepts…"), each step live-updating from the real trace.
  - The 3D reveal: on `to_3d` completion, auto-rotate the new GLB in `<model-viewer>` with a beat of stagecraft (brief pause, then load). This is the wow moment; treat it as choreography, not plumbing.
- **Done when:** the full keyed pipeline runs on stage-quality UI in < 90s with cached/pre-generated fallback one click away.

---

## 5. Phase 3 — Day 4: bring-your-own-data + hardening

| # | Task | Files | What | Done when | Est |
|---|------|-------|------|-----------|-----|
| 3.1 | **CSV upload** | new `app/api/upload/route.ts`, `app/page.tsx`, reuse validator `lib/analysis.ts:127-162` + parser `:450-481` | Judge drops in their own ad export; full dashboard recomputes client-side or per-request. Turns "synthetic demo" into "bring your data" — the strongest possible answer to "but it's synthetic" | A foreign CSV with the right schema renders the full analysis; a wrong one gets a readable validation error | 0.5–1 day |
| 3.2 | **Progress-job UX** (if 2.2 chose polling) | `/api/generate` | Job id + `GET /api/generate/:id` status; frontend polls and animates the timeline | Refresh mid-run doesn't lose the pipeline state | included in 2.2/2.4 |
| 3.3 | **Supabase persistence that actually persists** | `lib/supabase.ts:41-63`, `app/page.tsx:13` | Post-0.3 it runs per-request; add a "past runs" drawer reading snapshots back — memory across sessions, demoable | Two visits show run history | 3h |
| 3.4 | **Fallback rehearsal** | — | Record the entire keyed pipeline (screen capture); pre-generate all gen assets; write the "wifi died" script | A full demo can run with zero network | 2h |
| 3.5 | **Adversary hour** | — | One teammate plays hostile judge with the kill-question list (§7); every landed question becomes a fix or a scripted answer | No question in §7 lands unanswered | 1h/day from Day 3 |

---

## 6. Phase 4 — Day 5: deck + dry runs

- **Deck order (backward from the strongest evidence):**
  1. The problem: UA sees spend, not player value.
  2. **The baseline table** — "naive D7 ROAS picks the trap theme and loses; our agent picks neon-mecha and lifts holdout pLTV-ROAS +X% (CI, p)." *(This is the winning slide.)*
  3. Live demo: one prompt → analyze → decide → generate → simulate → 3D (Phase 2.1 loop).
  4. Sim calibration: "ranked N/5 known hits above flops — a plausibility ranker, not ground truth" (honesty as a feature).
  5. Integration: adapters into ad exports / MiroShark / gen APIs; bring-your-own-CSV.
- **≥5 dry runs**, at least 2 on the deployed Vercel URL, at least 1 fully offline on fallbacks.
- README refresh: methodology, generator assumptions, env matrix, honest limitations section.

---

## 7. The kill-question list (rehearse until every answer is one sentence)

| Judge question | Today's answer | EOW answer |
|---|---|---|
| "Would D7 ROAS alone pick the same theme?" | Yes (fatal) | "No — here's the baseline table; D7 picks the trap theme and loses 54% of holdout pLTV-ROAS." |
| "What does 92% confidence mean?" | A magic formula (fatal) | "Bootstrap win probability vs the portfolio; here's the resampling." |
| "Who made this data?" | We did, undocumented | "Synthetic, generator committed with documented assumptions + seed; and here — upload your own export." |
| "Is that reception score real?" | Hash of the string (fatal) | "Live MiroShark, calibrated N/5 on known outcomes; labeled MOCK when the sim is off." |
| "Is the vision tagging actually running?" | No, and the payload lies | "Yes — pill says llm-vision, per-creative sources agree, kill the key and watch it fall back loudly." |
| "What's that gray box?" | (fatal) | Doesn't exist. |
| "Show me the agent deciding something." | Fixed chain, hardcoded 'ok' trace | One prompt → 10-step real trace → decision memo → 3D asset. |

---

## 8. Roles & schedule grid

| | Day 1 | Day 2 | Day 3 | Day 4 | Day 5 |
|---|---|---|---|---|---|
| **ML/data** | Phase 0 → 1.1 trap theme | 1.2 baselines, 1.3 generator | 1.4 CI/p-value, 1.5 confidence | 3.1 CSV upload | deck evidence slides |
| **Agent lead** | Phase 0 → 1.6 vision | 2.1 closed loop | 2.1 finish + decision memo | 3.3 persistence, adversary | dry runs |
| **Glue** | 0.2 key matrix | 2.3 MiroShark spike | 2.3 calibration eval | 3.4 fallback recordings | dry runs |
| **Frontend** | 0.1/0.4/0.5 pills+fallbacks | 2.2 timeouts/jobs | 2.4 timeline + reveal | polish, 3.2 | demo choreography |
| **Designer/5th** | storyboard (Day 1 AM) | deck skeleton | tile/labeling pass | deck + rehearsal | run of show |

**Scope-cut order if behind (cut from the bottom):** 3.1 CSV upload → 2.3 live MiroShark (keep calibration on recorded output) → 2.4 live Meshy (pre-rendered GLBs) → never cut Phase 1.

---

## 9. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| MiroShark install eats > 1 day | High (Neo4j + OpenRouter, fork) | Timeboxed Day-2 spike; pre-recorded output fallback; HTTP-API mode before local launcher |
| Gen APIs slow/flaky on stage | High | Cache + pre-generated gallery + full screen recording; live call is never the single point of failure |
| Vercel timeout mid-demo | Medium (post-2.2 low) | maxDuration 300 / job polling; rehearse on the deployed URL, not localhost |
| Trap theme makes agent pick wrong | Low | Tune generator params; the agent *should* win by construction of honest economics, verify in 1.1 |
| Vision relabels themes → clusters shift → backtest changes | Medium | All-or-nothing label space already enforced (`vision.ts`); re-run eval after 1.6 and freeze thumbnails |
| Statically cached page shows stale data | Closed by 0.3 | — |

---

*Everything above cites current line numbers as of commit `4fa0c33`; re-verify anchors after each merge.*
