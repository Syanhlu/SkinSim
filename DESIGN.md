# DESIGN.md — SkinSim

Two deliberate design systems. Never mix them.

## Surface 1: `/` and product pages (VNG corporate)

Grounded in vng.com.vn. White, charcoal, one orange.

- Page: `#ffffff`; wash panels `#f7f7f9`; hairlines `#e7e7ec`
- Text: ink `#2b2a33`, soft `#6b6b76`, faint `#9d9da8`
- Accent (single): VNG orange `#f1592a`, hover `#d64a1f`, tint `#fef0ea`
  Spent on: eyebrow labels, links, the primary CTA, active/selected states. Nothing else.
- Semantic (verdicts only, never decorative): good `#1d7a46`, warn `#a06a12`, bad `#c0392b`
- Type: "Segoe UI" / system stack. Headline 700 tight; labels 600 small; values
  tabular-nums. No display font.
- Shape: cards 16px radius, 1px hairline border, shadow `0 2px 10px rgba(43,42,51,.06)`;
  buttons are pills; inputs on wash with orange focus ring.
- Copy: plain language on the surface, technical terms one disclosure deeper.
  No em dashes anywhere, including UI strings in code.

## Surface 2: `/world` (hand-drawn agent world)

All tokens live in `app/world/world.css`. Paper `#f7f4ea`, ink `#33302a`,
variant accents warm red `#c2452d` vs teal `#1f7a72`, hand font ("Segoe Print"
stack), wobbly borders, offset flat shadows, grass scribble texture.
This surface is intentionally playful; keep dashboard chrome out of it.

## Shared rules

- Data provenance is always labeled: live engine, simulated preview, or replay.
- Verdict badges (SHIP / ITERATE / KILL) are filled pills in semantic colors.
- Loading states narrate the story (preparing audience, crowd reacting), never
  spinners alone.
