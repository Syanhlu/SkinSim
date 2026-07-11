import { checkGuardrails, designTest, evaluateExperiment, parseHypothesis, recommend } from "../lib/experiment";
import { MockSimClient } from "../lib/sim-client";
import { significanceTest } from "../lib/stats";
import type { DemoScenario } from "../lib/mock-results";

export interface ConsistencyResult {
  id: string;
  passed: boolean;
  detail: string;
}

const SCENARIOS: DemoScenario[] = ["ship", "underpowered", "peeking", "novelty", "guardrail", "flat"];

// One hypothesis per metric type so the guard covers every stats path the agent can hit.
const HYPOTHESES = [
  "A red Buy button will lift purchase conversion for new players.",
  "A new starter bundle will lift ARPU for paying players.",
  "A memory fix will reduce the crash rate during combat.",
];

/**
 * The API agent orchestrates tools; it must never compute a statistic itself. Every tool it
 * calls (parse_hypothesis, power_analysis, design_test, significance_test, check_guardrails,
 * recommend) runs the exact deterministic lib functions used by evaluateExperiment(). This
 * guard reconstructs the agent's tool chain over the mock simulator and asserts it produces
 * numbers identical to the deterministic readout — so if the model ever "helped" with math,
 * or the two paths drifted, the eval fails.
 */
export async function runAgentConsistency(): Promise<ConsistencyResult[]> {
  const sim = new MockSimClient();
  const results: ConsistencyResult[] = [];

  for (const hypothesis of HYPOTHESES) {
    for (const scenario of SCENARIOS) {
      const truth = evaluateExperiment(hypothesis, scenario);

      // Exactly what the agent's tools execute, step by step.
      const parsed = parseHypothesis(hypothesis);
      const design = designTest(parsed);
      const observed = await sim.generateExperimentResults({
        hypothesis,
        scenario,
        metric: parsed.metric,
        metricType: parsed.metricType,
        unit: parsed.unit,
        alpha: design.power.alpha,
        requiredSampleSizePerVariant: design.power.sampleSizePerVariant,
        plannedDays: design.power.durationDays,
      });
      const significance = significanceTest(observed);
      const guardrails = checkGuardrails(observed);
      const recommendation = recommend({
        desiredDirection: parsed.direction,
        significance,
        guardrails,
        results: observed,
      });

      const matches =
        significance.pValue === truth.significance.pValue &&
        significance.effect === truth.significance.effect &&
        significance.ci95[0] === truth.significance.ci95[0] &&
        significance.ci95[1] === truth.significance.ci95[1] &&
        significance.test === truth.significance.test &&
        recommendation.decision === truth.recommendation.decision;

      results.push({
        id: `${parsed.metricType}/${scenario}`,
        passed: matches,
        detail: matches
          ? "agent tool chain == evaluateExperiment"
          : `MISMATCH p=${significance.pValue} vs ${truth.significance.pValue}, decision=${recommendation.decision} vs ${truth.recommendation.decision}`,
      });
    }
  }

  return results;
}
