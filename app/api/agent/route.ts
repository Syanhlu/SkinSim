import {
  streamText,
  tool,
  stepCountIs,
  convertToModelMessages,
  safeValidateUIMessages,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { AGENT_MODEL } from "@/lib/ai";
import {
  checkGuardrails,
  designTest,
  parseHypothesis,
  recommend,
  type Direction,
} from "@/lib/experiment";
import { extractHypothesis } from "@/lib/extract";
import { generateExperimentResults, getSimClient, normalizeScenario } from "@/lib/sim-client";
import { powerAnalysis, significanceTest, type ExperimentResults } from "@/lib/stats";

export const maxDuration = 60;

const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 50;
const MAX_TEXT_CHARS = 64 * 1024;

const SYSTEM = `You are the VNG P11 A/B Test Design & Readout Agent.

Your job is to orchestrate deterministic tools for LiveOps experiment design and readout.
Never compute statistics in your own text. All sample sizes, p-values, confidence intervals,
effect sizes, guardrail states, and ship/iterate/kill recommendations must come from tools.

Default chain:
1. parse_hypothesis
2. power_analysis
3. design_test
4. significance_test
5. check_guardrails
6. recommend

If a user asks for a trap case, use scenario underpowered, peeking, novelty, guardrail, or flat.
Always explain which statistical test was selected and why, but quote only tool-returned numbers.

To actually run a synthetic experiment, call run_experiment (returns a job) and then poll
get_experiment_status to narrate progress; when it is complete the status tool returns the
results plus the deterministic significance readout — quote those numbers only.`;

const scenarioSchema = z.enum(["ship", "underpowered", "peeking", "novelty", "guardrail", "flat"]);
const metricTypeSchema = z.enum(["binary", "continuous", "count", "ordinal"]);

const resultsSchema = z
  .object({
    id: z.string(),
    metric: z.string(),
    metricType: metricTypeSchema,
    primaryUnit: z.string(),
    alpha: z.number(),
    requiredSampleSizePerVariant: z.number(),
    plannedDays: z.number(),
    observedDays: z.number(),
    peeking: z.boolean().optional(),
    noveltyRisk: z.boolean().optional(),
    notes: z.array(z.string()).optional(),
    variants: z.tuple([
      z.object({
        name: z.string(),
        visitors: z.number(),
        conversions: z.number().optional(),
        mean: z.number().optional(),
        standardDeviation: z.number().optional(),
        samples: z.array(z.number()).optional(),
        events: z.number().optional(),
        exposure: z.number().optional(),
      }),
      z.object({
        name: z.string(),
        visitors: z.number(),
        conversions: z.number().optional(),
        mean: z.number().optional(),
        standardDeviation: z.number().optional(),
        samples: z.array(z.number()).optional(),
        events: z.number().optional(),
        exposure: z.number().optional(),
      }),
    ]),
    guardrails: z.array(
      z.object({
        name: z.string(),
        unit: z.string(),
        direction: z.enum(["increase", "decrease"]),
        control: z.number(),
        treatment: z.number(),
        threshold: z.number(),
        severity: z.enum(["watch", "critical"]),
      }),
    ),
  })
  .optional();

export async function POST(req: Request) {
  const parsed = await parseAgentRequest(req);
  if (parsed instanceof Response) return parsed;

  if (!hasGatewayCredentials()) {
    return jsonError(
      503,
      "missing_ai_gateway_credentials",
      "AI Gateway credentials are not configured. Set AI_GATEWAY_API_KEY locally or run on Vercel with OIDC enabled.",
    );
  }

  try {
    const result = streamText({
      model: AGENT_MODEL,
      system: SYSTEM,
      messages: convertToModelMessages(parsed.messages),
      tools: {
        parse_hypothesis: tool({
          description:
            "Extract a natural-language experiment hypothesis into metric, unit, direction, baseline, and MDE. Uses LLM structured extraction with a deterministic heuristic fallback; the returned `source` field says which one produced the brief.",
          inputSchema: z.object({ text: z.string() }),
          execute: async ({ text }) => extractHypothesis(text),
        }),
        power_analysis: tool({
          description: "Compute required sample size and duration using a real two-proportion power formula.",
          inputSchema: z.object({
            baseline: z.number(),
            mde: z.number(),
            alpha: z.number().default(0.05),
            power: z.number().default(0.8),
            dailyTraffic: z.number().default(1600),
          }),
          execute: async (input) => powerAnalysis(input),
        }),
        design_test: tool({
          description: "Create the randomized test brief with variants, allocation, guardrails, and stop conditions.",
          inputSchema: z.object({
            hypothesis: z.string(),
            dailyTraffic: z.number().default(1600),
          }),
          execute: async ({ hypothesis, dailyTraffic }) => designTest(parseHypothesis(hypothesis), dailyTraffic),
        }),
        significance_test: tool({
          description:
            "Run the correct statistical readout. Uses MiroShark mock data when explicit results are not supplied.",
          inputSchema: z.object({
            hypothesis: z.string().default("A red Buy button will lift purchase conversion."),
            scenario: scenarioSchema.default("ship"),
            results: resultsSchema,
          }),
          execute: async ({ hypothesis, scenario, results }) => {
            const resultSet = results ?? (await generateScenarioResults(hypothesis, scenario));
            return {
              results: resultSet,
              significance: significanceTest(resultSet as ExperimentResults),
            };
          },
        }),
        propose_variants: tool({
          description:
            "Propose 2-3 English ad-copy variants (price/social/novelty angles) with strategy notes for a hypothesis. Labeled 'agent' or deterministic 'fallback'. The human edits before launch.",
          inputSchema: z.object({
            hypothesis: z.string(),
            metric: z.string().optional(),
            direction: z.string().optional(),
          }),
          execute: async ({ hypothesis, metric, direction }) => {
            const { proposeVariants } = await import("@/lib/creative/variants");
            return proposeVariants(hypothesis, { metric, direction });
          },
        }),
        run_experiment: tool({
          description:
            "Create a synthetic A/B experiment job (real MiroShark engine when configured, deterministic mock otherwise). Returns { experimentId, status } — poll with get_experiment_status.",
          inputSchema: z.object({
            hypothesis: z.string(),
            variants: z
              .array(z.object({ name: z.string(), text: z.string() }))
              .min(2)
              .default([
                { name: "control", text: "Current LiveOps experience." },
                { name: "treatment", text: "Proposed change from the hypothesis." },
              ]),
            scenario: scenarioSchema.default("ship"),
          }),
          execute: async ({ hypothesis, variants, scenario }) => {
            const parsed = parseHypothesis(hypothesis);
            const design = designTest(parsed);
            return getSimClient().createExperiment({
              hypothesis,
              variants,
              demoScenario: normalizeScenario(scenario),
              metric: parsed.metric,
              metricType: parsed.metricType,
              unit: parsed.unit,
              alpha: design.power.alpha,
              requiredSampleSizePerVariant: design.power.sampleSizePerVariant,
              plannedDays: design.power.durationDays,
            });
          },
        }),
        get_experiment_status: tool({
          description:
            "Poll a running experiment job. While preparing/running, returns progress to narrate. When complete, also returns the results and the deterministic significance readout.",
          inputSchema: z.object({ experimentId: z.string() }),
          execute: async ({ experimentId }) => {
            const client = getSimClient();
            const job = await client.getStatus(experimentId);
            if (job.status !== "complete") return { job };
            const results = await client.getResults(experimentId);
            return { job, results, significance: significanceTest(results) };
          },
        }),
        check_guardrails: tool({
          description: "Check retention, spend, crash, underpowered, peeking, and novelty traps.",
          inputSchema: z.object({
            hypothesis: z.string().default("A red Buy button will lift purchase conversion."),
            scenario: scenarioSchema.default("ship"),
            results: resultsSchema,
          }),
          execute: async ({ hypothesis, scenario, results }) => {
            const resultSet = results ?? (await generateScenarioResults(hypothesis, scenario));
            return checkGuardrails(resultSet as ExperimentResults);
          },
        }),
        recommend: tool({
          description: "Return ship, iterate, or kill using the deterministic decision rule.",
          inputSchema: z.object({
            hypothesis: z.string().default("A red Buy button will lift purchase conversion."),
            desiredDirection: z.enum(["increase", "decrease"]).default("increase"),
            scenario: scenarioSchema.default("ship"),
            results: resultsSchema,
          }),
          execute: async ({ hypothesis, desiredDirection, scenario, results }) => {
            const resultSet = results ?? (await generateScenarioResults(hypothesis, scenario));
            const significance = significanceTest(resultSet as ExperimentResults);
            const guardrails = checkGuardrails(resultSet as ExperimentResults);
            return recommend({
              desiredDirection: desiredDirection as Direction,
              significance,
              guardrails,
              results: resultSet as ExperimentResults,
            });
          },
        }),
      },
      // run_experiment + ~8 status polls + readout tools need more steps than the old chain.
      stopWhen: stepCountIs(16),
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => `Agent stream failed: ${publicErrorMessage(error)}`,
    });
  } catch (error) {
    return jsonError(500, "agent_stream_failed", `Agent stream failed: ${publicErrorMessage(error)}`);
  }
}

export function GET() {
  return jsonError(405, "method_not_allowed", "Use POST with an AI SDK UIMessage JSON body.", {
    Allow: "POST",
  });
}

// Deterministic mock-path results for tools that need immediate data (the async job
// interface is exposed separately via run_experiment/get_experiment_status).
async function generateScenarioResults(hypothesis: string, scenario: z.infer<typeof scenarioSchema>) {
  const parsed = parseHypothesis(hypothesis);
  const design = designTest(parsed);
  return generateExperimentResults({
    hypothesis,
    scenario: normalizeScenario(scenario),
    metric: parsed.metric,
    metricType: parsed.metricType,
    unit: parsed.unit,
    alpha: design.power.alpha,
    requiredSampleSizePerVariant: design.power.sampleSizePerVariant,
    plannedDays: design.power.durationDays,
  });
}

async function parseAgentRequest(req: Request): Promise<{ messages: UIMessage[] } | Response> {
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
    return jsonError(400, "empty_body", "Request body must be a JSON object with a messages array.");
  }

  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return jsonError(413, "payload_too_large", `Request body must be at most ${MAX_BODY_BYTES} bytes.`);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonError(400, "invalid_json", "Request body must be valid JSON.");
  }

  if (!isRecord(body)) {
    return jsonError(400, "invalid_body", "Request body must be a JSON object.");
  }

  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return jsonError(400, "invalid_messages", "messages must be an array of AI SDK UIMessage objects.");
  }

  if (messages.length === 0) {
    return jsonError(400, "empty_messages", "messages must include at least one UIMessage.");
  }

  if (messages.length > MAX_MESSAGES) {
    return jsonError(413, "too_many_messages", `messages must include at most ${MAX_MESSAGES} items.`);
  }

  const validation = await safeValidateUIMessages<UIMessage>({ messages });
  if (!validation.success) {
    return jsonError(400, "invalid_messages", `Invalid AI SDK UIMessage array: ${validation.error.message}`);
  }

  if (countTextChars(validation.data) > MAX_TEXT_CHARS) {
    return jsonError(413, "message_too_large", `Total text content must be at most ${MAX_TEXT_CHARS} characters.`);
  }

  return { messages: validation.data };
}

function countTextChars(messages: UIMessage[]): number {
  return messages.reduce(
    (messageTotal, message) =>
      messageTotal +
      message.parts.reduce((partTotal, part) => {
        if (part.type === "text") return partTotal + part.text.length;
        return partTotal;
      }, 0),
    0,
  );
}

function hasGatewayCredentials(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL || process.env.VERCEL_ENV);
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

function publicErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unexpected agent error.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
