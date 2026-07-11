import { streamText, tool, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { z } from "zod";
import { AGENT_MODEL } from "@/lib/ai";
import {
  checkGuardrails,
  designTest,
  parseHypothesis,
  recommend,
  type Direction,
} from "@/lib/experiment";
import { getSimClient, normalizeScenario } from "@/lib/sim-client";
import { powerAnalysis, significanceTest, type ExperimentResults } from "@/lib/stats";

export const maxDuration = 60;

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
Always explain which statistical test was selected and why, but quote only tool-returned numbers.`;

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
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: AGENT_MODEL,
    system: SYSTEM,
    messages: convertToModelMessages(messages),
    tools: {
      parse_hypothesis: tool({
        description: "Parse a natural-language experiment hypothesis into metric, unit, direction, baseline, and MDE.",
        inputSchema: z.object({ text: z.string() }),
        execute: async ({ text }) => parseHypothesis(text),
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
          const parsed = parseHypothesis(hypothesis);
          const design = designTest(parsed);
          const resultSet =
            results ??
            (await getSimClient().generateExperimentResults({
              hypothesis,
              scenario: normalizeScenario(scenario),
              metric: parsed.metric,
              metricType: parsed.metricType,
              unit: parsed.unit,
              alpha: design.power.alpha,
              requiredSampleSizePerVariant: design.power.sampleSizePerVariant,
              plannedDays: design.power.durationDays,
            }));
          return {
            results: resultSet,
            significance: significanceTest(resultSet as ExperimentResults),
          };
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
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse();
}

async function generateScenarioResults(hypothesis: string, scenario: z.infer<typeof scenarioSchema>) {
  const parsed = parseHypothesis(hypothesis);
  const design = designTest(parsed);
  return getSimClient().generateExperimentResults({
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
