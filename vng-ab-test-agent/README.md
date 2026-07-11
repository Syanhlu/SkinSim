# VNG P11 — A/B Test Design & Readout Agent

**Partner:** VNG Games · **Track:** Gaming (Bucket 3 — LiveOps) · **Category:** Consumer AI
**URL:** https://aitalent.genaifund.ai/tracks/gaming/ab-test-agent
**Biggest lever for us:** **Agentic depth + data grounding** — the value is a *statistically correct* decision, made
autonomously end-to-end. Win by making the stats rigorous and the ship/iterate/kill call trustworthy.

---

## 1. The brief (condensed)

Experiment design + interpretation are inconsistent → teams ship on gut or stall on ambiguous results. Build an agent
that **proposes a test design from a hypothesis** (metric, sample size, duration), then on completion **checks
significance, summarizes the winner, and recommends ship / iterate / kill.**

- **Inputs:** experiment hypothesis; historical baseline metrics; experiment result data.
- **Win condition:** **% of experiments closed with a statistically-sound decision; cycle time per test.**
- **Build direction:** propose test design from a hypothesis → later read results → ship/iterate/kill.

## 2. Our original notes

- Make an agent with a good `.md` spec, use Claude tools → **Mirofish to simulate** the experiment → agent interprets results.

> **Resolved:** "Mirofish" = the real swarm-sim engine **[MiroShark](https://github.com/aaronjmars/MiroShark)** (see
> §4) — here it's a **demo-data generator**, not the source of statistical truth.

**Refinement:** the honest risk here is this reads as "a prompt with a system message." To *win* rather than merely
work, the differentiator must be **real statistics as tools** (power analysis, significance testing) — not the LLM
doing math in its head. MiroShark becomes the way you **generate a live experiment to read out on stage**.

## 3. The winning insight

LLMs are unreliable at statistics; judges (and LiveOps folks) know this. The winning version **never lets the model
compute the stats** — it makes the model an **orchestrator that calls real statistical tools** and *explains* them.
So the moat is trust: **"agentic convenience with a biostatistician's rigor."** Correct power analysis up front,
correct significance test at readout, and a decision rule that's transparent — that's what closes experiments
"statistically soundly," the literal win condition.

## 4. Agentic architecture

```
Hypothesis (NL)  +  historical baselines
   │
   ▼
Experiment agent (Claude Opus 4.8)  —  orchestrates real stats tools, never does math itself
   ├─ tool: parse_hypothesis(text)          → {metric, unit, direction, MDE guess}
   ├─ tool: power_analysis(baseline, MDE, α, power) → required sample size + duration  (real formula, not LLM math)
   ├─ tool: design_test()                    → variants, allocation, guardrail metrics, stop conditions
   │   ── experiment runs (or MiroShark simulates a cohort of players to generate result data) ──
   ├─ tool: significance_test(results)       → correct test (t/z/χ²/Mann-Whitney) + p-value + CI + effect size
   ├─ tool: check_guardrails(results)        → did retention/spend/crash regress?
   └─ tool: recommend(decision)              → ship / iterate / kill + plain-language rationale + caveats
   │
   ▼
Test brief (before) and Readout report (after): metric, n, duration, p/CI/effect, guardrails, decision
```

- **Stats live in code, not the prompt.** `power_analysis` and `significance_test` are deterministic functions
  (scipy/statsmodels). The LLM chooses *which* test fits the metric type and *narrates* the result — it does not
  compute it. This is the credibility spine and the anti-"thin wrapper" defense.
- **Test-type selection** — the agent reasons about metric type (binary conversion vs. continuous ARPU vs. skewed
  retention) and picks the right test + whether a non-parametric one is safer. Show this reasoning.
- **MiroShark** ([aaronjmars/MiroShark](https://github.com/aaronjmars/MiroShark)) — a real swarm-sim engine we use as
  a **live experiment generator**: describe the variant (e.g. "red Buy button"), it simulates a cohort of grounded
  personas reacting, and we derive plausible per-variant conversion data to feed the readout — so we can show a full
  design→run→readout cycle on stage without waiting days. Run locally via `./miroshark` (Neo4j + OpenRouter, ~$1/<10
  min) or its HTTP API. **Frame it as a demo-data generator, not evidence the method is correct** — the *stats tools*
  are validated independently on real numbers (see §5).

## 5. Data grounding & eval

- **Validate the stats tools independently** (this is the evidence): run them on textbook/known datasets and show they
  return the correct sample size, p-value, and CI. "Our significance tool matches statsmodels/textbook to 4 dp."
  That single slide converts "LLM guessing" into "trustworthy instrument."
- **Decision-quality eval:** feed the agent a set of past experiments with *known* correct outcomes → **% it closes
  with the statistically-sound call** (the win condition). Plus a couple of **traps** (underpowered test, novelty
  effect, peeking) to show it *refuses* to over-conclude — refusing a bad call is a win here.
- **Cycle-time story:** contrast "designer sets this up manually in ~a day" vs. "agent produces a rigorous brief in
  ~30s" — the second win-condition metric.

## 6. The killer demo (3 minutes)

1. Type a hypothesis: *"A red 'Buy' button lifts conversion."* → agent returns a **test brief**: metric, **required
   n + duration from real power analysis**, variants, guardrails. *(rigor, instantly)*
2. MiroShark "runs" the experiment → a cohort reacts, results stream in.
3. Agent runs the **correct significance test**, shows **p-value + CI + effect size**, checks guardrails, and calls
   **SHIP** with a plain-language why. Then feed an **underpowered/ambiguous** case → it calls **ITERATE, don't ship
   on noise.** **That refusal is the wow** — it shows judgment, not hype.
4. Cut to the **stats-validation slide** + the decision-quality number.

**Fallbacks:** pre-generate result sets; the stats tools are deterministic so they never surprise you; record the run.

## 7. 5-day plan (4–6 team)

- **D1** — implement + unit-test `power_analysis` and `significance_test` against known values (do this first — it's
  the moat); storyboard; define the decision rule.
- **D2** — agent loop: parse_hypothesis → design_test → test brief renders; test-type selection reasoning.
- **D3** — readout path: significance + guardrails + recommend; wire the MiroShark result generator (spike its
  Neo4j+OpenRouter setup early); the trap cases.
- **D4** — UI (test brief + readout report cards); decision-quality eval number; record fallbacks.
- **D5** — deck (lead with stats-validation + decision-quality), README, 5 dry-runs.

**Roles:** the stats/ML seat is critical (owns the tools + validation); agent lead (orchestration + test selection);
frontend (brief/readout cards); designer (deck); glue (MiroShark generator + data plumbing).

## 8. Risks & mitigations

- **"It's just a wrapper" perception** → hard-counter by putting *real* stats in tools and *showing the validation
  slide*; make the model's job visibly "choose + narrate," not "compute."
- **LLM doing stats itself** → forbidden by design; all numbers come from deterministic tools; assert this on stage.
- **MiroShark being mistaken for evidence** → label it a demo-data generator; validate the stats method on real
  datasets; install it as a Day-1 spike with the HTTP API as fallback.
- **Lower visual spectacle than P5** → win on *judgment*: the "refuse to ship on noise" moment is more memorable than
  another chart; lean into it.

## 9. Scorecard

| Judge lever | How we hit it |
|---|---|
| Live demo wow | The **"iterate, don't ship on noise"** refusal — visible statistical judgment, not hype |
| Business/ROI fit | Both win-condition metrics: **% sound decisions** + **cycle-time** cut from ~a day to seconds |
| Agentic depth | Orchestrates real stats tools, selects the correct test, narrates + decides — end-to-end |
| Data grounding | Stats tools validated against known values + decision-quality eval incl. trap cases |

**Verdict:** the **lowest-scope, most-achievable** VNG option and hard to get *wrong* if the stats are real — but the
lowest wow ceiling. It wins on **trustworthiness and polish**, not spectacle. Strong "safe VNG" pick; pair it with a
crisp demo and the stats-validation slide and it punches above its weight.

---

## Improvement Plan — resolved (post-audit · 2026-07-03)
See [`/report.md`](../report.md). Every audit gap below is now fixed; `npm run eval` validates the
stats against **scipy / statsmodels** to tight tolerances (see the reference-value note in
`eval/stats.test.ts`).

1. **Real Welch t-test** — `welchTTest` now uses the Student t-distribution (t CDF via the
   regularized incomplete beta function) with **Welch–Satterthwaite df** for *both* the p-value and
   the CI margin. Validated against `scipy.stats.ttest_ind_from_stats(equal_var=False)` for a
   large-n **and** a small-n (n=12/15) case.
2. **Real χ² test** — `chiSquareTest` computes a genuine 2×2 Pearson chi-square statistic on the
   **chi-square distribution** (df=1, CDF via the regularized incomplete gamma function). Count/crash
   mocks now carry real `events` + `exposure` (crashes / sessions), not recycled conversions.
   Validated against `scipy.stats.chi2_contingency(correction=False)`.
3. **Continuous formatting** — `page.tsx` formats ARPU effect/CI/baseline/MDE as **currency**
   (picked off `metricType`), not percentage points. A real continuous power analysis
   (`continuousPowerAnalysis`) was added — the proportion formula previously threw for a dollar
   baseline.
4. **Guardrail → decision consistency** — a failing `watch`-severity guardrail now forces at least
   `iterate`; a failing `critical` one forces `kill`. The card's "Needs action" state can no longer
   disagree with a `ship` decision.
5. **Agent visibility** — the readout card is labelled the *deterministic stats engine (source of
   truth)*; the agent stream narrates the same tools. A new guard
   (`eval/agent-consistency.ts`) asserts the agent's tool chain and `evaluateExperiment()` produce
   **identical** numbers across every metric type × scenario — enforcing "the LLM never computes stats".
6. **Stronger eval** — added small-sample Welch, non-parametric Mann-Whitney (with ties, matching
   `scipy.stats.mannwhitneyu` asymptotic + continuity correction), and 2×2 chi-square cases, plus
   continuous/count decision cases; tolerances tightened from the loose values that hid the old
   mislabeled tests.
7. **One source of statistical truth** — the orphaned `api/*.py` and unread `STATS_URL` were deleted;
   `lib/stats.ts` is the single deterministic implementation.
8. **Dead artifacts removed** — `eval/cases.jsonl`, `lib/supabase.ts` (`supabaseAdmin`), the
   `@supabase/supabase-js` dependency, and `CHEAP_MODEL` are gone; the v5/v6 doc mismatch is fixed
   (the package is `ai@5`).
