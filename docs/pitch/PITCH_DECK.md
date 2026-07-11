# VNG SkinSim — Pitch Deck (Full Draft)

> Draft for AABW pitch day, **2026-07-12, 10:15**. Built from the Judge's Re-audit (2026-07-11
> night, KILL-verdict narrative) and VNG-specific research on how VNG's own games handle skin
> production and player feedback today. Timing budget: ~5:00 for 9 core slides. Appendix is
> Q&A backup, untimed.

---

## Internal briefing — not shown on stage

**Where we stand:** AABW re-audit scored KFC "Chirpy" 7.40 weighted vs. VNG "SkinSim" 7.00.
VNG **wins** Creativity (9 vs 6) and ties Fit/Execution (8/8), but loses on Impact (5 vs 6) and
loses badly on Demo clarity (4 vs 7). **This deck's only job is to fix Demo without touching the
other five scores** — do not try to inflate Impact by overclaiming; the judge will catch it.

**Non-negotiable fixes before this deck goes on stage** (from the report, carried over from the
outline — confirm each is closed before 10:15):
1. `demo/SCRIPT.md` must match the bundled data: verdict is **KILL**, not SHIP; **29** agents,
   not 100; ticker is empty, don't reference it.
2. Decide the agent-chat surface — `/api/agent` 503s without `AI_GATEWAY_API_KEY`. Either
   restore the key or demo replay-only; don't discover it live.
3. `demo/fallback.mp4` must exist and work offline — it's referenced but wasn't recorded as of
   the audit.
4. Cut "reacting in Vietnamese" from narration (~94% of bundled posts are English). Add a root
   `LICENSE` + upstream MiroShark attribution to the README before Q&A.

If all four aren't closed, treat that as the top priority over rehearsing slide delivery.

---

## Core deck (timed, ~5:00)

### Slide 1 — Title / Hook — 0:10

**ON SLIDE:**
> **SkinSim**
> VNG Creative Intelligence

**SAY:**
> "What if the agent could kill your losing ad before you spent a single dollar running it?"

(Team name / track — fill in before printing.)

---

### Slide 2 — The problem — 0:30

**ON SLIDE:**
- Real focus groups: weeks of lead time, real money, small samples — results land *after* the
  campaign decision is already made.
- Marketers ship on gut feel because proper testing doesn't fit the timeline or the budget,
  especially for fast-moving Vietnamese social creative.

**SAY (use the VNG-specific proof point, not just the generic industry claim):**
> "This isn't hypothetical — it's happening inside VNG right now. VNG's own player-experience
> survey, live today at `event.vnggames.com`, asks players to log into a Zing/Facebook/Gmail
> account, rate things like character and skin appeal across a multi-step form, and wait for a
> gift-code payout before VNG sees a single number back. That's the fast case. And even Riot's
> global skin team — one of the best-resourced cosmetic design orgs in the industry, running the
> VALORANT skins VNG publishes here — still runs pre-production player surveys and closed-beta
> rounds that take weeks before a skin's theme gets locked. If Riot needs weeks, a VNG marketing
> team shipping social creative on a daily cadence doesn't stand a chance of testing before it
> ships."

---

### Slide 3 — What we built — 0:45

**ON SLIDE:**
- **Counterfactual worlds** — the same crowd of census-grounded Vietnamese personas (NVIDIA
  Vietnam persona dataset) branched into two realities. Variant A and Variant B see different
  ads; everything else held constant.
- A **statistician agent** — 9-tool, 16-step loop — constitutionally barred from computing its
  own numbers. Every stat it reports came from a real, scipy-validated tool call, not the LLM
  "eyeballing it."

**SAY:**
> Judge's line to echo: *"most original idea on either team at this event."*

---

### Slide 4 — Live demo beat — the KFC scenario run — 1:00 (centerpiece)

**ON SLIDE (show the real run on screen):**
- 29 personas
- Variant A → **8/29 positive**
- Variant B → **2/29 positive**
- Verdict: **KILL** (Variant B)

**SAY:**
> "The agent just stopped us from shipping the losing ad."

This is the honest story the current data actually supports — stronger than a scripted SHIP
would have been, because the audience watches the agent make a real call, not read a canned
result.

---

### Slide 5 — Why you can trust the numbers — 0:30

**ON SLIDE:**
- Hand-rolled z / Welch / χ² / Mann-Whitney statistics validated **20/20** against scipy and
  statsmodels.
- **1,470 + 51** offline tests, all green.
- A dedicated eval (`agent-consistency.ts`, **18/18**) mechanically proves the LLM never touches
  a calculation itself.

**SAY:**
> "Honest by construction, not by prompt."

---

### Slide 6 — Built vs. borrowed — own the split — 0:25

**ON SLIDE:**
- Simulation engine: upstream open-source (MiroShark, AGPL, attributed).
- Team's delta: **~1,200-line Vietnam layer** (persona config, full `vi` locale, FB/Threads/TikTok
  platforms) + a **1,660-line experiment-orchestration service** + **~5,000 lines** of
  statistician agent, stats engine, and world UI at root.

**SAY:**
> Say this before they ask — it takes the question off the table.

---

### Slide 7 — Where this is honest about its limits — 0:20

**ON SLIDE:**
- Today's real-data run: **n=2** completed replicates for A, **n=1** for B — self-labelled
  **directional, not confirmatory**.
- Position as **pre-test triage**: kill the obviously-losing creative for $1 before commissioning
  a real focus group — not a replacement for one yet.

**SAY:**
> "Next step: calibrate against a historical VNG campaign with a known outcome. VNG already has
> that data — a past VALORANT VN skin launch or a Miracle Nikki outfit drop with real sales
> numbers would be a real calibration set, not a hypothetical one."

---

### Slide 8 — Impact / the ask — 0:30

**ON SLIDE:**
- **$1 and 10 minutes** vs. weeks and real budget for a traditional focus group.
- **The ask:** a pilot inside a VNG marketing or growth team — specifically, run SkinSim
  *upstream* of VNG's existing player-survey infrastructure. VNG already collects skin/character
  appeal ratings through `event.vnggames.com`; SkinSim's job is to kill the losing creative
  *before* it ever reaches that survey, not to replace the survey itself.

**SAY:**
> Keep this concrete — "give us a pilot team and access to one historical campaign's outcome
> data" is a specific, answerable ask, not an open-ended one.

---

### Slide 9 — Close — 0:10

**ON SLIDE:**
> A scipy-validated statistical core and a genuinely novel synthetic-A/B primitive — an agent
> that decides, not just describes.

---

## Appendix (Q&A backup — not in the 5:00 clock)

### A1. Architecture
- Agent loop diagram: 9 tools, 16-step statistician loop, tool-call log UI.
- Counterfactual branch diagram: one crowd → two realities → paired outcomes.

### A2. Statistics validation
- Table: our implementation vs. scipy/statsmodels, 20/20 match, test-by-test.
- Known limitation, said before asked: `computeWorldVerdict` runs an independent two-proportion
  z-test where a paired test (McNemar) belongs, since it's the *same* crowd in both realities;
  pooling agents across replicates also ignores within-simulation correlation. Documented in
  code; raw replicate-level output is preserved for reanalysis.

### A3. Built vs. forked, in detail
- Full attribution: upstream MiroShark AGPL engine + persona sampler + base agent loop.
- Root LICENSE + attribution added before doors open (per report's must-fix list — confirm done).

### A4. Hardest Q&A, pre-written answers
1. **"Why should I believe 29 simulated personas predict real Vietnamese consumers?"**
   → Can't prove it yet. Personas are census-grounded, behavior is LLM-driven, phase-1 report
   labels results directional. Position as pre-test triage; calibration against a historical VNG
   campaign is the stated next step.
2. **"Same crowd in two realities — why an unpaired test?"**
   → Correct catch. `computeWorldVerdict` should run McNemar, not an independent two-proportion
   z; pooling ignores within-sim correlation. Known and documented; replicate means preserved in
   raw output for reanalysis.
3. **"How much did you build vs. fork?"**
   → Engine is upstream AGPL MiroShark (license preserved). We built the Vietnam layer, the
   experiment-orchestration service, and the entire statistician agent/stats engine/world UI.
   (See A3 for line counts — memorize the split.)

### A5. VNG home-turf evidence (backup, if a judge asks "why does this matter to VNG specifically")
- **VNG's own feedback loop today is the slow pattern we're targeting.** The live
  `event.vnggames.com` player survey gates completion behind account login and pays out a
  redeemable gift code — a real, current example of "incentivized, login-gated, event-driven"
  feedback rather than continuous testing.
- **Even VNG's best-resourced published title runs a heavyweight process.** VNG's VALORANT
  portal documents Riot's global skin pipeline: a "High Quality Content" team surveys players on
  themes, works through five framing questions per skin, prototypes under strict readability
  constraints, then routes through a design-testing team that reviews twice daily. That's the
  gold-standard version of the process SkinSim is compressing to $1 / 10 minutes.
- **VNG's in-house titles (Dead Target, Gunny) don't publish a comparable methodology at all** —
  a real transparency gap that's either a risk to flag honestly if asked, or an opening to pitch
  SkinSim into directly.
- **Community co-creation already happens, just slowly.** Miracle Nikki ("Ngôi Sao Thời Trang
  VNG," VNG's localized dress-up RPG) runs offline meetups (1,000+ attendees) and
  player-designed-outfit contests for anniversaries — proof VNG values player creative input, just
  through slow, event-driven channels rather than a fast pre-launch test.

---

## Must-fix before this deck can go on stage (from the report, carried over — verify closed)
1. Reconcile `demo/SCRIPT.md` with the bundled data — this deck already assumes that fix
   (KILL/29/no-ticker); the on-screen demo needs to match.
2. Decide the agent-chat surface — `/api/agent` 503s without `AI_GATEWAY_API_KEY`. Either
   restore the key or demo replay-only; don't discover it live.
3. Record `demo/fallback.mp4` in case the live replay breaks.
4. Drop "reacting in Vietnamese" from narration (~94% of bundled posts are English); add root
   LICENSE + upstream attribution to the README before Q&A.
