import { evaluateExperiment, type Decision } from "../lib/experiment";
import type { DemoScenario } from "../lib/mock-results";

export interface DecisionCase {
  id: string;
  hypothesis: string;
  scenario: DemoScenario;
  expected: Decision;
}

export interface DecisionResult extends DecisionCase {
  actual: Decision;
  passed: boolean;
  rationale: string;
}

export const decisionCases: DecisionCase[] = [
  {
    id: "clean-lift-ships",
    hypothesis: "A red Buy button will lift purchase conversion for new players.",
    scenario: "ship",
    expected: "ship",
  },
  {
    id: "underpowered-iterates",
    hypothesis: "A red Buy button will lift purchase conversion for new players.",
    scenario: "underpowered",
    expected: "iterate",
  },
  {
    id: "peeking-iterates",
    hypothesis: "A red Buy button will lift purchase conversion for new players.",
    scenario: "peeking",
    expected: "iterate",
  },
  {
    id: "novelty-iterates",
    hypothesis: "A red Buy button will lift purchase conversion for new players.",
    scenario: "novelty",
    expected: "iterate",
  },
  {
    id: "guardrail-kills",
    hypothesis: "A red Buy button will lift purchase conversion for new players.",
    scenario: "guardrail",
    expected: "kill",
  },
  {
    id: "flat-iterates",
    hypothesis: "A red Buy button will lift purchase conversion for new players.",
    scenario: "flat",
    expected: "iterate",
  },
  {
    id: "arpu-ship",
    hypothesis: "A new starter bundle will lift ARPU for paying players.",
    scenario: "ship",
    expected: "ship",
  },
  {
    id: "arpu-underpowered-iterates",
    hypothesis: "A new starter bundle will lift ARPU for paying players.",
    scenario: "underpowered",
    expected: "iterate",
  },
  {
    id: "arpu-guardrail-kills",
    hypothesis: "A new starter bundle will lift ARPU for paying players.",
    scenario: "guardrail",
    expected: "kill",
  },
  {
    id: "arpu-flat-iterates",
    hypothesis: "A new starter bundle will lift ARPU for paying players.",
    scenario: "flat",
    expected: "iterate",
  },
  {
    id: "crash-ship",
    hypothesis: "A memory fix will reduce the crash rate during combat.",
    scenario: "ship",
    expected: "ship",
  },
  {
    id: "crash-guardrail-kills",
    hypothesis: "A memory fix will reduce the crash rate during combat.",
    scenario: "guardrail",
    expected: "kill",
  },
  {
    id: "crash-flat-iterates",
    hypothesis: "A memory fix will reduce the crash rate during combat.",
    scenario: "flat",
    expected: "iterate",
  },
];

export function scoreDecisionCase(testCase: DecisionCase): DecisionResult {
  const evaluation = evaluateExperiment(testCase.hypothesis, testCase.scenario);
  const actual = evaluation.recommendation.decision;
  return {
    ...testCase,
    actual,
    passed: actual === testCase.expected,
    rationale: evaluation.recommendation.rationale,
  };
}
