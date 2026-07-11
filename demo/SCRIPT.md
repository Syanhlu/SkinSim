# SkinSim — 3-Minute Stage Script

Target runtime **2:45** spoken (leaves 15s buffer; hard cap 3:30 in rehearsal).
Read the **bold lines** aloud; *(italics = what you do on screen while talking)*.

> Status note (2026-07-11): the pre-baked hero experiment JSONs (`public/demo/`) and the
> fallback video (`demo/fallback.mp4`) are **deferred pending a paid validation run** —
> rehearse beats 2–4 in replay mode only after that run lands. Everything else below is live.

---

## Beat 1 — Hypothesis in, brief + variants out (0:00–0:15)

*(Home page. Type the hypothesis into the prompt dock and hit Enter.)*

> **"This is SkinSim. I type one sentence — 'A cheaper combo promo will lift KFC app
> orders among students' — and the agent does the rest: it extracts a testable brief,
> runs a real power analysis, and proposes three Vietnamese ad variants — price angle,
> social angle, novelty angle. I didn't write any of this copy. I just pick two."**

*(Confirm the brief form; select variants A and B; hit Launch.)*

## Beat 2 — The world: same people, two realities (0:15–1:15)

*(The world spawns: split screen, TV on each half, crowd gathering. Let it breathe.)*

> **"Now watch. These are 100 synthetic Vietnamese consumers — grounded in real census
> data: names, regions, ages, occupations from the Nemotron Vietnam persona pack. Not
> random bots — students in Đà Nẵng, office workers in Hà Nội, skeptical food reviewers."**

> **"And here's the trick: it's the *same* 100 people on both sides. Left half sees
> variant A, right half sees variant B. Two realities, one audience — a perfectly
> controlled experiment you could never run in the real world."**

*(Point at speech bubbles and the market ticker as they move.)*

> **"They're reacting in Vietnamese, in real time — posting on a simulated Threads and
> Facebook, and betting in a prediction market. That ticker is the market's live belief
> that the campaign works. Watch the crowd reorganize — believers drift toward the TV,
> skeptics walk away."**

## Beat 3 — Interview the skeptic (1:15–1:45)

*(Click a sprite that turned away from the TV. Interview drawer opens.)*

> **"This is my favorite part. This person walked away — so let's ask why."**

*(Click the prefilled question: "Why didn't this convince you?" Read the answer aloud,
or paraphrase: )*

> **"She's a price-sensitive student — she says buy-one-get-one is useless because she
> eats alone on weekdays. You don't get *that* from a dashboard. Every data point here
> can explain itself."**

## Beat 4 — The verdict, and the refusal (1:45–2:30)

*(Experiment completes; verdict overlay drops in.)*

> **"The experiment closes and the stats engine takes over. And I mean a real engine —
> a two-proportion z-test on the pooled stance data. p-value, confidence interval, effect
> size, per-region winners. The language model never computes a single number — it only
> chooses the test and narrates. Verdict: SHIP variant B."**

*(Load the underpowered trap scenario.)*

> **"But here's what makes this trustworthy. I feed it an underpowered, noisy result —
> and it refuses. ITERATE: 'don't ship on noise, you need 3x this sample.' An agent that
> knows when *not* to conclude is the whole product."**

## Beat 5 — Credibility close (2:30–2:45)

*(Cut to the eval slide / terminal with `npm run eval` output.)*

> **"Every statistical tool is validated against scipy and statsmodels to four decimal
> places, and our decision eval closes 100% of known-outcome experiments with the
> statistically sound call. From hypothesis to a rigorous, explainable decision — in
> ninety seconds instead of two weeks. That's SkinSim."**

---

## Pre-flight checklist (run T-30 minutes before stage)

1. **Start Neo4j:** `cd MiroShark && docker compose up -d neo4j`
2. **Start MiroShark backend:** `cd MiroShark/backend && ~/mirovenv/Scripts/python run.py`
   (venv must be at `~/mirovenv` — the OneDrive path breaks torch).
3. **Start the app:** `npm run dev` from repo root (or `npm run dev:miroshark` to do 2+3 together).
4. **Env sanity:** `.env.local` has `MIROSHARK_URL`, `MIROSHARK_INTERNAL_KEY`,
   `AI_GATEWAY_API_KEY`; MiroShark `.env` has `DEMOGRAPHICS_COUNTRY=vn`.
5. **Warm the replay:** open `http://localhost:3000/world?mode=replay&demo=kfc` once,
   end-to-end, and leave the tab open. *(Blocked until the pre-baked run lands — see note above.)*
6. **Warm the live path (optional):** `npm run smoke:miroshark -- --max-rounds 1`.
7. **Backup tabs open before walking on stage:**
   - Tab 1: `/world?mode=replay&demo=kfc` (stage default — never demo live unless rehearsed that day)
   - Tab 2: `/?classic` — the stats-credibility card view
   - Tab 3: `demo/fallback.mp4` in a video player, paused at 0:00 *(deferred — record after the paid run)*
   - Terminal: `npm run eval` already run, output visible for Beat 5.
8. **Phone hotspot ready** in case venue WiFi dies (only the LLM narration needs internet;
   replay + stats are fully offline).

### Fallback switches

| Switch | How |
|---|---|
| Force mock sim (no MiroShark) | append `?sim=mock` to the URL |
| Replay mode (stage default) | `/world?mode=replay&demo=kfc` — bundled timeline JSONs, no backend |
| Canned interviews | replay mode auto-degrades to 3 pre-recorded Q&As per highlighted agent when the backend is down |
| Video of everything | `demo/fallback.mp4` (90s screen capture of the replay) |

## If X breaks, do Y

| X breaks | Y do this |
|---|---|
| MiroShark backend won't start / errors mid-demo | Stay in replay mode (`?mode=replay&demo=kfc`) — identical visuals, bundled data. Say nothing; it's indistinguishable. |
| Interview returns an error or hangs >5s | Click a **highlighted** agent instead — those carry canned Q&As that work offline. |
| LLM/agent narration fails (no gateway, quota) | The brief falls back to the heuristic parser and variants fall back to hand-written Vietnamese copy — both are labeled but fully functional. Keep going. |
| World page won't render at all | Switch to Tab 2 (`/?classic`): run the same story on the readout cards — the stats are the moat anyway. |
| The whole app is down | Play `demo/fallback.mp4` (Tab 3) and narrate over it with this script — timings match. |
| Projector/resolution mangles the world layout | Zoom browser to 80% (Ctrl+minus); sprite positions are % -based and reflow safely. |
| `npm run eval` terminal lost for Beat 5 | Use the screenshot in the deck (same numbers). |
