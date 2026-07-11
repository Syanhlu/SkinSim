# VNG A/B Testing — What We Have (plain-English version)

> The combined MiroShark + `vng-ab-test-agent` product, explained without jargon.
> Think of it as three things that together make a **focus group machine**.

## 1. A fake little society you can spin up on demand (MiroShark)

You give it a topic — say, *"KFC launches a new spicy chicken deal in Vietnam"* — and it
creates around a hundred fake people. These aren't random bots: they're based on real
Vietnamese census data, so you get a believable mix — a 24-year-old office worker in
Ho Chi Minh City, a price-conscious mom in Hanoi, a food blogger, a skeptic. Each one
has a personality, a backstory, and opinions.

Then it puts them in a simulated internet: a fake Facebook, a fake Threads, and even a
fake betting market where they wager on outcomes. For about **$1–2 and 10–20 minutes**,
they post, argue, share, and react to your topic — hour by hour — and at the end it
writes you a report on what happened and why.

Extra tricks it already has:

- **Time travel / parallel universes.** Take the *same* crowd and re-run history with one
  thing changed — "what if the ad said this instead?" Same people, two realities. This is
  the magic that makes A/B testing possible.
- **Interviews.** Pick any individual fake person and ask them questions — *"why didn't
  this ad convince you?"* — and they answer in character.
- **Replays.** Every run can be replayed step by step, or exported as a shareable
  GIF/image.

## 2. A statistician that keeps everyone honest (the A/B test agent)

The second app. You type a hypothesis in plain English — *"a red Buy button will lift
purchases"* — and it:

- **Designs the experiment properly** — how many people you need, how long to run it,
  what could go wrong.
- **Runs the real math** when results come in — actual statistical tests, not an AI
  guessing — to say whether the difference is real or just noise.
- **Gives a verdict** — **ship it, iterate, or kill it** — with a plain-English
  explanation.

Its best party trick is *refusing* to be fooled: feed it a result that looks exciting
but is actually statistical noise, and it says *"don't ship this, it's noise."* That
honesty is rare, and it's what impresses judges — most AI demos say yes to everything.

## 3. Put together: test your marketing on fake people before spending money on real ones

The combined product story: instead of running a risky 2-week A/B test on real
players/customers, you broadcast two versions of your ad to the same simulated
Vietnamese audience, watch them react, and get a statistically sound verdict in
minutes — including *which regions and age groups* each version wins with, and the
ability to literally ask a simulated customer why they weren't convinced.

## What doesn't exist yet (the gap we're closing)

- **The A/B pipeline isn't plugged in yet** — the app now has a real, live-tested
  MiroShark client (`lib/miroshark/client.ts`, ported 2026-07-11) that can run a
  *single* simulation end-to-end, but MiroShark still needs the experiment endpoint
  (Phase 2) before the app can run a full A/B test through it.
- **The current crowd is too agreeable** — in the last test run everyone loved
  everything, so A vs B showed no difference. Fix is known: richer scenario docs
  (competitors, skeptics, price-sensitive customers) + turning on the Vietnamese
  census personas (`DEMOGRAPHICS_COUNTRY=vn`).
- **The pretty part isn't built.** The vision: a hand-drawn "agent world" — little
  characters scattered on a canvas, your ad playing on a TV in the middle, the crowd
  reacting live with speech bubbles, drifting toward or away from the TV, and
  point-and-click to interview anyone. Right now the results are boring dashboards and
  a text report. All the data for the world view already exists in MiroShark's API; it
  just needs the visual layer.

## Next steps (priority order)

1. Fix the too-agreeable audience (richer scenario + Vietnamese personas) — nothing
   else matters until variants actually disagree.
2. Add the experiment endpoint to MiroShark and plug in the agent app.
3. Build the agent-world UI (mock-driven first, so it demos even if the sim is down).
4. Point-and-click interviews.
5. Smarter hypothesis parsing (LLM extraction instead of keyword matching).
6. Pre-bake the demo experiment + record a fallback video.

*The detailed build plan is [`VNG_GRAND_PLAN.md`](./VNG_GRAND_PLAN.md) — run `/goal` to
execute it. Deeper technical status lives in `MiroShark/docs/VNG_AB_STATUS.md`,
`README-app.md`, and `docs/audits/` (2026-07-11 audit). Note: the product app was
flattened to the repo root on 2026-07-11 — where this doc says `vng-ab-test-agent/`,
read "repo root".*
