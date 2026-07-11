import { z } from "zod";
import { extractHypothesis } from "@/lib/extract";
import { getSimClient, normalizeScenario, SimClientError, type SimClient } from "@/lib/sim-client";

/**
 * Server proxy for the sim engine (VNG_GRAND_PLAN §3.2). The MiroShark internal key
 * stays server-side; the browser only ever talks to this route.
 *
 *   POST /api/experiment                 → create job  { hypothesis, variants, ... }
 *   POST /api/experiment {action:extract}→ extract an editable brief from a hypothesis
 *   GET  /api/experiment?id=...          → job status
 *   GET  /api/experiment?id=...&results=1→ results (409 until complete)
 *
 * `?sim=mock` on any call forces the deterministic MockSimClient (stage safety).
 */

export const maxDuration = 30;

const MAX_BODY_BYTES = 64 * 1024;

const metricTypeSchema = z.enum(["binary", "continuous", "count", "ordinal"]);

const createSchema = z.object({
  action: z.literal("create").optional(),
  hypothesis: z.string().min(1).max(2000),
  variants: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        text: z.string().max(2000).default(""),
      }),
    )
    .min(2)
    .max(6),
  scenario: z.string().max(20000).optional(),
  parentSimulationId: z.string().max(200).optional(),
  replicates: z.number().int().min(1).max(10).optional(),
  parallel: z.number().int().min(1).max(4).optional(),
  demoScenario: z.string().max(40).optional(),
  metric: z.string().max(120).optional(),
  metricType: metricTypeSchema.optional(),
  unit: z.string().max(120).optional(),
  alpha: z.number().gt(0).lt(1).optional(),
  requiredSampleSizePerVariant: z.number().int().min(0).optional(),
  plannedDays: z.number().int().min(1).max(365).optional(),
});

const extractSchema = z.object({
  action: z.literal("extract"),
  hypothesis: z.string().min(1).max(2000),
});

const variantsSchema = z.object({
  action: z.literal("variants"),
  hypothesis: z.string().min(1).max(2000),
  metric: z.string().max(120).optional(),
  direction: z.string().max(40).optional(),
});

const scrapeSchema = z.object({
  action: z.literal("scrape"),
  searchQuery: z.string().max(200).optional(),
  referenceUrls: z.array(z.string().url()).max(10).optional(),
});

export async function POST(req: Request) {
  const bodyOrError = await readJsonBody(req);
  if (bodyOrError instanceof Response) return bodyOrError;
  const body = bodyOrError;

  // Brief extraction: server-side so the AI key never reaches the browser. Falls
  // back to the deterministic heuristic parser (labeled) when no key is set.
  if (isRecord(body) && body.action === "extract") {
    const parsed = extractSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, "invalid_body", formatZodError(parsed.error));
    }
    try {
      const brief = await extractHypothesis(parsed.data.hypothesis);
      return jsonOk({ brief });
    } catch (error) {
      return jsonError(500, "extract_failed", publicErrorMessage(error));
    }
  }

  // Variant proposal: server-side LLM (or deterministic fallback, labeled) —
  // same key-stays-server-side posture as extraction.
  if (isRecord(body) && body.action === "variants") {
    const parsed = variantsSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, "invalid_body", formatZodError(parsed.error));
    }
    const { proposeVariants } = await import("@/lib/creative/variants");
    const proposal = await proposeVariants(parsed.data.hypothesis, {
      metric: parsed.data.metric,
      direction: parsed.data.direction,
    });
    return jsonOk(proposal);
  }

  // Web research: server-side so TinyFish/MiroShark URLs never reach the browser.
  // Best-effort by design (buildScrapeContext never throws) — returns fewer docs
  // rather than failing when nothing is configured or a fetch fails.
  if (isRecord(body) && body.action === "scrape") {
    const parsed = scrapeSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, "invalid_body", formatZodError(parsed.error));
    }
    const { searchQuery, referenceUrls } = parsed.data;
    if (!searchQuery?.trim() && !referenceUrls?.length) {
      return jsonError(400, "invalid_body", "Provide a searchQuery or at least one referenceUrl.");
    }
    const { buildScrapeContext } = await import("@/lib/miroshark/scrape-context");
    const docs = await buildScrapeContext({ searchQuery, referenceUrls, maxDocs: 5, maxCharsPerDoc: 1200 });
    return jsonOk({ docs });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid_body", formatZodError(parsed.error));
  }

  const client = clientFor(req);
  const input = {
    hypothesis: parsed.data.hypothesis,
    variants: parsed.data.variants,
    scenario: parsed.data.scenario,
    parentSimulationId: parsed.data.parentSimulationId,
    replicates: parsed.data.replicates,
    parallel: parsed.data.parallel,
    demoScenario: parsed.data.demoScenario === undefined ? undefined : normalizeScenario(parsed.data.demoScenario),
    metric: parsed.data.metric,
    metricType: parsed.data.metricType,
    unit: parsed.data.unit,
    alpha: parsed.data.alpha,
    requiredSampleSizePerVariant: parsed.data.requiredSampleSizePerVariant,
    plannedDays: parsed.data.plannedDays,
  };

  try {
    const job = await client.createExperiment(input);
    return jsonOk(job, 202);
  } catch (error) {
    // Grand-plan constraint #2: everything must demo with MiroShark down. A
    // transport-level failure (engine configured but unreachable / bad gateway)
    // falls back to the mock engine, labeled so the UI can say so and keep
    // polling with ?sim=mock. Validation errors (4xx) still surface.
    if (isEngineUnreachable(error)) {
      try {
        const job = await getSimClient({ sim: "mock" }).createExperiment(input);
        return jsonOk({ ...job, engine: "mock", engineNote: "Live engine unreachable, ran the instant simulated preview instead" }, 202);
      } catch {
        return simError(error, "create_failed");
      }
    }
    return simError(error, "create_failed");
  }
}

function isEngineUnreachable(error: unknown): boolean {
  if (error instanceof SimClientError) {
    return error.status === undefined || error.status >= 500;
  }
  return error instanceof TypeError || error instanceof Error;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return jsonError(400, "missing_id", "Query parameter ?id=<experimentId> is required.");
  }

  const wantResults = url.searchParams.get("results") === "1";
  const client = clientFor(req);

  try {
    if (wantResults) {
      const results = await client.getResults(id);
      return jsonOk({ results });
    }
    const job = await client.getStatus(id);
    return jsonOk(job);
  } catch (error) {
    return simError(error, wantResults ? "results_failed" : "status_failed");
  }
}

export function PUT() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function clientFor(req: Request): SimClient {
  const sim = new URL(req.url).searchParams.get("sim");
  return getSimClient({ sim });
}

async function readJsonBody(req: Request): Promise<unknown | Response> {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return jsonError(415, "unsupported_media_type", "Content-Type must be application/json.");
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonError(413, "payload_too_large", `Request body must be at most ${MAX_BODY_BYTES} bytes.`);
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return jsonError(400, "body_read_failed", "Request body could not be read.");
  }

  if (rawBody.trim().length === 0) {
    return jsonError(400, "empty_body", "Request body must be a JSON object.");
  }

  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return jsonError(413, "payload_too_large", `Request body must be at most ${MAX_BODY_BYTES} bytes.`);
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return jsonError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

function methodNotAllowed() {
  return jsonError(405, "method_not_allowed", "Use POST to create/extract or GET ?id= for status/results.", {
    Allow: "GET, POST",
  });
}

function simError(error: unknown, fallbackCode: string) {
  if (error instanceof SimClientError) {
    return jsonError(error.status, error.code, error.message);
  }
  return jsonError(500, fallbackCode, publicErrorMessage(error));
}

function jsonOk(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function jsonError(status: number, code: string, message: string, headers?: Record<string, string>) {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...headers,
      },
    },
  );
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}

function publicErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unexpected experiment API error.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
