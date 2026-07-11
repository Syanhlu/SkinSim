import { createMockExperimentResults, type DemoScenario } from "./mock-results";
import {
  continuousPowerAnalysis,
  powerAnalysis,
  round,
  significanceTest,
  type ExperimentResults,
  type GuardrailObservation,
  type MetricType,
  type PowerAnalysisResult,
  type SignificanceResult,
} from "./stats";

export type Direction = "increase" | "decrease";
export type Decision = "ship" | "iterate" | "kill";

export interface ParsedHypothesis {
  text: string;
  metric: string;
  metricType: MetricType;
  unit: string;
  direction: Direction;
  baseline: number;
  mdeGuess: number;
  /** Assumed population std dev — only used by continuous power analysis. */
  stdGuess?: number;
  rationale: string;
}

export interface TestDesign {
  hypothesis: ParsedHypothesis;
  power: PowerAnalysisResult;
  variants: Array<{ name: string; description: string }>;
  allocation: string;
  guardrails: string[];
  stopConditions: string[];
}

export interface GuardrailCheck {
  name: string;
  status: "pass" | "watch" | "fail";
  delta: number;
  threshold: number;
  severity: GuardrailObservation["severity"];
  rationale: string;
}

export interface GuardrailReport {
  passed: boolean;
  checks: GuardrailCheck[];
  traps: string[];
}

export interface Recommendation {
  decision: Decision;
  confidence: number;
  rationale: string;
  caveats: string[];
}

export interface ToolTraceItem {
  tool: string;
  input: unknown;
  output: unknown;
}

export interface ExperimentEvaluation {
  parsed: ParsedHypothesis;
  design: TestDesign;
  results: ExperimentResults;
  significance: SignificanceResult;
  guardrails: GuardrailReport;
  recommendation: Recommendation;
  toolTrace: ToolTraceItem[];
}

export function parseHypothesis(text: string): ParsedHypothesis {
  const lower = text.toLowerCase();

  if (lower.includes("arpu") || lower.includes("revenue") || lower.includes("spend")) {
    return {
      text,
      metric: "ARPU",
      metricType: "continuous",
      unit: "USD/player",
      direction: lower.includes("reduce") || lower.includes("lower") ? "decrease" : "increase",
      baseline: 1.2,
      mdeGuess: 0.08,
      stdGuess: 2.1,
      rationale: "Revenue language maps to ARPU, so use a continuous readout and protect payer-quality guardrails.",
    };
  }

  if (lower.includes("retention") || lower.includes("d7") || lower.includes("day 7")) {
    return {
      text,
      metric: "D7 retention",
      metricType: "binary",
      unit: "players retained",
      direction: lower.includes("reduce") || lower.includes("lower") ? "decrease" : "increase",
      baseline: 0.38,
      mdeGuess: 0.025,
      rationale: "Retention is a binary player outcome, so the design uses a two-proportion power calculation.",
    };
  }

  if (lower.includes("crash") || lower.includes("latency") || lower.includes("error")) {
    return {
      text,
      metric: "Crash rate",
      metricType: "count",
      unit: "sessions",
      direction: "decrease",
      baseline: 0.009,
      mdeGuess: -0.003,
      rationale: "Reliability hypotheses are count/rate problems and should only ship when the treatment moves down.",
    };
  }

  return {
    text,
    metric: "Purchase conversion",
    metricType: "binary",
    unit: "players converted",
    direction: "increase",
    baseline: 0.06,
    mdeGuess: 0.01,
    rationale: "Purchase language maps to conversion, so the design uses a two-proportion test with player-level randomization.",
  };
}

export function designTest(parsed: ParsedHypothesis, dailyTraffic = 1600): TestDesign {
  const power =
    parsed.metricType === "continuous"
      ? continuousPowerAnalysis({
          baseline: parsed.baseline,
          mde: parsed.mdeGuess,
          stdDev: parsed.stdGuess ?? 2.1,
          alpha: 0.05,
          power: 0.8,
          dailyTraffic,
        })
      : powerAnalysis({
          baseline: parsed.baseline,
          mde: parsed.mdeGuess,
          alpha: 0.05,
          power: 0.8,
          dailyTraffic,
        });

  return {
    hypothesis: parsed,
    power,
    variants: [
      { name: "Control", description: "Current LiveOps experience." },
      { name: "Treatment", description: "Proposed change from the hypothesis." },
    ],
    allocation: "50/50 player-level randomization",
    guardrails: ["D7 retention must not drop >1.5pp", "ARPPU must not drop >$0.08", "Crash rate must not rise >0.3pp"],
    stopConditions: [
      `${power.sampleSizePerVariant.toLocaleString()} players per variant`,
      `${power.durationDays} full days minimum`,
      "No peeking before the planned stop condition",
      "Hold back novelty-sensitive launch cohorts if the effect decays",
    ],
  };
}

export function createExperimentBrief(text: string): TestDesign {
  return designTest(parseHypothesis(text));
}

export function evaluateExperiment(text: string, scenario: DemoScenario): ExperimentEvaluation {
  const parsed = parseHypothesis(text);
  const design = designTest(parsed);
  const results = createMockExperimentResults({
    scenario,
    metric: parsed.metric,
    metricType: parsed.metricType,
    unit: parsed.unit,
    alpha: design.power.alpha,
    requiredSampleSizePerVariant: design.power.sampleSizePerVariant,
    plannedDays: design.power.durationDays,
  });
  const significance = significanceTest(results);
  const guardrails = checkGuardrails(results);
  const recommendation = recommend({
    desiredDirection: parsed.direction,
    significance,
    guardrails,
    results,
  });

  return {
    parsed,
    design,
    results,
    significance,
    guardrails,
    recommendation,
    toolTrace: [
      { tool: "parse_hypothesis", input: { text }, output: parsed },
      {
        tool: "power_analysis",
        input: {
          baseline: parsed.baseline,
          mde: parsed.mdeGuess,
          alpha: 0.05,
          power: 0.8,
        },
        output: design.power,
      },
      { tool: "design_test", input: { metric: parsed.metric }, output: design },
      { tool: "significance_test", input: results, output: significance },
      { tool: "check_guardrails", input: results.guardrails, output: guardrails },
      { tool: "recommend", input: { desiredDirection: parsed.direction }, output: recommendation },
    ],
  };
}

export function checkGuardrails(results: ExperimentResults): GuardrailReport {
  const checks = results.guardrails.map((guardrail) => checkOneGuardrail(guardrail));
  const observedN = Math.min(results.variants[0].visitors, results.variants[1].visitors);
  const traps: string[] = [];

  if (observedN < results.requiredSampleSizePerVariant) {
    traps.push(
      `Underpowered: observed ${observedN.toLocaleString()} per variant vs planned ${results.requiredSampleSizePerVariant.toLocaleString()}.`,
    );
  }
  if (results.peeking) {
    traps.push(`Peeking: readout happened on day ${results.observedDays} of ${results.plannedDays}.`);
  }
  if (results.noveltyRisk) {
    traps.push("Novelty risk: early treatment response decays before the planned readout.");
  }

  return {
    passed: checks.every((check) => check.status !== "fail") && traps.length === 0,
    checks,
    traps,
  };
}

export function recommend(input: {
  desiredDirection: Direction;
  significance: SignificanceResult;
  guardrails: GuardrailReport;
  results: ExperimentResults;
}): Recommendation {
  const { desiredDirection, significance, guardrails } = input;
  const effectIsDesired =
    desiredDirection === "increase" ? significance.effect > 0 : significance.effect < 0;
  const failedChecks = guardrails.checks.filter((check) => check.status === "fail");
  const failedCritical = failedChecks.some((check) => check.severity === "critical");

  if (failedCritical) {
    return {
      decision: "kill",
      confidence: 0.82,
      rationale: "The primary metric may move, but a critical guardrail regressed beyond threshold.",
      caveats: failedChecks.map((check) => check.rationale),
    };
  }

  // A failing non-critical (watch) guardrail can never ship: force at least iterate so the
  // decision stays consistent with the "Needs action" guardrail state shown on the card.
  if (failedChecks.length > 0) {
    return {
      decision: "iterate",
      confidence: 0.7,
      rationale: "A watch-severity guardrail regressed beyond threshold — resolve it before shipping.",
      caveats: failedChecks.map((check) => check.rationale),
    };
  }

  if (guardrails.traps.length > 0) {
    return {
      decision: "iterate",
      confidence: 0.78,
      rationale: "Do not ship on noise: the readout violates the planned evidence standard.",
      caveats: guardrails.traps,
    };
  }

  if (!significance.significant) {
    return {
      decision: "iterate",
      confidence: 0.68,
      rationale: `The ${significance.test} readout is not significant at alpha=${input.results.alpha}.`,
      caveats: ["Keep the current experience, refine the treatment, or rerun with a larger MDE."],
    };
  }

  if (!effectIsDesired) {
    return {
      decision: "kill",
      confidence: 0.85,
      rationale: "The result is statistically clear, but it moves the primary metric in the wrong direction.",
      caveats: ["Archive the variant and inspect segments before reusing the concept."],
    };
  }

  return {
    decision: "ship",
    confidence: 0.88,
    rationale: "The treatment clears the primary metric, planned sample, and guardrail checks.",
    caveats: ["Ship behind a rollout flag and keep monitoring the same guardrails for one release cycle."],
  };
}

function checkOneGuardrail(guardrail: GuardrailObservation): GuardrailCheck {
  const delta = guardrail.treatment - guardrail.control;
  const regression =
    guardrail.direction === "increase" ? delta > guardrail.threshold : delta < -guardrail.threshold;
  const watch =
    !regression &&
    (guardrail.direction === "increase"
      ? delta > guardrail.threshold * 0.6
      : delta < -guardrail.threshold * 0.6);

  return {
    name: guardrail.name,
    status: regression ? "fail" : watch ? "watch" : "pass",
    delta: round(delta, 5),
    threshold: guardrail.threshold,
    severity: guardrail.severity,
    rationale: regression
      ? `${guardrail.name} moved ${formatSigned(delta)} ${guardrail.unit}, beyond the ${guardrail.threshold} threshold.`
      : `${guardrail.name} stayed within threshold (${formatSigned(delta)} ${guardrail.unit}).`,
  };
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${round(value, 4)}`;
}
