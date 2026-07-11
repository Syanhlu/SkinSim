# DESIGN.md — "Lab & Stage"

User-confirmed direction (2026-07-03): the page encodes the product's thesis. The analysis half is a bright, rigorous
"lab" (warm paper, serif display, mono figures, hairline rules, numbered report sections). The generation half is a
committed near-black "stage" where the pipeline, concept reveal, 3D model, and agent console live. One deliberate
blackout transition; glow is reserved exclusively for the stage.

## Fonts (next/font/google, self-hosted at build)
- Display: **Fraunces** (variable, `--font-display`). Headlines, section titles, the verdict. Weight 540–620, tight tracking.
- Body/UI: **Instrument Sans** (`--font-body`).
- Data: **Geist Mono** (`--font-mono`) with `tabular-nums`. Every figure, kicker, badge, code, axis tick.

## Color

### Lab (light)
| Token | Value | Use |
|---|---|---|
| `--paper` | `oklch(0.962 0.009 90)` | page |
| `--paper-raised` | `oklch(0.982 0.007 92)` | panels |
| `--paper-sunken` | `oklch(0.936 0.011 88)` | tracks, wells |
| `--ink` | `oklch(0.245 0.02 70)` | text |
| `--ink-muted` | `oklch(0.49 0.022 72)` | secondary text |
| `--hairline` | `oklch(0.865 0.014 85)` | rules, borders |
| `--signal` | `oklch(0.545 0.115 163)` ≈ `#0d8a5f` | the agent's pick (charts, lift, selected rows) |
| `--warn` | `oklch(0.545 0.13 55)` ≈ `#b45a1f` | the trap theme / fallbacks |
| `--neutral-mark` | `oklch(0.62 0.02 85)` | non-story chart bars (recessive by design) |

### Stage (dark)
| Token | Value | Use |
|---|---|---|
| `--stage` | `oklch(0.165 0.008 70)` | warm near-black (not blue-black) |
| `--stage-raised` | `oklch(0.21 0.01 75)` | tiles, console |
| `--stage-ink` | `oklch(0.93 0.012 90)` | text |
| `--stage-muted` | `oklch(0.66 0.015 85)` | secondary |
| `--stage-hairline` | `oklch(0.30 0.012 75)` | borders |
| `--stage-accent` | `oklch(0.78 0.15 163)` ≈ `#35cf94` | neon mint: best pick ring, live states, spotlight |
| `--stage-warn` | `oklch(0.72 0.13 70)` | fallback states on stage |

One hue family (163) carries the agent's signal in both worlds: deep viridian on paper, luminous mint on stage.

### Validation (dataviz validator, 2026-07-03)
- Light categorical pair `#0d8a5f, #b45a1f` on light surface: **ALL CHECKS PASS** (lightness band, chroma ≥0.1, CVD ΔE 26.1 protan worst, contrast ≥3:1).
- `--neutral-mark` is intentionally sub-chroma-floor: it is the de-emphasis role, identity carried by position + direct labels, never by hue.
- Stage accents pass contrast + CVD; they sit slightly above the dark-mode categorical lightness band, which is in-scope only for chart marks. The stage has no charts; accents are UI signals.

## Chart rules (dataviz)
- Color encodes the **agent's verdict**, not entity identity: pick = signal, trap = warn, all others = neutral. Fixed roles, never cycled hues.
- One axis per chart. Thin marks, 4px rounded data ends, recessive grid (`--hairline`), mono axis ticks, paper tooltips.
- Role key rendered inline (mono) instead of a recharts Legend box.

## Type scale
- Masthead headline: `clamp(2.4rem, 4.6vw, 3.9rem)` Fraunces, line-height 1.02, tracking -0.02em.
- Section titles: 1.3rem Fraunces 600.
- Kickers: 0.68rem Geist Mono, uppercase, tracking 0.16em, numbered (`01 Portfolio`, `02 Verdict`, `03 Evidence`, `04 The Stage`) — the numbers encode the report's reading order, which is a real sequence (analyze → verdict → evidence → generate).
- Figures: Geist Mono, tabular-nums. Hero lift figure 2.6rem.

## Layout
- Full-width `main`; `.container` = `min(1340px, 100% - 48px)`.
- Lab sections separated by hairline rules, not boxed cards; panels are quiet raised surfaces without heavy shadows.
- Evidence strip: one row of figures with hairline dividers (NOT four identical metric cards); the lift figure is the emphasized member.
- The stage is full-bleed dark with a single hairline seam; radial mint spotlight only behind the 3D model.

## Motion (Emil rules)
- Scroll reveals: IntersectionObserver adds `.is-in`; `opacity 0 → 1`, `translateY(14px) → 0`, 640ms `cubic-bezier(0.22, 1, 0.36, 1)`, staggered ≤60ms. Transform/opacity only.
- Buttons: `:active` scale(0.97), 160ms `cubic-bezier(0.23, 1, 0.32, 1)`; hover states gated behind `@media (hover: hover)`.
- Concept tiles enter with staggered fade-up + 4px blur resolve when the pipeline returns.
- Pipeline running: current timeline step pulses; nothing else animates while waiting.
- `prefers-reduced-motion: reduce` strips transforms, keeps opacity.

## Bans honored
No side-stripe borders, no gradient text, no glassmorphism, no hero-metric card template, no identical card grids,
no em dashes in UI copy, no purple-neon gaming cliché, no `#000`/`#fff`.
