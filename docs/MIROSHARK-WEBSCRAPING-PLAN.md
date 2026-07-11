# MiroShark web-scraped source material — implementation plan

**Status:** Phase 1 + Phase 2 (TinyFish-driven, Option D) implemented and live-verified 2026-07-10.
`vng-creative-intelligence/lib/scrape-context.ts` exists (`searchWeb`, `fetchUrls` with TinyFish-then-
MiroShark fallback, `buildScrapeContext`), wired into `gen.ts`'s `simulate_reception()` behind
`MIROSHARK_SCRAPE_ENABLED`, and both the MiroShark-fallback fetch path and the real TinyFish Search+Fetch
path have been exercised live against real APIs (see §0 for what that live run actually returned — real
Reddit/Facebook skin-price-complaint threads, not synthetic data). Phase 3 (cost/quality guardrails beyond
the basic maxDocs/maxCharsPerDoc caps already in `buildScrapeContext`) and Phase 4 (verification at
realistic multi-source scale through an actual `simulate_reception()` run, not just the fetch/search layer)
are **not yet done** — see the phase sections below for what's left. See `_shared/MIROSHARK-VIETNAM-FIT-PLAN.md`
§10 for the broader SimClient integration this builds on.

## 0. What's confirmed (grounding for everything below)

- **MiroShark's backend already scrapes URLs.** `miroshark/backend/app/utils/url_fetcher.py` is a working
  218-line scraper: primary path is a self-hosted Firecrawl instance (`Config.FIRECRAWL_BASE_URL`, handles
  JS-heavy pages/PDFs/DOCX, returns markdown), with an `:online`-capable-LLM fallback if Firecrawl isn't
  configured. SSRF-guarded (blocks private/loopback/reserved IPs) before either path runs. Minimum viable
  extraction is 100 chars; title capped at 120 chars. Exposed at `POST /api/graph/fetch-url` (body
  `{"url": "..."}`, returns `{title, text, url, char_count}`).
- **MiroShark's ingestion endpoint already accepts pre-scraped, multi-document input.**
  `POST /api/graph/ontology/generate` (`miroshark/backend/app/api/graph.py:105-280`) is
  `multipart/form-data` and accepts `files` (pdf/md/txt uploads) **and** `url_docs` — a JSON-encoded list
  of `{title, url, text}` — alongside a required `simulation_requirement` string. All doc texts (files +
  url_docs) are concatenated with `=== title ===` separators into one corpus, run through
  `TextProcessor.preprocess_text` (strips HTML/boilerplate, dedups repeated lines — a good fit for
  Firecrawl markdown), then used to generate a custom ontology and build the Neo4j graph. This is a
  first-class multi-document/corpus input, not something that needs a schema change.
- **The client-side plumbing now exists and is live-verified.** `vng-creative-intelligence/lib/sim-client.ts`'s
  `MiroSharkClient` was rewritten this session to implement the real 10-step API flow (it previously called
  a nonexistent `/api/simulate` endpoint and always silently fell back to mock output). `SimInput` now has
  an optional `urlDocs: {title, url, text}[]` field that rides into `/api/graph/ontology/generate`'s
  `url_docs` form field. Verified live: a document describing a skin concept, plus one `urlDocs` entry
  containing a synthetic "regional launch delay" community complaint, produced a simulated agent post in
  Vietnamese that directly echoed that injected complaint — confirming scraped-shaped content actually
  reaches and grounds simulated agents, not just the base document.
- **What's missing:** nothing currently *produces* a `urlDocs` array. `vng-creative-intelligence/lib/gen.ts`'s
  `simulate_reception()` (the only caller of `client.simulate()`) builds `document` from a `SkinConcept`
  object and passes no `urlDocs`. There is no scraping/research step anywhere in `vng-creative-intelligence`
  today.
- **Known operational risk, found live this session, not fixed:** with a very small agent population,
  Threads' TWHIN recsys cache refresh can throw an unhandled `list index out of range`
  (`miroshark/backend/wonderwall/social_platform/platform.py:374`) that appears to hang the simulation
  loop indefinitely rather than failing cleanly. Didn't reproduce with `threads+facebook` combined (the
  previously-verified-good config). Flagged here because a scrape-enriched corpus that produces a narrow
  ontology (few extracted entities → few agent profiles) could make this more likely, not because it's
  caused by anything in this plan.

## 1. Goal

Let real web content — community reaction, news coverage, forum threads — ground a MiroShark simulation
alongside (or instead of) a manually authored document. Two concrete use cases for
`vng-creative-intelligence`:

1. **Enrichment:** a skin concept / balance change / A/B variant gets simulated against real recent
   discourse about similar changes, not just its own description in a vacuum.
2. **Cold-start:** "just a question" flow — no document at all, only a topic — where scraped sources
   *are* the document.

## 2. Design options

**Option A — MiroShark does the fetching.** From `vng-creative-intelligence`, call MiroShark's own
`POST /api/graph/fetch-url` once per source URL, collect the `{title, url, text}` results, pass them as
`urlDocs`. Thin: no new scraping code or dependencies in the Next.js app, reuses the SSRF-protected
Firecrawl path that's already deployed and tested. Downside: the caller still has to supply URLs — this
endpoint fetches, it doesn't discover — and it's one URL per request (no batching).

**Option B — An external research/discovery agent finds and summarizes sources.** Something like the
`last30days` skill (pulls Reddit/X/YouTube/TikTok/HN/Polymarket/web for a topic) runs first, and its
output is packaged directly as `urlDocs`. Handles *discovery* (what's worth scraping) as well as content.
Downside: another moving part, another place quality/cost can drift, and its output isn't guaranteed to be
full-page text the way Firecrawl's is — may be summaries/snippets rather than the richer source MiroShark's
NER extraction wants.

**Option D — TinyFish Search + Fetch (recommended, supersedes Options A/C below).** Researched
2026-07-10 (`docs.tinyfish.ai`). TinyFish exposes four public API surfaces — Agent, Search, Fetch, Browser
— of which **Search** and **Fetch** are free (0 credits) on every pricing tier; only Agent/Browser
(natural-language browser automation) consume credits. Concretely:

- **Fetch** (`POST https://api.fetch.tinyfish.ai`, header `X-API-Key`) takes up to **10 URLs in one
  request**, renders JS-heavy pages, returns markdown/html/json with `{url, final_url, title, description,
  language, text}` per result and per-URL failures in a separate `errors[]` array (one bad URL doesn't
  fail the batch). Supports `ttl`-based caching and etag/`if-modified-since` conditional requests — repeat
  scrapes of the same source across simulations don't need to re-fetch. This is a strict upgrade over
  driving MiroShark's own `/api/graph/fetch-url` one URL at a time for this use case.
- **Search** returns ranked `{title, snippet, url}` results for a plain-text query, free, no credits.
  This directly fills the Phase 2 "automated discovery" gap that was previously scoped as an unspecified
  1–2 day stretch goal (Option B) — a topic string in, candidate source URLs out, no separate research
  agent needed.
- **Agent** (natural-language browser automation, e.g. `client.agent.stream(url=..., goal=...)`) is
  credit-metered (1 credit/step, $0.015/credit pay-as-you-go, 500 free credits to start; Starter $15/mo
  for 1,650 credits, Pro $150/mo for 16,500) — not needed for plain content scraping, but a real option
  later for sources Fetch can't get (login-gated forums, infinite-scroll feeds, interactive widgets).

Net effect on this plan: **Search replaces Phase 2's discovery stretch goal, Fetch replaces Phase 1's
per-URL calls to MiroShark's own endpoint** — same `SimUrlDoc[]` output shape either way, so nothing about
`urlDocs`/`sim-client.ts` changes, only what populates `lib/scrape-context.ts`. MiroShark's own
`/api/graph/fetch-url` stays as a documented fallback if TinyFish isn't configured (mirrors the existing
Firecrawl-vs-LLM-fallback pattern in `url_fetcher.py`), so this doesn't need to be all-or-nothing.

**Option C (hybrid: discovery step + a fetch step, provider-agnostic) is retained as the shape of the
plan** — Option D just names TinyFish as the concrete provider for both halves of that shape.

## 3. Phased implementation plan

### Phase 1 — Bounded scrape step in `vng-creative-intelligence` (TinyFish Fetch, Option D)

- New module, e.g. `lib/scrape-context.ts`: given a list of source URLs, call TinyFish's Fetch API in a
  single batched request (up to 10 URLs at once — cheaper in round-trips than MiroShark's one-URL-at-a-time
  `/fetch-url`), cap to **N documents** (suggest N=5, well under the 10/request ceiling) and **M characters
  per document** (suggest ~2000), map `{url, title, text}` straight onto `SimUrlDoc[]`.
- Fall back to MiroShark's own `POST /api/graph/fetch-url` (Option A) when `TINYFISH_API_KEY` isn't
  configured, so this doesn't introduce a hard new external dependency for anyone running MiroShark
  standalone.
- Wire into `gen.ts`'s `simulate_reception()`: accept an optional `referenceUrls?: string[]` on the input,
  build `urlDocs` via the new module before calling `client.simulate()`. Gate behind an env flag
  (e.g. `MIROSHARK_SCRAPE_ENABLED`) so it doesn't add latency/cost to every run by default.
- Effort: ~0.5 day — Fetch is free and single-call-batched, so this is thinner than the original
  MiroShark-only plan, not thicker.

### Phase 2 — Source discovery (what to scrape)

- **v1 (recommended to start):** manual/config-driven — the concept or simulation request carries explicit
  reference URLs (e.g. a product page, a prior patch's community thread) supplied by whoever is triggering
  the simulation. Zero new dependencies, fully deterministic, cheap.
- **No longer a stretch goal:** TinyFish's Search API (free, ranked `{title, snippet, url}` results for a
  plain-text query) does automated discovery directly — feed it a topic string (e.g. the skin concept's
  theme, or "VNG <game> <patch> community reaction"), take the top-K URLs, hand them to Phase 1's Fetch
  step. This was scoped as an unspecified 1–2 day stretch when the only candidate was a last30days-style
  research agent; with Search API it's the same shape of integration as Phase 1, not a separate research
  subsystem.
- Effort: v1 (manual URLs) ~trivial; Search-driven discovery ~0.5–1 day (mostly query-string tuning per
  concept type, not plumbing).

### Phase 3 — Cost and quality guardrails

- **Cap corpus size before calling `/api/graph/ontology/generate`.** That endpoint is synchronous and
  makes one blocking LLM call over the whole concatenated corpus with no server-side size cap (only the
  50MB HTTP body limit). NER cost downstream scales ~linearly with corpus size (one LLM call per
  1500-char chunk, 6-worker pool). A scraper that pulls in dozens of pages could blow past MiroShark's
  "$1 per simulation" target. The N/M caps from Phase 1 are the actual guardrail — nothing enforces this
  server-side today.
- **Require Firecrawl in production.** `url_fetcher.py`'s fallback path asks an `:online` LLM to "read" a
  URL and report back text — it can fabricate content. That's fine for a dev/demo fallback, not for
  anything a report cites as evidence. Treat `FIRECRAWL_BASE_URL` being configured as a hard requirement
  for any scrape-enriched simulation that will be published/shared, not a nice-to-have.
- **Source hygiene:** dedupe URLs before fetching, skip pages that come back under some minimum content
  richness (the endpoint already rejects <100 chars, but near-empty boilerplate pages can still slip
  through), and treat one source failing to fetch as non-fatal — drop it and continue rather than failing
  the whole simulation.
- **Fix the `openapi.yaml` drift.** `backend/openapi.yaml:282-295` currently documents
  `/api/graph/ontology/generate` as JSON `{text, project_id}`; the real handler is multipart form-data.
  Harmless today since nothing external depends on the spec, but fix it before treating this endpoint as
  a stable contract other teams integrate against.
- Effort: ~0.5 day.

### Phase 3.5 — Confirmed: Threads and Facebook are actually scrapable (2026-07-10 live test)

Worth calling out specifically since MiroShark simulates exactly these two platforms: fetched real Threads
profile pages and real Facebook group posts via TinyFish Fetch, unauthenticated.

- **Threads:** a profile URL returns several recent posts (captions, hashtags, follower count) before
  hitting "Log in to see more from X" — a genuine content preview, not a hard login wall.
- **Facebook:** group posts came back with full post text, reaction/share counts, and actual top comments
  under real usernames (one sample had "3 of 51" comments visible before pagination cut it off) — e.g. a
  real community argument about a game skin's price, fetched with no auth. An earlier single-sample test
  (§0) that looked login-gated turned out to be a restricted/deleted post, not representative — group
  posts in general came through fine.
- **Instagram, by contrast, is a hard gate** — every fetch attempt returned only "Log into Instagram" with
  no content. Not one of MiroShark's simulated platforms, but worth remembering if scraping ever extends
  there: don't assume all Meta properties behave the same way.

Net: real recent Threads/Facebook community discourse — the same kind of content MiroShark's own simulated
agents produce — is a viable, low-effort source for `urlDocs`, not just a theoretical one.

### Phase 4 — Verification (done 2026-07-10)

Ran the real pipeline end-to-end: `buildScrapeContext()` with a live TinyFish search (query derived from
a sample skin concept) found 3 real sources — a Reddit "Mecha Ronin" custom-squad thread, a YouTube "Is It
Pay-to-Win?" review, a Facebook Cyberpunk-group post — fed them as `urlDocs` into a real
`MiroSharkClient.simulate()` call (`threads+facebook`, `country: "vn"`, `max_rounds: 1`), and let it run
to completion (19 agents, 51 actions, 397s / ~6.6 min).

**Result: `Bullish 61.5% / Neutral 15.4% / Bearish 23.1%`, high-risk.** More importantly, individual
generated posts visibly reflect the scraped content's specific themes rather than just the bare skin
description — one Threads post is a Vietnamese-language rant explicitly referencing "Mecha Break battle
pass," unfixed hitboxes, and a price comparison to an old game ("Gunny"), directly traceable to the scraped
"pay-to-win" YouTube review. Other posts debate the exact scraped price point. This confirms the citation-
level grounding claimed in §0 holds at realistic scale (3 sources, real content), not just the single
synthetic-doc case.

**One real correction to earlier estimates:** a `threads+facebook` run with real content took ~6.6 minutes
— past the 5-minute default `runTimeoutMs` two throwaway test scripts used (which errored on timeout even
though the underlying simulation completed fine both times, confirmed by reading `run_state.json`
directly). Any real caller (`gen.ts`'s `simulate_reception()` included) should budget a `runTimeoutMs` of
at least ~8–10 minutes, matching MiroShark's own "under 10 minutes" product promise, not the 5-minute
figure this plan's Phase 4 originally assumed.

- Still open: cost/latency at Phase 1's full N=5-doc cap (this run used 3) and a `platforms: ["threads"]`-
  only run specifically (this session hit a real backend TWHIN-recsys hang on a threads-only, 4-agent run
  earlier — see §0 — unconfirmed whether a larger/scrape-enriched agent population avoids it).

## 4. Effort rollup

| Phase | Scope | Estimate |
|---|---|---|
| 1 | Bounded scrape step, TinyFish Fetch + MiroShark fallback (`scrape-context.ts` + `gen.ts` wiring) | ~0.5 day |
| 2 | Source discovery, v1 (manual reference URLs) | ~trivial |
| 2 | Source discovery, TinyFish Search-driven | ~0.5–1 day |
| 3 | Cost/quality guardrails + openapi fix | ~0.5 day |
| 4 | Verification at realistic scale | ~0.5 day |
| — | **Total for v1 (manual URLs, no auto-discovery)** | **~1–1.5 days** |
| — | **Total including TinyFish Search-driven discovery** | **~1.5–2.5 days** |

## 5. Risks / open questions

- **Legal/ToS:** which sources are actually OK to scrape (news sites, forums, social platforms) is a
  product/legal call, not something the SSRF-protection layer (which only blocks *internal* targets)
  makes for you, and not something TinyFish's terms absolve you of either. Needs an explicit allow/deny
  policy before this goes past internal testing.
- **Cost has no server-side ceiling on the MiroShark side.** TinyFish Search + Fetch being free removes
  cost risk from the *scraping* step itself, but the downstream ontology-generation/NER cost in
  `/api/graph/ontology/generate` is unchanged by which scraper feeds it — the N/M caps in Phase 3 are still
  the only guardrail on corpus size hitting that endpoint.
- **New third-party vendor dependency.** TinyFish is a paid external service (free tier + credit overage);
  adding `TINYFISH_API_KEY` means a new credential to manage and a new vendor in the dependency graph, even
  though the specific calls this plan uses (Search, Fetch) are free. Worth a quick check with whoever owns
  vendor/dependency approval before wiring it into anything beyond local dev — the MiroShark-fallback path
  in Phase 1 exists partly so this isn't a hard blocking dependency.
- **The Threads/TWHIN recsys hang (§0)** is unrelated to scraping but worth watching: if enrichment
  narrows the ontology (fewer, more specific entity types → fewer agent profiles), it could make the
  small-population edge case that triggered it more likely to recur. Not blocking this plan; worth its
  own follow-up.
