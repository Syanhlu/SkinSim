import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { designTest, evaluateExperiment, parseHypothesis, type ParsedHypothesis } from "../lib/experiment";
import { createMockExperimentResults, demoScenarios, type DemoScenario, type MockExperimentInput } from "../lib/mock-results";
import { normalizeScenario } from "../lib/sim-client";
import {
  continuousPowerAnalysis,
  powerAnalysis,
  significanceTest,
  type ExperimentResults,
  type MetricType,
  type VariantObservation,
} from "../lib/stats";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const knownScenarios = demoScenarios.map((scenario) => scenario.id);

if (process.argv.includes("--snapshot")) {
  process.stdout.write(JSON.stringify(determinismSnapshot()));
  process.exit(0);
}

const cases: TestCase[] = [
  {
    name: "stats binary rejects zero visitors",
    run: () => {
      assertThrows(() =>
        significanceTest(
          binaryResults([
            { name: "control", visitors: 0, conversions: 0 },
            { name: "treatment", visitors: 100, conversions: 10 },
          ]),
        ),
      );
    },
  },
  {
    name: "stats binary rejects negative visitors",
    run: () => {
      assertThrows(() =>
        significanceTest(
          binaryResults([
            { name: "control", visitors: -10, conversions: 1 },
            { name: "treatment", visitors: 100, conversions: 10 },
          ]),
        ),
      );
    },
  },
  {
    name: "stats binary rejects conversions above visitors",
    run: () => {
      assertThrows(() =>
        significanceTest(
          binaryResults([
            { name: "control", visitors: 10, conversions: 11 },
            { name: "treatment", visitors: 100, conversions: 10 },
          ]),
        ),
      );
    },
  },
  {
    name: "stats binary handles zero conversions in both variants",
    run: () => {
      const result = significanceTest(
        binaryResults([
          { name: "control", visitors: 1000, conversions: 0 },
          { name: "treatment", visitors: 1000, conversions: 0 },
        ]),
      );

      assertAlmostEqual(result.pValue, 1);
      assert.equal(result.effect, 0);
      assertFiniteInterval(result.ci95);
    },
  },
  {
    name: "stats binary handles full conversion in both variants",
    run: () => {
      const result = significanceTest(
        binaryResults([
          { name: "control", visitors: 1000, conversions: 1000 },
          { name: "treatment", visitors: 1000, conversions: 1000 },
        ]),
      );

      assertAlmostEqual(result.pValue, 1);
      assert.equal(result.effect, 0);
      assertFiniteInterval(result.ci95);
    },
  },
  {
    name: "stats binary handles extreme proportions with huge n",
    run: () => {
      const result = significanceTest(
        binaryResults([
          { name: "control", visitors: 1_000_000_000, conversions: 1 },
          { name: "treatment", visitors: 1_000_000_000, conversions: 999_999_999 },
        ]),
      );

      assert.ok(Number.isFinite(result.pValue));
      assert.ok(result.pValue >= 0 && result.pValue <= 1);
      assert.ok(result.ci95[0] >= -1 && result.ci95[1] <= 1);
      assert.equal(result.direction, "positive");
    },
  },
  {
    name: "stats binary rejects NaN and Infinity visitors",
    run: () => {
      assertThrows(() =>
        significanceTest(
          binaryResults([
            { name: "control", visitors: Number.NaN, conversions: 1 },
            { name: "treatment", visitors: 100, conversions: 10 },
          ]),
        ),
      );
      assertThrows(() =>
        significanceTest(
          binaryResults([
            { name: "control", visitors: Number.POSITIVE_INFINITY, conversions: 1 },
            { name: "treatment", visitors: 100, conversions: 10 },
          ]),
        ),
      );
    },
  },
  {
    name: "stats Welch rejects n=1 raw samples",
    run: () => {
      assertThrows(() =>
        significanceTest(
          continuousResults([
            { name: "control", visitors: 1, samples: [1.2] },
            { name: "treatment", visitors: 2, samples: [1.1, 1.3] },
          ]),
        ),
      );
    },
  },
  {
    name: "stats Welch supports n=2 raw samples",
    run: () => {
      const result = significanceTest(
        continuousResults([
          { name: "control", visitors: 2, samples: [1, 2] },
          { name: "treatment", visitors: 2, samples: [2, 3] },
        ]),
      );

      assert.ok(Number.isFinite(result.pValue));
      assertFiniteInterval(result.ci95);
    },
  },
  {
    name: "stats Welch handles zero variance equal means",
    run: () => {
      const result = significanceTest(
        continuousResults([
          { name: "control", visitors: 10, mean: 2, standardDeviation: 0 },
          { name: "treatment", visitors: 10, mean: 2, standardDeviation: 0 },
        ]),
      );

      assert.equal(result.pValue, 1);
      assert.equal(result.effect, 0);
      assert.deepEqual(result.ci95, [0, 0]);
    },
  },
  {
    name: "stats Welch handles zero variance different means",
    run: () => {
      const result = significanceTest(
        continuousResults([
          { name: "control", visitors: 10, mean: 2, standardDeviation: 0 },
          { name: "treatment", visitors: 10, mean: 3, standardDeviation: 0 },
        ]),
      );

      assert.equal(result.pValue, 0);
      assert.equal(result.effect, 1);
      assert.equal(result.significant, true);
      assert.deepEqual(result.ci95, [1, 1]);
    },
  },
  {
    name: "stats Welch rejects non-finite samples and negative sd",
    run: () => {
      assertThrows(() =>
        significanceTest(
          continuousResults([
            { name: "control", visitors: 2, samples: [1, Number.NaN] },
            { name: "treatment", visitors: 2, samples: [1, 2] },
          ]),
        ),
      );
      assertThrows(() =>
        significanceTest(
          continuousResults([
            { name: "control", visitors: 10, mean: 2, standardDeviation: -1 },
            { name: "treatment", visitors: 10, mean: 3, standardDeviation: 1 },
          ]),
        ),
      );
    },
  },
  {
    name: "stats chi-square handles empty event cells",
    run: () => {
      // With positive exposure and zero events in both groups, the event column is empty;
      // this is an expected flat result rather than an invalid contingency table.
      const result = significanceTest(
        countResults([
          { name: "control", visitors: 100, exposure: 100, events: 0 },
          { name: "treatment", visitors: 100, exposure: 100, events: 0 },
        ]),
      );

      assert.equal(result.pValue, 1);
      assert.equal(result.effect, 0);
      assertFiniteInterval(result.ci95);
    },
  },
  {
    name: "stats chi-square rejects zero exposure and impossible events",
    run: () => {
      assertThrows(() =>
        significanceTest(
          countResults([
            { name: "control", visitors: 0, exposure: 0, events: 0 },
            { name: "treatment", visitors: 100, exposure: 100, events: 1 },
          ]),
        ),
      );
      assertThrows(() =>
        significanceTest(
          countResults([
            { name: "control", visitors: 100, exposure: 100, events: 101 },
            { name: "treatment", visitors: 100, exposure: 100, events: 1 },
          ]),
        ),
      );
    },
  },
  {
    name: "stats Mann-Whitney handles all tied values",
    run: () => {
      const result = significanceTest(
        ordinalResults([
          { name: "control", visitors: 4, samples: [3, 3, 3, 3] },
          { name: "treatment", visitors: 4, samples: [3, 3, 3, 3] },
        ]),
      );

      assert.ok(Math.abs(result.pValue - 1) < 1e-6);
      assert.equal(result.effect, 0);
      assert.deepEqual(result.ci95, [0, 0]);
    },
  },
  {
    name: "stats Mann-Whitney rejects non-finite samples",
    run: () => {
      assertThrows(() =>
        significanceTest(
          ordinalResults([
            { name: "control", visitors: 2, samples: [1, Number.POSITIVE_INFINITY] },
            { name: "treatment", visitors: 2, samples: [1, 2] },
          ]),
        ),
      );
    },
  },
  {
    name: "stats power rejects invalid mde alpha and traffic",
    run: () => {
      assertThrows(() => powerAnalysis({ baseline: 0.1, mde: 0 }));
      assertThrows(() => powerAnalysis({ baseline: 0.1, mde: 0.01, alpha: 0 }));
      assertThrows(() => powerAnalysis({ baseline: 0.1, mde: 0.01, alpha: 1 }));
      assertThrows(() => powerAnalysis({ baseline: 0.1, mde: 0.01, dailyTraffic: 0 }));
      assertThrows(() => continuousPowerAnalysis({ baseline: 1, mde: 0.1, stdDev: 1, alpha: 1 }));
    },
  },
  {
    name: "stats power clamps mde beyond valid rate range",
    run: () => {
      // The rate model clamps the treatment rate into the open probability interval;
      // this keeps impossible rate targets from leaking into the normal approximation.
      const result = powerAnalysis({ baseline: 0.95, mde: 0.2 });

      assert.equal(result.baseline, 0.95);
      assert.ok(result.mde > 0);
      assert.ok(result.mde < 0.2);
      assert.ok(Number.isFinite(result.sampleSizePerVariant));
    },
  },
  {
    name: "experiment parser handles empty hypothesis fallback",
    run: () => {
      // Empty text intentionally follows the generic purchase-conversion fallback so the
      // caller still receives a deterministic starter design instead of a parser failure.
      const parsed = parseHypothesis("");

      assert.equal(parsed.metric, "Purchase conversion");
      assert.equal(parsed.metricType, "binary");
      assert.equal(parsed.text, "");
    },
  },
  {
    name: "experiment parser handles long unicode hypothesis",
    run: () => {
      const text = `${"toi uu gia tri nguoi choi ".repeat(400)} giu chan d7 nguoi choi o Viet Nam`;
      const parsed = parseHypothesis(text);

      assert.equal(parsed.metric, "D7 retention");
      assert.equal(parsed.text.length, text.length);
      assert.ok(parsed.text.includes("Viet Nam"));
    },
  },
  {
    name: "experiment parser uses deterministic precedence for mixed keywords",
    run: () => {
      // Revenue is checked before retention and crash terms; this precedence is expected
      // because a single hypothesis can contain guardrail language for other metrics.
      const parsed = parseHypothesis("increase revenue, retention, and reduce crash rate");

      assert.equal(parsed.metric, "ARPU");
      assert.equal(parsed.metricType, "continuous");
    },
  },
  {
    name: "experiment design rejects negative parsed baselines",
    run: () => {
      const parsed: ParsedHypothesis = {
        ...parseHypothesis("increase retention"),
        baseline: -0.1,
      };

      assertThrows(() => designTest(parsed));
    },
  },
  {
    name: "sim normalizes garbage scenario to ship",
    run: () => {
      // Unknown scenario strings degrade to the default demo scenario instead of throwing;
      // external callers can pass normalizeScenario(input) before creating mock results.
      assert.equal(normalizeScenario("garbage"), "ship");
      assert.equal(normalizeScenario(null), "ship");
      assert.equal(normalizeScenario({}), "ship");
    },
  },
  {
    name: "mock known binary scenarios are internally consistent",
    run: () => {
      for (const scenario of knownScenarios) {
        assertConsistentResults(
          createMockExperimentResults(mockInput({ scenario, metricType: "binary", metric: "Purchase conversion" })),
        );
      }
    },
  },
  {
    name: "mock known continuous scenarios are internally consistent",
    run: () => {
      for (const scenario of knownScenarios) {
        assertConsistentResults(
          createMockExperimentResults(mockInput({ scenario, metricType: "continuous", metric: "ARPU", unit: "USD/player" })),
        );
      }
    },
  },
  {
    name: "mock known count scenarios are internally consistent",
    run: () => {
      for (const scenario of knownScenarios) {
        assertConsistentResults(
          createMockExperimentResults(mockInput({ scenario, metricType: "count", metric: "Crash rate", unit: "sessions" })),
        );
      }
    },
  },
  {
    name: "determinism byte-identical across separate runs",
    run: () => {
      const first = runSnapshot();
      const second = runSnapshot();

      assert.equal(first.status, 0, first.stderr);
      assert.equal(second.status, 0, second.stderr);
      assert.equal(first.stdout, second.stdout);
    },
  },
];

void main();

async function main(): Promise<void> {
  let failures = 0;

  for (const testCase of cases) {
    try {
      await testCase.run();
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      failures += 1;
      console.log(`FAIL ${testCase.name}: ${formatError(error)}`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

function binaryResults(variants: [VariantObservation, VariantObservation]): ExperimentResults {
  return baseResults("binary", variants, "Purchase conversion", "players converted");
}

function continuousResults(variants: [VariantObservation, VariantObservation]): ExperimentResults {
  return baseResults("continuous", variants, "ARPU", "USD/player");
}

function countResults(variants: [VariantObservation, VariantObservation]): ExperimentResults {
  return baseResults("count", variants, "Crash rate", "sessions");
}

function ordinalResults(variants: [VariantObservation, VariantObservation]): ExperimentResults {
  return baseResults("ordinal", variants, "Satisfaction", "rating");
}

function baseResults(
  metricType: MetricType,
  variants: [VariantObservation, VariantObservation],
  metric: string,
  primaryUnit: string,
): ExperimentResults {
  return {
    id: `edge-${metricType}`,
    metric,
    metricType,
    primaryUnit,
    alpha: 0.05,
    requiredSampleSizePerVariant: 1,
    plannedDays: 1,
    observedDays: 1,
    variants,
    guardrails: [],
  };
}

function mockInput(overrides: Partial<MockExperimentInput>): MockExperimentInput {
  return {
    scenario: "ship",
    metric: "Purchase conversion",
    metricType: "binary",
    unit: "players converted",
    alpha: 0.05,
    requiredSampleSizePerVariant: 100,
    plannedDays: 7,
    ...overrides,
  };
}

function assertConsistentResults(results: ExperimentResults): void {
  assert.ok(results.observedDays > 0, `${results.id} observedDays`);
  assert.ok(results.plannedDays > 0, `${results.id} plannedDays`);
  assert.ok(results.alpha > 0 && results.alpha < 1, `${results.id} alpha`);
  assert.equal(results.variants.length, 2, `${results.id} variants`);

  for (const variant of results.variants) {
    assert.ok(Number.isFinite(variant.visitors) && variant.visitors > 0, `${results.id} ${variant.name} visitors`);

    if (variant.conversions !== undefined) {
      assertIntegerRange(variant.conversions, 0, variant.visitors, `${results.id} ${variant.name} conversions`);
    }
    if (variant.events !== undefined || variant.exposure !== undefined) {
      assert.ok(variant.exposure !== undefined, `${results.id} ${variant.name} exposure`);
      assert.ok(variant.events !== undefined, `${results.id} ${variant.name} events`);
      assertIntegerRange(variant.events, 0, variant.exposure, `${results.id} ${variant.name} events`);
    }
    if (variant.mean !== undefined) {
      assert.ok(Number.isFinite(variant.mean), `${results.id} ${variant.name} mean`);
    }
    if (variant.standardDeviation !== undefined) {
      assert.ok(Number.isFinite(variant.standardDeviation) && variant.standardDeviation >= 0, `${results.id} ${variant.name} sd`);
    }
    if (variant.samples !== undefined) {
      assert.ok(variant.samples.every(Number.isFinite), `${results.id} ${variant.name} samples`);
    }
  }

  for (const guardrail of results.guardrails) {
    assert.ok(Number.isFinite(guardrail.control), `${results.id} ${guardrail.name} control`);
    assert.ok(Number.isFinite(guardrail.treatment), `${results.id} ${guardrail.name} treatment`);
    assert.ok(Number.isFinite(guardrail.threshold) && guardrail.threshold >= 0, `${results.id} ${guardrail.name} threshold`);
  }
}

function assertIntegerRange(value: number, min: number, max: number, label: string): void {
  assert.ok(Number.isInteger(value), label);
  assert.ok(value >= min, label);
  assert.ok(value <= max, label);
}

function assertFiniteInterval(interval: [number, number]): void {
  assert.ok(Number.isFinite(interval[0]), "ci lower bound");
  assert.ok(Number.isFinite(interval[1]), "ci upper bound");
  assert.ok(interval[0] <= interval[1], "ci ordering");
}

function assertThrows(fn: () => unknown): void {
  let threw = false;

  try {
    fn();
  } catch {
    threw = true;
  }

  assert.equal(threw, true);
}

function runSnapshot(): ReturnType<typeof spawnSync> {
  return spawnSync("cmd.exe", ["/c", "npx.cmd", "tsx", "eval/edge.test.ts", "--snapshot"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024,
    timeout: 60_000,
  });
}

function determinismSnapshot(): unknown {
  const hypothesis = "increase revenue and retention for Vietnamese players";
  const parsed = parseHypothesis(hypothesis);

  return {
    parsed,
    power: designTest(parsed, 1600).power,
    normalized: ["ship", "garbage", null, "flat"].map((value) => normalizeScenario(value)),
    scenarios: knownScenarios.map((scenario) => ({
      scenario,
      result: compactResult(createMockExperimentResults(mockInput({ scenario }))),
      recommendation: evaluateExperiment(hypothesis, scenario).recommendation,
    })),
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertAlmostEqual(actual: number, expected: number, epsilon = 1e-8): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ~= ${expected}`);
}

function compactResult(results: ExperimentResults): unknown {
  return {
    id: results.id,
    observedDays: results.observedDays,
    peeking: results.peeking,
    noveltyRisk: results.noveltyRisk,
    variants: results.variants,
    guardrails: results.guardrails,
  };
}
