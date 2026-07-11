// ─── Scrape-context adapter (TinyFish, with MiroShark fetch-url fallback) ────
// Turns a topic/query (and/or explicit reference URLs) into SimUrlDoc[] — real
// web content that rides alongside a SimInput.document into a MiroShark
// simulation's ingestion corpus (see SimClient.simulate()'s `urlDocs` field).
//
// TinyFish's Search + Fetch APIs are free (no credits) and do the actual
// discovery/scraping. When TINYFISH_API_KEY isn't set, source discovery is
// skipped (nothing to search with) and fetching falls back to MiroShark's own
// POST /api/graph/fetch-url, one URL at a time, so this never becomes a hard
// dependency on a third-party vendor. Every call here is best-effort: on any
// failure, the caller gets fewer (or zero) docs, never a thrown error that
// breaks the simulation pipeline.
//
// Server-only.

import type { SimUrlDoc } from "@/lib/sim-client";

const TINYFISH_SEARCH_URL = "https://api.search.tinyfish.ai";
const TINYFISH_FETCH_URL = "https://api.fetch.tinyfish.ai";
const TINYFISH_FETCH_MAX_URLS = 10;

export function isTinyFishEnabled(): boolean {
  return Boolean(process.env.TINYFISH_API_KEY);
}

interface TinyFishSearchResult {
  position?: number;
  site_name?: string;
  title?: string;
  snippet?: string;
  url?: string;
}

/** TinyFish Search — free, ranked web results for a query. Returns [] on any failure. */
export async function searchWeb(query: string, limit = 5): Promise<TinyFishSearchResult[]> {
  const key = process.env.TINYFISH_API_KEY;
  if (!key || !query.trim()) return [];

  const url = new URL(TINYFISH_SEARCH_URL);
  url.searchParams.set("query", query);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { headers: { "X-API-Key": key }, signal: controller.signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { results?: TinyFishSearchResult[] };
    return (body.results ?? []).filter((r) => r.url).slice(0, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

interface TinyFishFetchResult {
  url: string;
  title?: string;
  text?: string;
}

/** TinyFish Fetch — free, batches up to 10 URLs/request, JS-rendered markdown. */
async function fetchUrlsViaTinyFish(urls: string[]): Promise<SimUrlDoc[]> {
  const key = process.env.TINYFISH_API_KEY;
  if (!key || urls.length === 0) return [];

  const docs: SimUrlDoc[] = [];
  for (let i = 0; i < urls.length; i += TINYFISH_FETCH_MAX_URLS) {
    const batch = urls.slice(i, i + TINYFISH_FETCH_MAX_URLS);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(TINYFISH_FETCH_URL, {
        method: "POST",
        headers: { "X-API-Key": key, "content-type": "application/json" },
        body: JSON.stringify({ urls: batch, format: "markdown" }),
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { results?: TinyFishFetchResult[] };
      for (const result of body.results ?? []) {
        if (result.text) docs.push({ title: result.title || result.url, url: result.url, text: result.text });
      }
    } catch {
      // Best-effort: a failed batch just yields fewer docs.
    } finally {
      clearTimeout(timeout);
    }
  }
  return docs;
}

/** MiroShark's own scraper (Firecrawl-backed) — one URL per request. Fallback path. */
async function fetchUrlsViaMiroShark(urls: string[]): Promise<SimUrlDoc[]> {
  const base = process.env.MIROSHARK_URL;
  if (!base || urls.length === 0) return [];

  const docs = await Promise.all(
    urls.map(async (sourceUrl): Promise<SimUrlDoc | null> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch(`${base.replace(/\/$/, "")}/api/graph/fetch-url`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: sourceUrl }),
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { data?: { title?: string; text?: string; url?: string } };
        const { title, text, url: resolvedUrl } = body.data ?? {};
        if (!text) return null;
        return { title: title || sourceUrl, url: resolvedUrl || sourceUrl, text };
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }),
  );
  return docs.filter((doc): doc is SimUrlDoc => doc !== null);
}

/** Fetch full text for a list of URLs — TinyFish if configured, else MiroShark's own scraper. */
export async function fetchUrls(urls: string[]): Promise<SimUrlDoc[]> {
  const deduped = [...new Set(urls)];
  if (deduped.length === 0) return [];
  return isTinyFishEnabled() ? fetchUrlsViaTinyFish(deduped) : fetchUrlsViaMiroShark(deduped);
}

export interface ScrapeContextOptions {
  /** Explicit source URLs to fetch, in addition to any search-discovered ones. */
  referenceUrls?: string[];
  /** Free-text query to discover additional sources via TinyFish Search (skipped if unset or TinyFish is disabled). */
  searchQuery?: string;
  /** Max documents to return, across referenceUrls + search results combined. */
  maxDocs?: number;
  /** Truncate each document's text to this many characters. */
  maxCharsPerDoc?: number;
}

/**
 * Builds SimUrlDoc[] for a MiroShark simulation: explicit reference URLs plus
 * (if a searchQuery is given and TinyFish is configured) discovered sources,
 * deduped, fetched, and capped. Best-effort — returns [] rather than throwing
 * when nothing is configured or every fetch fails, so callers can treat this
 * as pure enrichment, not a required step.
 */
export async function buildScrapeContext(options: ScrapeContextOptions): Promise<SimUrlDoc[]> {
  const maxDocs = options.maxDocs ?? 5;
  const maxCharsPerDoc = options.maxCharsPerDoc ?? 2000;

  const discovered = options.searchQuery ? await searchWeb(options.searchQuery, maxDocs) : [];
  const candidateUrls = [...(options.referenceUrls ?? []), ...discovered.map((r) => r.url!)].slice(0, maxDocs);

  const docs = await fetchUrls(candidateUrls);
  return docs.slice(0, maxDocs).map((doc) => ({ ...doc, text: doc.text.slice(0, maxCharsPerDoc) }));
}
