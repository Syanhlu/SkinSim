# MiroShark web-scraped source material — implementation plan

**Status:** Not implemented. This is a design/planning document for adding a scrape step ahead of
`vng-creative-intelligence` simulations. No scraping integration exists today — there is no scrape module
wired into `gen.ts`, no `urlDocs` are ever produced or passed to a simulation, and nothing here has been
run against real APIs. TinyFish (Option D below) is one candidate provider under consideration, evaluated
from its published docs (`docs.tinyfish.ai`), not something that has been integrated, configured, or
tested. See `_shared/MIROSHARK-VIETNAM-FIT-PLAN.md` §10 for the broader SimClient integration this would
build on.

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
- **What's missing:** nothing in `vng-creative-intelligence` currently *produces* a `urlDocs` array.
  `vng-creative-intelligence/lib/gen.ts`'s `simulate_reception()` (the only caller of `client.simulate()`)
  builds `document` from a `SkinConcept` object and passes no `urlDocs`. There is no scraping/research step
  anywhere in `vng-creative-intelligence` today — this entire document describes work that has not started.
- **Known operational risk, unrelated to this plan:** with a very small agent population, Threads' TWHIN
  recsys cache refresh can throw an unhandled `list index out of range`
  (`miroshark/backend/wonderwall/social_platform/platform.py:374`) that appears to hang the simulation
  loop indefinitely rather than failing cleanly. Flagged here because a scrape-enriched corpus that produces
  a narrow ontology (few extracted entities → few agent profiles) could make this more likely once this plan
  is actually implemented, not because it's caused by anything that exists today.

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

**Option D — TinyFish Search + Fetch (candidate, would supersede Options A/C below if adopted).**
Based on published docs at `docs.tinyfish.ai` — not yet evaluated against a live account or integrated
anywhere. TinyFish exposes four public API surfaces — Agent, Search, Fetch, Browser — of which **Search**
and **Fetch** are documented as free (0 credits) on every pricing tier; only Agent/Browser (natural-language
browser automation) consume credits. Per the docs:

- **Fetch** (`POST https://api.fetch.tinyfish.ai`, header `X-API-Key`) is documented to take up to **10
  URLs in one request**, render JS-heavy pages, and return markdown/html/json with `{url, final_url, title,
  description, language, text}` per result plus per-URL failures in a separate `errors[]` array (one bad
  URL doesn't fail the batch). Documented to support `ttl`-based caching and etag/`if-modified-since`
  conditional requests. If this holds up, it would be an upgrade over driving MiroShark's own
  `/api/graph/fetch-url` one URL at a time for this use case — but none of this has been tried yet.
- **Search** is documented to return ranked `{title, snippet, url}` results for a plain-text query, free,
  no credits. If it works as documented, it would directly fill the Phase 2 "automated discovery" gap
  (currently scoped as an unspecified 1–2 day stretch goal, Option B) — a topic string in, candidate source
  URLs out, no separate research agent needed.
- **Agent** (natural-language browser automation, e.g. `client.agent.stream(url=..., goal=...)`) is
  documented as credit-metered (1 credit/step, $0.015/credit pay-as-you-go, 500 free credits to start;
  Starter $15/mo for 1,650 credits, Pro $150/mo for 16,500) — not needed for plain content scraping, but a
  possible option later for sources Fetch can't get (login-gated forums, infinite-scroll feeds, interactive
  widgets).

Net effect on this plan, **if TinyFish is adopted and works as documented**: Search would replace Phase 2's
discovery stretch goal, Fetch would replace Phase 1's per-URL calls to MiroShark's own endpoint — same
`SimUrlDoc[]` output shape either way, so nothing about `urlDocs`/`sim-client.ts` would need to change, only
what populates a new `lib/scrape-context.ts` module. MiroShark's own `/api/graph/fetch-url` would remain a
documented fallback if TinyFish isn't configured (mirroring the existing Firecrawl-vs-LLM-fallback pattern
in `url_fetcher.py`), so this wouldn't need to be all-or-nothing. All of this is still to be validated —
before committing to TinyFish, a real account should be set up and Search/Fetch exercised against a handful
of representative URLs (Reddit, Facebook, Threads) to confirm the documented behavior actually holds.

**Option C (hybrid: discovery step + a fetch step, provider-agnostic) is retained as the shape of the
plan** — Option D just names TinyFish as one candidate concrete provider for both halves of that shape.

## 3. Phased implementation plan

### Phase 1 — Bounded scrape step in `vng-creative-intelligence` (not started)

- New module, e.g. `lib/scrape-context.ts`: given a list of source URLs, call a Fetch-style API in a
  single batched request (up to 10 URLs at once, if TinyFish is the chosen provider — cheaper in
  round-trips than MiroShark's one-URL-at-a-time `/fetch-url`), cap to **N documents** (suggest N=5, well
  under a 10/request ceiling) and **M characters per document** (suggest ~2000), map `{url, title, text}`
  onto `SimUrlDoc[]`.
- Fall back to MiroShark's own `POST /api/graph/fetch-url` (Option A) when no third-party API key is
  configured, so this doesn't introduce a hard new external dependency for anyone running MiroShark
  standalone.
- Wire into `gen.ts`'s `simulate_reception()`: accept an optional `referenceUrls?: string[]` on the input,
  build `urlDocs` via the new module before calling `client.simulate()`. Gate behind an env flag
  (e.g. `MIROSHARK_SCRAPE_ENABLED`) so it doesn't add latency/cost to every run by default.
- Effort: ~0.5 day, if Fetch behaves as documented (free, single-call-batched) — needs confirming against
  a live account before this estimate can be trusted.

### Phase 2 — Source discovery (what to scrape)

- **v1 (recommended to start):** manual/config-driven — the concept or simulation request carries explicit
  reference URLs (e.g. a product page, a prior patch's community thread) supplied by whoever is triggering
  the simulation. Zero new dependencies, fully deterministic, cheap.
- **Possible stretch goal:** a Search-style API (free, ranked `{title, snippet, url}` results for a
  plain-text query) could do automated discovery directly — feed it a topic string (e.g. the skin concept's
  theme, or "VNG <game> <patch> community reaction"), take the top-K URLs, hand them to Phase 1's Fetch
  step. Previously scoped as an unspecified 1–2 day stretch when the only candidate was a last30days-style
  research agent; if a Search API works as documented it would be the same shape of integration as Phase 1,
  not a separate research subsystem — but this hasn't been tried.
- Effort: v1 (manual URLs) ~trivial; Search-driven discovery ~0.5–1 day (mostly query-string tuning per
  concept type, not plumbing) — assuming the provider's Search API works as documented.

### Phase 3 — Cost and quality guardrails

- **Cap corpus size before calling `/api/graph/ontology/generate`.** That endpoint is synchronous and
  makes one blocking LLM call over the whole concatenated corpus with no server-side size cap (only the
  50MB HTTP body limit). NER cost downstream scales ~linearly with corpus size (one LLM call per
  1500-char chunk, 6-worker pool). A scraper that pulls in dozens of pages could blow past MiroShark's
  "$1 per simulation" target. The N/M caps proposed in Phase 1 would be the actual guardrail — nothing
  enforces this server-side today, and Phase 1 hasn't been built yet either.
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

### Phase 3.5 — Platform scrapability (unverified, needs a real test)

Worth checking specifically since MiroShark simulates Threads and Facebook: whether a Fetch-style API can
actually pull real, unauthenticated content from these platforms (profile posts, group posts, comments) is
an open question, not something that's been tested. Instagram in particular is widely known to gate content
behind login for unauthenticated requests, so it may not be a viable source even if Threads/Facebook turn
out to be. This needs an actual test — a handful of representative URLs fetched through whatever provider is
chosen — before relying on it in Phase 1/2.

### Phase 4 — Verification (not started)

Once Phases 1–2 exist, this phase should run the real pipeline end-to-end: `buildScrapeContext()` (or
equivalent) with a real search query, feeding discovered/fetched sources as `urlDocs` into a real
`MiroSharkClient.simulate()` call, and confirming the run completes and that individual generated posts
visibly reflect the scraped content's specific themes rather than just the bare concept description — not
just that the fetch/search layer returns data.

Open questions this phase would need to answer:
- Whether a `threads+facebook` (or similar) run with scrape-enriched `urlDocs` completes within a
  reasonable `runTimeoutMs` — MiroShark's own product promise is "under 10 minutes," so any caller
  (`gen.ts`'s `simulate_reception()` included) should budget accordingly rather than assuming a short
  timeout is safe.
- Cost/latency at Phase 1's full N=5-doc cap.
- Whether a `platforms: ["threads"]`-only run with a small agent population reliably avoids the known
  TWHIN-recsys hang described in §0.

## 4. Effort rollup

| Phase | Scope | Estimate |
|---|---|---|
| 1 | Bounded scrape step, third-party Fetch + MiroShark fallback (`scrape-context.ts` + `gen.ts` wiring) | ~0.5 day |
| 2 | Source discovery, v1 (manual reference URLs) | ~trivial |
| 2 | Source discovery, Search-driven | ~0.5–1 day |
| 3 | Cost/quality guardrails + openapi fix | ~0.5 day |
| 4 | Verification at realistic scale | ~0.5 day |
| — | **Total for v1 (manual URLs, no auto-discovery)** | **~1–1.5 days** |
| — | **Total including Search-driven discovery** | **~1.5–2.5 days** |

Estimates assume a third-party Search/Fetch provider (e.g. TinyFish) behaves as documented; none of this has
been validated against a live account yet, so treat these as rough until Phase 1 is actually attempted.

## 5. Risks / open questions

- **Legal/ToS:** which sources are actually OK to scrape (news sites, forums, social platforms) is a
  product/legal call, not something the SSRF-protection layer (which only blocks *internal* targets)
  makes for you, and not something a third-party scraping vendor's terms would absolve you of either. Needs
  an explicit allow/deny policy before this goes past internal testing.
- **Cost has no server-side ceiling on the MiroShark side.** Even if a chosen scraping provider's Search +
  Fetch calls are free, the downstream ontology-generation/NER cost in `/api/graph/ontology/generate` is
  unchanged by which scraper feeds it — the N/M caps proposed in Phase 3 would be the only guardrail on
  corpus size hitting that endpoint, and they don't exist yet.
- **New third-party vendor dependency.** If TinyFish (or any similar provider) is adopted, that's a new
  external service and a new credential to manage (e.g. an API key) and a new vendor in the dependency
  graph, even if the specific calls this plan would use (Search, Fetch) are free. Worth a quick check with
  whoever owns vendor/dependency approval before wiring anything beyond local dev — the MiroShark-fallback
  path proposed in Phase 1 exists partly so this wouldn't be a hard blocking dependency.
- **The Threads/TWHIN recsys hang (§0)** is unrelated to scraping but worth watching: if enrichment
  narrows the ontology (fewer, more specific entity types → fewer agent profiles), it could make the
  small-population edge case that triggered it more likely to recur once this plan is implemented. Not
  blocking this plan; worth its own follow-up.
