import { checkGuardrails, designTest, evaluateExperiment, parseHypothesis, recommend } from "../lib/experiment";
import { MockSimClient, type ExperimentJob } from "../lib/sim-client";
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

// The mock job lifecycle must reach "complete" within this many status polls (plan §3.1
// says ~8); the eval allows a little slack but fails if a job never completes.
const MAX_POLLS = 12;

/**
 * The API agent orchestrates tools; it must never compute a statistic itself. Hypothesis
 * extraction is now LLM-backed (lib/extract.ts) and confirmed by a human, so this guard
 * pins everything DOWNSTREAM of a confirmed brief: it uses the deterministic heuristic
 * brief (parseHypothesis) as the confirmed input, drives the async mock job interface the
 * agent's run_experiment/get_experiment_status tools use (create → poll → results), and
 * asserts the readout is numerically identical to the deterministic evaluateExperiment()
 * path — so if the model ever "helped" with math, or the two paths drifted, the eval
 * fails. Fully offline and deterministic.
 */
export async function runAgentConsistency(): Promise<ConsistencyResult[]> {
  const sim = new MockSimClient();
  const results: ConsistencyResult[] = [];

  for (const hypothesis of HYPOTHESES) {
    for (const scenario of SCENARIOS) {
      const truth = evaluateExperiment(hypothesis, scenario);

      // Exactly what the agent's tools execute, step by step, on the confirmed brief.
      const parsed = parseHypothesis(hypothesis);
      const design = designTest(parsed);

      // run_experiment tool path: async job over the mock engine.
      const job = await sim.createExperiment({
        hypothesis,
        variants: [
          { name: "control", text: "Current LiveOps experience." },
          { name: "treatment", text: "Proposed change from the hypothesis." },
        ],
        demoScenario: scenario,
        metric: parsed.metric,
        metricType: parsed.metricType,
        unit: parsed.unit,
        alpha: design.power.alpha,
        requiredSampleSizePerVariant: design.power.sampleSizePerVariant,
        plannedDays: design.power.durationDays,
      });

      // get_experiment_status tool path: poll until complete.
      let status: ExperimentJob = job;
      let polls = 0;
      while (status.status !== "complete" && polls < MAX_POLLS) {
        status = await sim.getStatus(job.experimentId);
        polls += 1;
      }

      if (status.status !== "complete") {
        results.push({
          id: `${parsed.metricType}/${scenario}`,
          passed: false,
          detail: `job never completed: still ${status.status} after ${polls} polls`,
        });
        continue;
      }

      const observed = await sim.getResults(job.experimentId);
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
          ? `agent tool chain == evaluateExperiment (job completed in ${polls} polls)`
          : `MISMATCH p=${significance.pValue} vs ${truth.significance.pValue}, decision=${recommendation.decision} vs ${truth.recommendation.decision}`,
      });
    }
  }

  return results;
}
