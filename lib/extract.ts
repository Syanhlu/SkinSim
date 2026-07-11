import { generateObject } from "ai";
import { z } from "zod";
import { AGENT_MODEL } from "./ai";
import { parseHypothesis, type ParsedHypothesis } from "./experiment";

/**
 * LLM-backed hypothesis extraction (VNG_GRAND_PLAN §3.3). The model only chooses the
 * metric framing — every downstream number still comes from lib/stats.ts. When no AI
 * credentials are configured, or extraction fails or returns nonsense, we fall back to
 * the deterministic keyword parser and label the source so the UI can show
 * "extracted by agent" vs "heuristic".
 */

export type BriefSource = "agent" | "heuristic";

/** The editable-brief shape the UI renders as a confirmation form. */
export interface HypothesisBrief extends ParsedHypothesis {
  source: BriefSource;
}

const extractionSchema = z.object({
  metric: z.string().min(1).describe("Short display name of the primary metric, e.g. 'Purchase conversion'"),
  metricType: z
    .enum(["binary", "continuous", "count", "ordinal"])
    .describe("binary = per-user yes/no (conversion, retention); continuous = amounts (ARPU); count = event rates (crashes)"),
  unit: z.string().min(1).describe("Unit of observation, e.g. 'players converted', 'USD/player', 'sessions'"),
  direction: z.enum(["increase", "decrease"]).describe("The direction the hypothesis wants the metric to move"),
  baselineGuess: z
    .number()
    .describe("Plausible current level. Rates as fractions in (0,1); continuous in the metric's unit"),
  mdeGuess: z
    .number()
    .describe("Minimum detectable effect worth acting on, in absolute units (negative when direction is decrease)"),
  rationale: z.string().min(1).describe("One sentence: why this metric/test framing fits the hypothesis"),
});

export type ExtractedHypothesis = z.infer<typeof extractionSchema>;

const SYSTEM = `You turn a product/LiveOps A/B-test hypothesis into a measurement brief.
Pick the single primary metric the hypothesis is really about, its statistical type, and
honest starter guesses for baseline and minimum detectable effect. These seeds a power
analysis and will be confirmed/edited by a human operator — never invent precision.
If the hypothesis is about revenue/spend use a continuous metric; retention/conversion
are binary; crashes/errors/latency incidents are count rates.`;

export async function extractHypothesis(text: string): Promise<HypothesisBrief> {
  if (!hasAiCredentials()) {
    return heuristicBrief(text);
  }

  try {
    const { object } = await generateObject({
      model: AGENT_MODEL,
      schema: extractionSchema,
      system: SYSTEM,
      prompt: `Hypothesis: ${text}`,
    });

    if (!isSane(object)) {
      return heuristicBrief(text);
    }

    return {
      text,
      metric: object.metric,
      metricType: object.metricType,
      unit: object.unit,
      direction: object.direction,
      baseline: object.baselineGuess,
      mdeGuess: object.mdeGuess,
      // Continuous power analysis needs a std-dev assumption; keep the same default
      // the deterministic parser uses so both paths seed identical power math.
      stdGuess: object.metricType === "continuous" ? 2.1 : undefined,
      rationale: object.rationale,
      source: "agent",
    };
  } catch {
    return heuristicBrief(text);
  }
}

/** Deterministic fallback: the original keyword parser, labeled as such. */
export function heuristicBrief(text: string): HypothesisBrief {
  return { ...parseHypothesis(text), source: "heuristic" };
}

// Reject extractions that would break the power analysis or are obviously wrong,
// instead of silently clamping them into a misleading brief.
function isSane(object: ExtractedHypothesis): boolean {
  if (!Number.isFinite(object.baselineGuess) || object.baselineGuess < 0) return false;
  if (!Number.isFinite(object.mdeGuess) || object.mdeGuess === 0) return false;
  if (object.metricType !== "continuous" && (object.baselineGuess <= 0 || object.baselineGuess >= 1)) return false;
  if (object.metricType !== "continuous" && Math.abs(object.mdeGuess) >= 1) return false;
  return true;
}

function hasAiCredentials(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL || process.env.VERCEL_ENV);
}
