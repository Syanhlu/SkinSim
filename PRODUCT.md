# PRODUCT.md — Agamotto

register: product

## What it is

Agamotto answers one question for marketers and game teams: which version of an idea
wins, before real money is spent. The user describes a change (an ad, a promo, a
price). Agamotto builds a rigorous A/B test, shows both versions to a simulated
audience of census-grounded Vietnamese consumers, and returns a plain verdict:
ship it, improve it, or drop it. Real statistics compute every number; the AI only
narrates and orchestrates.

## Users

- Primary: marketing and LiveOps people at VNG (games, payments, consumer apps).
  Not statisticians. They think in "which ad wins", not p-values.
- Secondary: hackathon judges evaluating credibility. They open "under the hood"
  and expect real math (scipy-validated tests, honest non-significance).

## Two surfaces, two moods

- `/` (this register: product): a clean corporate tool in VNG's own brand language.
  Confidence, clarity, zero jargon on the surface, rigor one click deeper.
- `/world`: the demo showpiece. Hand-drawn crowd simulation, deliberately playful.
  The contrast is intentional; do not blend the two styles.

## Tone

Plain, confident, concrete. Say "chance it's just luck", not "p-value" (the exact
term stays available under Method). Verdicts are one word. Never oversell: when a
result is noise, the product says so proudly; refusing to be fooled is the brand's
best trick.

## Strategic principles

1. The LLM never computes statistics. Numbers come from the deterministic engine.
2. Everything demos with the simulation engine down (instant simulated preview is
   the default; the live deep simulation is an explicit, labeled, cost-bearing choice).
3. Honesty beats polish: label data sources (live, simulated preview, replay),
   surface caveats, show the working.

## Anti-references

- Generic AI-startup landing pages (purple gradients, glass cards, hero metrics).
- Dashboard maximalism: this is a focused flow (describe, plan, run, verdict), not
  a wall of charts.
- Em dashes and AI-sounding copy patterns. Short sentences. Plain words.
