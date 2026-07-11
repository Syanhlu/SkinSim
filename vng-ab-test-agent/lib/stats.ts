export type MetricType = "binary" | "continuous" | "count" | "ordinal";

export interface PowerAnalysisInput {
  baseline: number;
  mde: number;
  alpha?: number;
  power?: number;
  dailyTraffic?: number;
}

export interface PowerAnalysisResult {
  baseline: number;
  mde: number;
  alpha: number;
  power: number;
  sampleSizePerVariant: number;
  totalSampleSize: number;
  durationDays: number;
  dailyTraffic: number;
  formula: string;
}

export interface VariantObservation {
  name: "control" | "treatment" | string;
  visitors: number;
  conversions?: number;
  mean?: number;
  standardDeviation?: number;
  samples?: number[];
  events?: number;
  exposure?: number;
}

export interface GuardrailObservation {
  name: string;
  unit: string;
  direction: "increase" | "decrease";
  control: number;
  treatment: number;
  threshold: number;
  severity: "watch" | "critical";
}

export interface ExperimentResults {
  id: string;
  metric: string;
  metricType: MetricType;
  primaryUnit: string;
  alpha: number;
  requiredSampleSizePerVariant: number;
  plannedDays: number;
  observedDays: number;
  variants: [VariantObservation, VariantObservation];
  guardrails: GuardrailObservation[];
  peeking?: boolean;
  noveltyRisk?: boolean;
  notes?: string[];
}

export interface SignificanceResult {
  test: "two_proportion_z" | "welch_t" | "chi_square" | "mann_whitney_u";
  degreesOfFreedom?: number;
  pValue: number;
  ci95: [number, number];
  effect: number;
  effectLabel: string;
  relativeLift?: number;
  significant: boolean;
  direction: "positive" | "negative" | "flat";
  sampleSizePerVariant: {
    control: number;
    treatment: number;
  };
  details: string;
}

export function powerAnalysis(input: PowerAnalysisInput): PowerAnalysisResult {
  const alpha = input.alpha ?? 0.05;
  const power = input.power ?? 0.8;
  const dailyTraffic = input.dailyTraffic ?? 1600;
  const baseline = clamp(input.baseline, 0.0001, 0.9999);
  const treatment = clamp(baseline + input.mde, 0.0001, 0.9999);
  const mde = Math.abs(treatment - baseline);

  if (!Number.isFinite(mde) || mde <= 0) {
    throw new Error("mde must move the baseline by a non-zero amount");
  }

  const zAlpha = inverseNormalCdf(1 - alpha / 2);
  const zPower = inverseNormalCdf(power);
  const pBar = (baseline + treatment) / 2;
  const numerator =
    zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) +
    zPower * Math.sqrt(baseline * (1 - baseline) + treatment * (1 - treatment));
  const sampleSizePerVariant = Math.ceil((numerator * numerator) / (mde * mde));
  const totalSampleSize = sampleSizePerVariant * 2;

  return {
    baseline,
    mde,
    alpha,
    power,
    sampleSizePerVariant,
    totalSampleSize,
    durationDays: Math.max(1, Math.ceil(totalSampleSize / dailyTraffic)),
    dailyTraffic,
    formula: "Two-sided two-proportion z-test normal approximation",
  };
}

export interface ContinuousPowerAnalysisInput {
  baseline: number;
  mde: number;
  stdDev: number;
  alpha?: number;
  power?: number;
  dailyTraffic?: number;
}

// Power analysis for a difference in means (continuous metrics like ARPU). The proportion
// formula above is invalid when the baseline is a dollar mean rather than a rate.
export function continuousPowerAnalysis(input: ContinuousPowerAnalysisInput): PowerAnalysisResult {
  const alpha = input.alpha ?? 0.05;
  const power = input.power ?? 0.8;
  const dailyTraffic = input.dailyTraffic ?? 1600;
  const stdDev = input.stdDev;
  const mde = Math.abs(input.mde);

  if (!Number.isFinite(stdDev) || stdDev <= 0) {
    throw new Error("stdDev must be a positive number for a continuous power analysis");
  }
  if (!Number.isFinite(mde) || mde <= 0) {
    throw new Error("mde must move the mean by a non-zero amount");
  }

  const zAlpha = inverseNormalCdf(1 - alpha / 2);
  const zPower = inverseNormalCdf(power);
  const sampleSizePerVariant = Math.ceil((2 * (zAlpha + zPower) ** 2 * stdDev * stdDev) / (mde * mde));
  const totalSampleSize = sampleSizePerVariant * 2;

  return {
    baseline: input.baseline,
    mde,
    alpha,
    power,
    sampleSizePerVariant,
    totalSampleSize,
    durationDays: Math.max(1, Math.ceil(totalSampleSize / dailyTraffic)),
    dailyTraffic,
    formula: "Two-sample z power for a difference in means (continuous)",
  };
}

export function significanceTest(results: ExperimentResults): SignificanceResult {
  if (results.metricType === "continuous") return welchTTest(results);
  if (results.metricType === "count") return chiSquareTest(results);
  if (results.metricType === "ordinal") return mannWhitneyTest(results);
  return twoProportionZTest(results);
}

function twoProportionZTest(results: ExperimentResults): SignificanceResult {
  const [control, treatment] = results.variants;
  const cConversions = requiredNumber(control.conversions, "control conversions");
  const tConversions = requiredNumber(treatment.conversions, "treatment conversions");
  const p1 = cConversions / control.visitors;
  const p2 = tConversions / treatment.visitors;
  const pooled = (cConversions + tConversions) / (control.visitors + treatment.visitors);
  const pooledSe = Math.sqrt(pooled * (1 - pooled) * (1 / control.visitors + 1 / treatment.visitors));
  const effect = p2 - p1;
  const z = safeDivide(effect, pooledSe);
  const pValue = twoSidedNormalP(z);
  const ciSe = Math.sqrt(
    (p1 * (1 - p1)) / control.visitors + (p2 * (1 - p2)) / treatment.visitors,
  );
  const margin = inverseNormalCdf(1 - results.alpha / 2) * ciSe;

  return {
    test: "two_proportion_z",
    pValue,
    ci95: [effect - margin, effect + margin],
    effect,
    effectLabel: "absolute conversion-rate lift",
    relativeLift: safeDivide(effect, p1),
    significant: pValue < results.alpha,
    direction: directionFromEffect(effect),
    sampleSizePerVariant: { control: control.visitors, treatment: treatment.visitors },
    details: `Compared ${cConversions}/${control.visitors} vs ${tConversions}/${treatment.visitors} with a pooled two-sided z-test.`,
  };
}

function welchTTest(results: ExperimentResults): SignificanceResult {
  const [control, treatment] = results.variants;
  const n1 = control.samples?.length ?? control.visitors;
  const n2 = treatment.samples?.length ?? treatment.visitors;
  const mean1 = control.samples ? mean(control.samples) : requiredNumber(control.mean, "control mean");
  const mean2 = treatment.samples ? mean(treatment.samples) : requiredNumber(treatment.mean, "treatment mean");
  const sd1 = control.samples ? sampleStandardDeviation(control.samples) : requiredNumber(control.standardDeviation, "control sd");
  const sd2 = treatment.samples
    ? sampleStandardDeviation(treatment.samples)
    : requiredNumber(treatment.standardDeviation, "treatment sd");
  const v1 = (sd1 * sd1) / n1;
  const v2 = (sd2 * sd2) / n2;
  const se = Math.sqrt(v1 + v2);
  const effect = mean2 - mean1;
  const t = safeDivide(effect, se);
  // Welch–Satterthwaite degrees of freedom for unequal variances.
  const df = safeDivide((v1 + v2) ** 2, (v1 * v1) / (n1 - 1) + (v2 * v2) / (n2 - 1));
  // p-value from the Student t-distribution (not the normal approximation).
  const pValue = studentTTwoSidedP(t, df);
  // CI margin uses the t critical value at the Welch df, matching the p-value.
  const margin = studentTQuantile(1 - results.alpha / 2, df) * se;

  return {
    test: "welch_t",
    degreesOfFreedom: round(df, 4),
    pValue,
    ci95: [effect - margin, effect + margin],
    effect,
    effectLabel: `mean ${results.primaryUnit} difference`,
    relativeLift: safeDivide(effect, mean1),
    significant: pValue < results.alpha,
    direction: directionFromEffect(effect),
    sampleSizePerVariant: { control: n1, treatment: n2 },
    details: `Welch t-test for unequal variance: t=${round(t, 4)}, Welch–Satterthwaite df=${round(df, 2)}.`,
  };
}

// Count/rate metrics (e.g. crash rate) carry per-variant event + exposure data and are
// tested with a genuine 2×2 Pearson chi-square of independence on the chi-square
// distribution with 1 degree of freedom — not a relabeled z-test.
function chiSquareTest(results: ExperimentResults): SignificanceResult {
  const [control, treatment] = results.variants;
  const e1 = requiredNumber(control.events, "control events");
  const n1 = requiredNumber(control.exposure, "control exposure");
  const e2 = requiredNumber(treatment.events, "treatment events");
  const n2 = requiredNumber(treatment.exposure, "treatment exposure");
  // Contingency table [[events, non-events]] for control and treatment.
  const a = e1;
  const b = n1 - e1;
  const c = e2;
  const d = n2 - e2;
  const total = n1 + n2;
  const chiSquare = safeDivide(
    total * (a * d - b * c) ** 2,
    (a + b) * (c + d) * (a + c) * (b + d),
  );
  const pValue = 1 - chiSquareCdf(chiSquare, 1);
  const p1 = e1 / n1;
  const p2 = e2 / n2;
  const effect = p2 - p1;
  const ciSe = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  const margin = inverseNormalCdf(1 - results.alpha / 2) * ciSe;

  return {
    test: "chi_square",
    degreesOfFreedom: 1,
    pValue,
    ci95: [effect - margin, effect + margin],
    effect,
    effectLabel: `rate difference (${results.primaryUnit})`,
    relativeLift: safeDivide(effect, p1),
    significant: pValue < results.alpha,
    direction: directionFromEffect(effect),
    sampleSizePerVariant: { control: n1, treatment: n2 },
    details: `2×2 Pearson chi-square (df=1): ${e1}/${n1} vs ${e2}/${n2} events, χ²=${round(chiSquare, 4)}.`,
  };
}

function mannWhitneyTest(results: ExperimentResults): SignificanceResult {
  const [control, treatment] = results.variants;
  const controlSamples = control.samples ?? [];
  const treatmentSamples = treatment.samples ?? [];
  if (controlSamples.length === 0 || treatmentSamples.length === 0) {
    throw new Error("Mann-Whitney requires raw samples for both variants");
  }

  const ranked = [...controlSamples.map((value) => ({ value, group: "control" as const })), ...treatmentSamples.map((value) => ({ value, group: "treatment" as const }))].sort(
    (a, b) => a.value - b.value,
  );
  const ranks = new Array<number>(ranked.length);
  let tieCorrection = 0; // sum of (t^3 - t) over tie groups, for the variance correction
  for (let i = 0; i < ranked.length; ) {
    let j = i + 1;
    while (j < ranked.length && ranked[j].value === ranked[i].value) j++;
    const averageRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[k] = averageRank;
    const t = j - i;
    tieCorrection += t * t * t - t;
    i = j;
  }

  const treatmentRankSum = ranked.reduce(
    (sum, row, index) => sum + (row.group === "treatment" ? ranks[index] : 0),
    0,
  );
  const n1 = controlSamples.length;
  const n2 = treatmentSamples.length;
  const n = n1 + n2;
  const u = treatmentRankSum - (n2 * (n2 + 1)) / 2;
  const meanU = (n1 * n2) / 2;
  // Variance with tie correction (matches scipy.stats.mannwhitneyu asymptotic method).
  const sdU = Math.sqrt(
    ((n1 * n2) / 12) * (n + 1 - tieCorrection / (n * (n - 1))),
  );
  // Continuity correction of 0.5 (scipy use_continuity=True default).
  const z = safeDivide(Math.abs(u - meanU) - 0.5, sdU);
  const pValue = 2 * (1 - normalCdf(z));
  const effect = median(treatmentSamples) - median(controlSamples);

  return {
    test: "mann_whitney_u",
    pValue,
    ci95: [effect, effect],
    effect,
    effectLabel: `median ${results.primaryUnit} difference`,
    relativeLift: safeDivide(effect, median(controlSamples)),
    significant: pValue < results.alpha,
    direction: directionFromEffect(effect),
    sampleSizePerVariant: { control: n1, treatment: n2 },
    details: `Ranked ${n1 + n2} samples and tested U=${round(u, 2)} with a normal approximation.`,
  };
}

export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function inverseNormalCdf(p: number): number {
  if (p <= 0 || p >= 1) throw new Error("p must be between 0 and 1");

  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.38357751867269e2,
    -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;

  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function twoSidedNormalP(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

function directionFromEffect(effect: number): "positive" | "negative" | "flat" {
  if (Math.abs(effect) < 1e-9) return "flat";
  return effect > 0 ? "positive" : "negative";
}

function requiredNumber(value: number | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is required`);
  return value;
}

function safeDivide(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) return 0;
  return numerator / denominator;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function sampleStandardDeviation(values: number[]): number {
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// ── Special functions (deterministic, no dependencies) ───────────────────────
// Lanczos approximation of ln Γ(x).
function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Continued fraction for the regularized incomplete beta function (Numerical Recipes).
function betaContinuedFraction(a: number, b: number, x: number): number {
  const MAX_ITER = 300;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

// Regularized incomplete beta I_x(a, b).
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

// Two-sided p-value from the Student t-distribution with `df` degrees of freedom.
export function studentTTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return 1;
  const x = df / (df + t * t);
  return incompleteBeta(x, df / 2, 0.5);
}

// CDF of the Student t-distribution.
export function studentTCdf(t: number, df: number): number {
  const half = 0.5 * studentTTwoSidedP(t, df);
  return t > 0 ? 1 - half : half;
}

// Inverse Student t CDF via bisection (used for CI critical values).
export function studentTQuantile(p: number, df: number): number {
  if (p <= 0 || p >= 1) throw new Error("p must be between 0 and 1");
  let lo = -1000;
  let hi = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Lower regularized incomplete gamma P(a, x) via series expansion.
function gammaSeries(a: number, x: number): number {
  const EPS = 3e-14;
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 0; n < 500; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

// Upper regularized incomplete gamma Q(a, x) via continued fraction.
function gammaContinuedFraction(a: number, x: number): number {
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

// Lower regularized incomplete gamma P(a, x).
function lowerRegularizedGamma(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) return gammaSeries(a, x);
  return 1 - gammaContinuedFraction(a, x);
}

// CDF of the chi-square distribution with k degrees of freedom.
export function chiSquareCdf(x: number, k: number): number {
  if (x <= 0) return 0;
  return lowerRegularizedGamma(k / 2, x / 2);
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * absX);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-absX * absX));
  return sign * y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
