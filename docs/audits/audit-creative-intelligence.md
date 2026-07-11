1. FEATURE INVENTORY

- `app/layout.tsx` — root shell, fonts, metadata. State: working; imports CSS, configures `Fraunces`, `Instrument_Sans`, `Geist_Mono`, and renders `<html>/<body>` (`app/layout.tsx:1-30`).
- `app/page.tsx` — home dashboard server component. State: working sample-data page; force-dynamic, reads `data/ads.sample.csv`, builds vision-capable snapshot, backtest, optional Supabase persistence, and passes env-derived booleans to the dashboard (`app/page.tsx:8-29`).
- `app/dashboard.tsx` — full client UI. State: working with caveats; implements upload, history, generation, charts, 3D preview, and agent console (`app/dashboard.tsx:154-207`, `app/dashboard.tsx:209-693`), but uploaded CSV state is client-only while the agent route always rereads the sample CSV (`app/dashboard.tsx:185-190`, `app/api/agent/route.ts:35-36`).
- `app/globals.css` — Lab/Stage design system. State: working; defines tokens, responsive grids, buttons, focus states, stage, model viewer, and mobile breakpoints (`app/globals.css:4-40`, `app/globals.css:267-355`, `app/globals.css:777-1170`, `app/globals.css:1176-1254`).
- `app/api/generate/route.ts` — synchronous generation pipeline endpoint. State: working mock-first; validates `{ theme }`, calls `runGenerationPipeline`, returns JSON, with 300s max duration (`app/api/generate/route.ts:4-14`).
- `app/api/agent/route.ts` — AI SDK tool-calling agent. State: working only when AI Gateway/OIDC is configured; returns 503 otherwise (`app/api/agent/route.ts:27-33`), and exposes analysis/backtest/baseline/generation tools over the sample CSV (`app/api/agent/route.ts:35-122`).
- `app/api/upload/route.ts` — CSV upload analyzer. State: working for schema-valid CSV; checks only that `file` is a `File`, parses CSV, returns snapshot/backtest, and sends parser errors as 400 (`app/api/upload/route.ts:5-27`).
- `app/api/history/route.ts` — Supabase history reader. State: mock-only/no-op unless Supabase env exists; returns `configured` and `runs` from `listAnalysisSnapshots` (`app/api/history/route.ts:1-7`, `lib/supabase.ts:72-87`).
- `lib/analysis.ts` — core analytics. State: working deterministic logic; parses required columns, computes ROAS/LTV metrics, clusters by high-value-player share, recommends a direction, compares baselines, and bootstraps uncertainty (`lib/analysis.ts:150-231`, `lib/analysis.ts:275-349`, `lib/analysis.ts:352-489`).
- `lib/vision.ts` — optional LLM vision tagging. State: working fallback path, live path unverified; uses AI Gateway/OIDC gate, dedupes thumbnails, catches any vision error, logs fallback, and returns metadata tags (`lib/vision.ts:39-77`, `lib/vision.ts:83-99`, `lib/vision.ts:101-140`).
- `lib/gen.ts` — generation orchestration. State: working mock-first fixed chain; defines bundled concepts, optional Nano Banana art, optional MiroShark/TinyFish context, mock fallback reception, best-pick sorting, optional Meshy GLB, service badges, and tool log (`lib/gen.ts:66-143`, `lib/gen.ts:145-184`, `lib/gen.ts:198-231`, `lib/gen.ts:233-306`).
- `lib/gen-adapters.ts` — Nano Banana + Meshy HTTP adapters. State: working best-effort adapters, no local imports; details in section 2 (`lib/gen-adapters.ts:9-92`).
- `lib/sim-client.ts` — MiroShark adapter + mock simulator. State: mock-only by default; `getSimClient` returns `MockSimClient` without `MIROSHARK_URL`, otherwise constructs `MiroSharkClient` (`lib/sim-client.ts:72-90`, `lib/sim-client.ts:125-367`).
- `lib/scrape-context.ts` — TinyFish/MiroShark scrape enrichment. State: stubbed/optional; only used when `MIROSHARK_SCRAPE_ENABLED === "true"` (`lib/gen.ts:159-164`, `lib/gen.ts:186-188`), and otherwise returns no docs through best-effort search/fetch helpers (`lib/scrape-context.ts:22-54`, `lib/scrape-context.ts:124-157`).
- `lib/supabase.ts` — optional server-side persistence. State: working optional no-op; requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, otherwise persist/list return false/empty (`lib/supabase.ts:18-29`, `lib/supabase.ts:49-87`).
- `lib/ai.ts` — model constants. State: working config, hardcoded; exports `anthropic/claude-opus-4-8` and `anthropic/claude-haiku-4-5` (`lib/ai.ts:1-12`).
- `data/generate.ts` — synthetic data and PNG generator. State: working dev script, not runtime; defines 10 theme specs, writes generated PNGs, and writes `data/ads.sample.csv` (`data/generate.ts:55-230`, `data/generate.ts:258-265`).
- `data/ads.sample.csv` — synthetic ad export. State: working sample data; includes required header and 42 creative rows across generated PNG thumbnails (`data/ads.sample.csv:1-43`).
- `eval/backtest.ts` — CLI backtest report. State: script present; reads sample CSV, calculates backtest, prints headline, CI, baselines, methodology (`eval/backtest.ts:1-44`).
- `types/model-viewer.d.ts` — JSX type shim. State: working; declares `<model-viewer>` props used by dashboard (`types/model-viewer.d.ts:1-17`, `app/dashboard.tsx:741-752`).
- `public/skins/generated/*.png` and `public/models/sample-skin.glb` — fallback assets. State: working fallbacks; generated PNGs are produced by `data/generate.ts` and referenced by concepts/data, while the GLB is returned by `to_3d` fallback (`data/generate.ts:258-262`, `lib/gen.ts:72-102`, `lib/gen.ts:202-207`).
- `public/skins/*.svg` — static skin SVGs. State: dead/static for current runtime; current CSV and concept fallbacks use `/skins/generated/*.png`, while SVG handling only remains as a possible thumbnail MIME branch (`data/ads.sample.csv:2-43`, `lib/gen.ts:72-102`, `lib/vision.ts:137-140`).
- `next.config.ts` — Next config. State: stubbed placeholder; exports an empty config with a comment for future project-specific config (`next.config.ts:1-8`).
- `package.json` — scripts/deps. State: working manifest; defines dev/build/start/lint/data/eval scripts and Next 16/React 19/AI SDK deps (`package.json:5-30`).

Doc-only, not implemented in this repo:
- Sim calibration over known hits/flops is doc-only; `STRATEGY.md` proposes it (`STRATEGY.md:82-83`), but `eval/backtest.ts` only runs the CSV backtest (`eval/backtest.ts:1-10`).
- Progress-job/polling UX is doc-only; `PLAN.md` proposes job status polling (`PLAN.md:140-142`), but `/api/generate` is one synchronous POST (`app/api/generate/route.ts:10-14`).
- Pipeline “current step pulses” is doc-only; `DESIGN.md` specifies it (`DESIGN.md:63-68`), but the UI only shows `Generating...` and renders the tool log after the pipeline result exists (`app/dashboard.tsx:556-579`).
- Generation caching is doc-only; `PLAN.md` asks for theme+prompt caching (`PLAN.md:127-132`), while `gen_skins` calls `generateSkinImage` directly for each concept (`lib/gen.ts:126-133`).
- Threads/Facebook scrape context is only partially implemented; `STRATEGY.md` names Threads/FB scrape (`STRATEGY.md:22-25`, `STRATEGY.md:57-59`), while code has generic TinyFish/MiroShark URL docs gated by `MIROSHARK_SCRAPE_ENABLED` (`lib/gen.ts:159-164`, `lib/scrape-context.ts:149-157`).
- Grand-plan Variant Studio is not implemented here by design; `VNG_GRAND_PLAN.md` says graft from this app into `vng-ab-test-agent` and add `proposeVariants` there (`../VNG_GRAND_PLAN.md:343-359`).

2. THE GRAFT

`lib/gen-adapters.ts` exports four public functions and no local types: `isNanoBananaEnabled(): boolean` (`lib/gen-adapters.ts:9-11`), `isMeshyEnabled(): boolean` (`lib/gen-adapters.ts:13-15`), `generateSkinImage(prompt: string): Promise<string | null>` (`lib/gen-adapters.ts:21-50`), and `imageTo3dModel(imageUrl: string): Promise<string | null>` (`lib/gen-adapters.ts:56-88`). It also has a private `sleep(ms)` helper (`lib/gen-adapters.ts:90-92`).

Fallback behavior is explicit but minimal: Nano Banana returns `null` when `NANO_BANANA_KEY` is missing (`lib/gen-adapters.ts:22-23`), and Meshy returns `null` when `MESHY_KEY` is missing (`lib/gen-adapters.ts:57-58`). The actual bundled fallback asset selection is not in this file; `lib/gen.ts` turns missing Nano output into bundled concept art (`lib/gen.ts:122-141`) and missing Meshy output into `/models/sample-skin.glb` (`lib/gen.ts:202-223`).

Quality: the adapter is transplant-friendly because it imports nothing from this app (`lib/gen-adapters.ts:1-92`). It is also loosely typed: both live APIs are parsed with ad hoc response shapes rather than schemas (`lib/gen-adapters.ts:41-46`, `lib/gen-adapters.ts:71-84`). Error handling is uneven: Nano non-OK throws with upstream body text (`lib/gen-adapters.ts:39`), Meshy create non-OK throws despite the comment promising `null` on job failure (`lib/gen-adapters.ts:52-55`, `lib/gen-adapters.ts:68-70`), and Meshy polling has a 240s deadline but no per-request abort controller (`lib/gen-adapters.ts:75-87`). The caller catches these errors and converts them to fallback reasons (`lib/gen.ts:131-140`, `lib/gen.ts:216-223`).

External dependencies for transplant:
- Env vars: `NANO_BANANA_KEY`, optional `NANO_BANANA_MODEL`, and `MESHY_KEY` (`lib/gen-adapters.ts:22-26`, `lib/gen-adapters.ts:57-60`; documented in `.env.example:24-29`).
- External APIs: Google Generative Language `generateContent` endpoint (`lib/gen-adapters.ts:25-33`) and Meshy image-to-3D endpoint (`lib/gen-adapters.ts:60-78`).
- Runtime APIs: global `fetch`, `AbortController`, `setTimeout`, `clearTimeout` (`lib/gen-adapters.ts:28-38`, `lib/gen-adapters.ts:47-49`, `lib/gen-adapters.ts:63-78`).
- Caller-side assets if preserving this app’s fallback behavior: `public/skins/generated/*.png` generated by `data/generate.ts` (`data/generate.ts:258-262`) and `/models/sample-skin.glb` used by `to_3d` (`lib/gen.ts:202-207`).
- Caller-side code if preserving labels/tool logs: `lib/gen.ts` consumes the adapter and attaches `source`/`fallbackReason` service metadata (`lib/gen.ts:1-8`, `lib/gen.ts:252-304`).

Transplant assessment: clean for Nano Banana image generation, less clean for Meshy. The grand plan specifically says to copy `lib/gen-adapters.ts` plus fallback PNG assets into `vng-ab-test-agent`, keep live Nano Banana/fallback behavior, and skip Meshy/3D (`../VNG_GRAND_PLAN.md:343-351`). For that target, copy only the Nano Banana functions or leave Meshy unused, and recreate the caller contract that turns `null`/errors into labeled fallback image cards.

3. PROD-READINESS ISSUES

- Uploaded CSV and agent chat disagree. Upload updates only client-side `analysis` (`app/dashboard.tsx:185-190`), but the agent route always reads `data/ads.sample.csv` (`app/api/agent/route.ts:35-36`), so after upload the chat can answer about different data than the charts.
- `/api/generate` has no top-level error handling around JSON parsing, Zod parsing, or pipeline exceptions; it directly parses and returns (`app/api/generate/route.ts:10-14`). The client displays raw response text on non-OK (`app/dashboard.tsx:165-171`).
- MiroShark live path can exceed route budgets. `/api/generate` and `/api/agent` set `maxDuration = 300` (`app/api/generate/route.ts:4`, `app/api/agent/route.ts:17`), while MiroShark graph build, prepare, and run timeouts default to 5, 10, and 10 minutes respectively (`lib/sim-client.ts:238`, `lib/sim-client.ts:274`, `lib/sim-client.ts:294`).
- Live simulation fans out dangerously: `runGenerationPipeline` scores all concepts with `Promise.all(concepts.map(simulate_reception))` (`lib/gen.ts:237-240`), so a configured MiroShark client may start multiple long simulations concurrently.
- History UX is misleading without Supabase. The dashboard says “run history is local-only” when unconfigured (`app/dashboard.tsx:203`), but `listAnalysisSnapshots` returns `[]` when Supabase is not configured (`lib/supabase.ts:72-73`); there is no local persistence implementation.
- Page visits can duplicate persisted snapshots. The home page fire-and-forgets `persistAnalysisSnapshot(snapshot)` on render (`app/page.tsx:15-16`), and the insert has no idempotency key or upsert guard (`lib/supabase.ts:52-61`).
- Upload lacks size/type hardening. The route only verifies `file instanceof File`, reads all text, and parses it (`app/api/upload/route.ts:5-16`); there is no size cap, MIME validation, or row-count guard.
- No obvious client-side secret leak found in source: server env secrets are converted to booleans before reaching the client (`app/page.tsx:25-29`, `app/dashboard.tsx:26-30`), and the Supabase service role is only read inside a server lib with an explicit server-only warning (`lib/supabase.ts:13-24`). However, upstream error messages can surface in UI fallback text because adapter errors are copied into `fallbackReason` (`lib/gen.ts:134-140`, `lib/gen.ts:219-223`) and rendered in tool/concept/model UI (`app/dashboard.tsx:575-598`, `app/dashboard.tsx:631-634`).
- Hardcoded operational values: model IDs in `lib/ai.ts` (`lib/ai.ts:8-12`), Nano model default and Google URL (`lib/gen-adapters.ts:25-26`), Meshy URL (`lib/gen-adapters.ts:60`), TinyFish URLs and batch size (`lib/scrape-context.ts:18-20`), bootstrap iterations/seed (`lib/analysis.ts:439-444`), and simulation personas `240` (`lib/gen.ts:171`).
- Dead/stale asset surface: runtime fallbacks use generated PNGs and GLB (`lib/gen.ts:72-102`, `lib/gen.ts:202-207`), while top-level `public/skins/*.svg` assets are not referenced by current CSV/concepts (`data/ads.sample.csv:2-43`, `lib/gen.ts:72-102`).

4. UX AUDIT

User flow: the first screen shows a masthead with service badges, headline recommendation, upload, past-runs, and generate buttons (`app/dashboard.tsx:212-285`). Past runs opens an inline history strip with close button, stored run cards, or empty state (`app/dashboard.tsx:287-315`). The analysis body shows portfolio metrics, a pLTV ROAS chart, recommendation rationale, theme map, holdout lift, baseline bars, and baseline selector table (`app/dashboard.tsx:317-538`). The Stage section has a pipeline button, empty state before generation, tool log and concept grid after generation, 3D placeholder/model viewer, and an agent console (`app/dashboard.tsx:541-690`). The model viewer uses `camera-controls` and `auto-rotate` once a pipeline exists (`app/dashboard.tsx:741-752`).

Friction and missing states:
- Generation has no in-progress step view: buttons switch to `Generating...` (`app/dashboard.tsx:276-277`, `app/dashboard.tsx:556-557`), but the tool log only renders after `pipeline` exists (`app/dashboard.tsx:567-579`).
- Agent has no mock chat fallback; without AI Gateway/OIDC, it is fully disabled with setup copy (`app/dashboard.tsx:650-658`, `app/api/agent/route.ts:27-33`).
- Agent input has no visible label, placeholder, or `aria-label`; it is rendered as a bare controlled `<input>` (`app/dashboard.tsx:673-685`).
- Concept art uses empty alt text even though the images identify generated concepts (`app/dashboard.tsx:581-599`).
- Fallback reasons in service badges rely on a `title` attribute on a small “fallback” label (`app/dashboard.tsx:707-710`), which is weak for keyboard/touch discovery.
- Status/error text is not announced with `aria-live`; upload status, history status, generation error, and agent error are plain text nodes (`app/dashboard.tsx:284`, `app/dashboard.tsx:299`, `app/dashboard.tsx:566`, `app/dashboard.tsx:672`).
- Primary controls have `min-height: 40px`, below the common 44px mobile touch target convention (`app/globals.css:267-275`).
- Chart data is visual-first; Recharts render the chart panels (`app/dashboard.tsx:359-383`, `app/dashboard.tsx:440-470`), and the role key is `aria-hidden` (`app/dashboard.tsx:384-401`). The baseline table helps, but there is no complete non-visual table for the chart data.

5. TOP 5 FEATURE/HARVEST SUGGESTIONS

1. Nano Banana adapter + fallback image cards — worth grafting because Phase 5 needs generated variant images with graceful no-key behavior; use `generateSkinImage` and copy generated PNG fallbacks, not the full app. Effort: S. Evidence: `lib/gen-adapters.ts:21-47`, `data/generate.ts:258-262`, `../VNG_GRAND_PLAN.md:348-351`.
2. Provenance badges and fallback reasons — keep the “live/mock/fallback” honesty model in the combined demo so judges can trust the pipeline under missing keys. Effort: S/M. Evidence: `app/dashboard.tsx:217-240`, `lib/gen.ts:252-304`.
3. Tool-log timeline pattern — harvest the structured `gen_skins → simulate_reception → pick_best → to_3d` log shape, but make it live-updating in `vng-ab-test-agent` instead of post-response only. Effort: M. Evidence: `lib/gen.ts:272-304`, `app/dashboard.tsx:567-579`.
4. Evidence-first copy and baseline table discipline — the pLTV dashboard’s baselines/CI/p-value pattern is a good narrative model for the A/B product’s stats readout. Effort: M. Evidence: `lib/analysis.ts:352-398`, `app/dashboard.tsx:489-535`.
5. 3D reveal as optional polish, not Phase 5 core — this app’s `<model-viewer>` stage is demo-friendly, but the grand plan explicitly says skip Meshy/3D for Variant Studio. Effort: L if revived later. Evidence: `app/dashboard.tsx:621-634`, `app/dashboard.tsx:741-752`, `../VNG_GRAND_PLAN.md:348-351`.