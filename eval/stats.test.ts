import {
  continuousPowerAnalysis,
  powerAnalysis,
  significanceTest,
  type ExperimentResults,
} from "../lib/stats";

export interface ValidationResult {
  name: string;
  passed: boolean;
  actual: number;
  expected: number;
  tolerance: number;
}

// All expected values below are the outputs of scipy / statsmodels on the same inputs,
// computed independently (see the PR summary for the exact one-off script):
//   - power: two-proportion normal-approximation sample size
//   - two_proportion_z p-value: statsmodels proportions_ztest (pooled)
//   - welch_t: scipy.stats.ttest_ind_from_stats(equal_var=False) + Welch–Satterthwaite df
//   - mann_whitney_u: scipy.stats.mannwhitneyu(method="asymptotic", use_continuity=True)
//   - chi_square: scipy.stats.chi2_contingency(correction=False)
export function runStatsValidation(): ValidationResult[] {
  const power = powerAnalysis({ baseline: 0.06, mde: 0.01, alpha: 0.05, power: 0.8, dailyTraffic: 1600 });

  const arpuPower = continuousPowerAnalysis({
    baseline: 1.2,
    mde: 0.08,
    stdDev: 2.1,
    alpha: 0.05,
    power: 0.8,
    dailyTraffic: 1600,
  });

  const zTest = significanceTest({
    id: "known-two-prop",
    metric: "Purchase conversion",
    metricType: "binary",
    primaryUnit: "players converted",
    alpha: 0.05,
    requiredSampleSizePerVariant: power.sampleSizePerVariant,
    plannedDays: power.durationDays,
    observedDays: power.durationDays,
    variants: [
      { name: "control", visitors: 15000, conversions: 900 },
      { name: "treatment", visitors: 15000, conversions: 1050 },
    ],
    guardrails: [],
  });

  // Large-n Welch case: t-distribution ≈ normal here, but the df is still finite.
  const welchLarge = significanceTest({
    id: "known-welch-large",
    metric: "ARPU",
    metricType: "continuous",
    primaryUnit: "USD/player",
    alpha: 0.05,
    requiredSampleSizePerVariant: 400,
    plannedDays: 1,
    observedDays: 1,
    variants: [
      { name: "control", visitors: 400, mean: 4.1, standardDeviation: 1.2 },
      { name: "treatment", visitors: 400, mean: 4.45, standardDeviation: 1.3 },
    ],
    guardrails: [],
  } satisfies ExperimentResults);

  // Small-sample Welch case: the normal approximation would understate the p-value here.
  const welchSmall = significanceTest({
    id: "known-welch-small",
    metric: "ARPU",
    metricType: "continuous",
    primaryUnit: "USD/player",
    alpha: 0.05,
    requiredSampleSizePerVariant: 400,
    plannedDays: 1,
    observedDays: 1,
    variants: [
      { name: "control", visitors: 12, mean: 4.1, standardDeviation: 1.2 },
      { name: "treatment", visitors: 15, mean: 4.45, standardDeviation: 1.3 },
    ],
    guardrails: [],
  } satisfies ExperimentResults);

  // Non-parametric case with ties, validated against scipy mannwhitneyu (asymptotic).
  const mann = significanceTest({
    id: "known-mann-whitney",
    metric: "Session length",
    metricType: "ordinal",
    primaryUnit: "minutes",
    alpha: 0.05,
    requiredSampleSizePerVariant: 10,
    plannedDays: 1,
    observedDays: 1,
    variants: [
      { name: "control", visitors: 10, samples: [3, 5, 5, 6, 8, 9, 10, 12, 14, 15] },
      { name: "treatment", visitors: 10, samples: [6, 7, 9, 11, 13, 14, 16, 18, 20, 22] },
    ],
    guardrails: [],
  } satisfies ExperimentResults);

  // Real 2×2 chi-square on crash counts, validated against scipy chi2_contingency.
  const chi = significanceTest({
    id: "known-chi-square",
    metric: "Crash rate",
    metricType: "count",
    primaryUnit: "sessions",
    alpha: 0.05,
    requiredSampleSizePerVariant: 12980,
    plannedDays: 1,
    observedDays: 1,
    variants: [
      { name: "control", visitors: 50000, exposure: 50000, events: 450 },
      { name: "treatment", visitors: 50000, exposure: 50000, events: 360 },
    ],
    guardrails: [],
  } satisfies ExperimentResults);

  return [
    closeTo("power n per variant", power.sampleSizePerVariant, 9540, 1),
    closeTo("power duration days", power.durationDays, 12, 0),
    closeTo("continuous power n per variant", arpuPower.sampleSizePerVariant, 10817, 1),
    closeTo("two-proportion p-value", zTest.pValue, 0.00044321, 0.00001),
    closeTo("two-proportion effect", zTest.effect, 0.01, 0.00005),
    closeTo("two-proportion CI low", zTest.ci95[0], 0.00442184, 0.00005),
    closeTo("two-proportion CI high", zTest.ci95[1], 0.01557816, 0.00005),
    closeTo("welch large p-value", welchLarge.pValue, 0.00008283, 0.000002),
    closeTo("welch large df", welchLarge.degreesOfFreedom ?? 0, 792.9414, 0.01),
    closeTo("welch large CI low", welchLarge.ci95[0], 0.17635844, 0.0001),
    closeTo("welch large CI high", welchLarge.ci95[1], 0.52364156, 0.0001),
    closeTo("welch small p-value", welchSmall.pValue, 0.47497418, 0.0002),
    closeTo("welch small df", welchSmall.degreesOfFreedom ?? 0, 24.4309, 0.005),
    closeTo("welch small effect", welchSmall.effect, 0.35, 0.00005),
    closeTo("welch small CI low", welchSmall.ci95[0], -0.64460406, 0.0002),
    closeTo("welch small CI high", welchSmall.ci95[1], 1.34460406, 0.0002),
    closeTo("mann-whitney p-value", mann.pValue, 0.04902462, 0.0002),
    closeTo("mann-whitney effect", mann.effect, 5, 0.00005),
    closeTo("chi-square p-value", chi.pValue, 0.00149752, 0.00002),
    closeTo("chi-square effect", chi.effect, -0.0018, 0.00001),
  ];
}

function closeTo(name: string, actual: number, expected: number, tolerance: number): ValidationResult {
  return {
    name,
    actual,
    expected,
    tolerance,
    passed: Math.abs(actual - expected) <= tolerance,
  };
}
