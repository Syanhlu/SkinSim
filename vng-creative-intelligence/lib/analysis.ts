export interface RawAdRow {
  creativeId: string;
  creativeName: string;
  period: "history" | "holdout";
  channel: string;
  campaign: string;
  spend: number;
  impressions: number;
  clicks: number;
  installs: number;
  payers: number;
  highValuePlayers: number;
  revenueD7: number;
  predictedLtvD30: number;
  thumbnail: string;
  textHook: string;
  visualMotif: string;
  heroArchetype: string;
  artStyle: string;
}

export interface CreativePerformance extends RawAdRow {
  ctr: number;
  installRate: number;
  payerRate: number;
  highValuePlayerShare: number;
  d7Roas: number;
  pLtvWeightedRoas: number;
  predictedLtvPerInstall: number;
  costPerInstall: number;
  themeKey: string;
}

/**
 * How a creative's theme labels were derived:
 * - "metadata": labels read from the exported ad-platform columns (deterministic fallback).
 * - "llm-vision": labels inferred by a vision model over the creative thumbnail (see lib/vision.ts).
 */
export type ThemeTagSource = "metadata" | "llm-vision";

export interface ThemeTag {
  key: string;
  label: string;
  artStyle: string;
  motif: string;
  hero: string;
  confidence: number;
  source: ThemeTagSource;
  fallbackReason?: string;
}

export interface TaggedCreative extends CreativePerformance {
  theme: ThemeTag;
}

export interface ThemeCluster {
  rank: number;
  themeKey: string;
  themeLabel: string;
  artStyle: string;
  motif: string;
  hero: string;
  creativeCount: number;
  spend: number;
  installs: number;
  payers: number;
  highValuePlayers: number;
  revenueD7: number;
  predictedLtvD30: number;
  highValuePlayerShare: number;
  pLtvWeightedRoas: number;
  d7Roas: number;
  avgCostPerInstall: number;
  shareOfHighValuePlayers: number;
  examples: string[];
  diagnosis: string;
}

export interface CreativeDirection {
  themeKey: string;
  themeLabel: string;
  evidenceRank: number;
  nextCreativePrompt: string;
  rationale: string[];
  avoidTheme?: string;
  avoidReason?: string;
}

export interface AnalysisTotals {
  spend: number;
  installs: number;
  highValuePlayers: number;
  predictedLtvD30: number;
  pLtvWeightedRoas: number;
  highValuePlayerShare: number;
}

export interface AnalysisSnapshot {
  generatedAt: string;
  totals: AnalysisTotals;
  creatives: TaggedCreative[];
  clusters: ThemeCluster[];
  recommendation: CreativeDirection;
}

export interface BacktestResult {
  /** Theme key(s) the agent actually recommended from the history split (top-1, matching recommend_direction). */
  recommendedThemes: string[];
  recommendedLabels: string[];
  /** pLTV-weighted ROAS across the whole holdout portfolio (spend-weighted average of every creative). */
  baselineRoas: number;
  /** pLTV-weighted ROAS of the holdout creatives that fall in the recommended theme(s). */
  selectedRoas: number;
  /** pLTV-weighted ROAS of the holdout creatives the agent did NOT recommend. */
  rejectedRoas: number;
  /** Lift of recommended vs. the full-portfolio average (the headline the brief asks for). */
  liftVsPortfolioPct: number;
  /** Lift of recommended vs. everything the agent rejected (the cleaner counterfactual). */
  liftVsRejectedPct: number;
  selectedSpend: number;
  rejectedSpend: number;
  holdoutSpend: number;
  selectedCreatives: string[];
  selectorComparisons: BaselineComparison[];
  uncertainty: BootstrapLiftResult;
  /** Plain-language description of how the number was produced, surfaced on the dashboard. */
  methodology: string;
}

export type BaselineSelectorId = "agent" | "d7_roas" | "installs" | "spend";

export interface BaselineComparison {
  id: BaselineSelectorId;
  label: string;
  themeKey: string;
  themeLabel: string;
  holdoutRoas: number;
  liftVsPortfolioPct: number;
}

export interface BootstrapLiftResult {
  iterations: number;
  meanLiftPct: number;
  lowerPct: number;
  upperPct: number;
  winProbabilityPct: number;
  permutationPValue: number;
}

const REQUIRED_COLUMNS = [
  "creative_id",
  "creative_name",
  "period",
  "channel",
  "campaign",
  "spend",
  "impressions",
  "clicks",
  "installs",
  "payers",
  "high_value_players",
  "revenue_d7",
  "predicted_ltv_d30",
  "thumbnail",
  "text_hook",
  "visual_motif",
  "hero_archetype",
  "art_style",
];

export function parseAdsCsv(csv: string): RawAdRow[] {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("ads CSV must include a header and at least one row");
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new Error(`ads CSV missing required columns: ${missing.join(", ")}`);
  }

  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
    const period = normalize(row.period);

    if (period !== "history" && period !== "holdout") {
      throw new Error(`row ${index + 2} has invalid period "${row.period}"`);
    }

    return {
      creativeId: row.creative_id,
      creativeName: row.creative_name,
      period,
      channel: row.channel,
      campaign: row.campaign,
      spend: toNumber(row.spend),
      impressions: toNumber(row.impressions),
      clicks: toNumber(row.clicks),
      installs: toNumber(row.installs),
      payers: toNumber(row.payers),
      highValuePlayers: toNumber(row.high_value_players),
      revenueD7: toNumber(row.revenue_d7),
      predictedLtvD30: toNumber(row.predicted_ltv_d30),
      thumbnail: row.thumbnail,
      textHook: row.text_hook,
      visualMotif: row.visual_motif,
      heroArchetype: row.hero_archetype,
      artStyle: row.art_style,
    };
  });
}

export function join_perf_ltv(rows: RawAdRow[]): CreativePerformance[] {
  return rows.map((row) => ({
    ...row,
    ctr: safeDivide(row.clicks, row.impressions),
    installRate: safeDivide(row.installs, row.clicks),
    payerRate: safeDivide(row.payers, row.installs),
    highValuePlayerShare: safeDivide(row.highValuePlayers, row.installs),
    d7Roas: safeDivide(row.revenueD7, row.spend),
    pLtvWeightedRoas: safeDivide(row.predictedLtvD30, row.spend),
    predictedLtvPerInstall: safeDivide(row.predictedLtvD30, row.installs),
    costPerInstall: safeDivide(row.spend, row.installs),
    themeKey: themeKey(row.artStyle, row.visualMotif, row.heroArchetype),
  }));
}

export function tag_themes(records: CreativePerformance[], fallbackReason?: string): TaggedCreative[] {
  return records.map((record) => ({
    ...record,
    theme: {
      key: record.themeKey,
      label: themeLabel(record.artStyle, record.visualMotif, record.heroArchetype),
      artStyle: record.artStyle,
      motif: record.visualMotif,
      hero: record.heroArchetype,
      confidence: themeConfidence(record),
      source: "metadata",
      fallbackReason,
    },
  }));
}

/**
 * Build a ThemeTag from explicit art-style/motif/hero labels using the same key/label
 * normalization as the metadata path, so metadata-tagged and vision-tagged creatives
 * cluster in the same label space. Used by lib/vision.ts.
 */
export function buildThemeTag(
  artStyle: string,
  motif: string,
  hero: string,
  source: ThemeTagSource,
  confidence: number,
  fallbackReason?: string,
): ThemeTag {
  return {
    key: themeKey(artStyle, motif, hero),
    label: themeLabel(artStyle, motif, hero),
    artStyle,
    motif,
    hero,
    confidence: Math.min(0.99, Math.max(0.5, confidence)),
    source,
    fallbackReason,
  };
}

export function cluster(records: TaggedCreative[]): ThemeCluster[] {
  const groups = new Map<string, TaggedCreative[]>();
  for (const record of records) {
    const existing = groups.get(record.theme.key) ?? [];
    existing.push(record);
    groups.set(record.theme.key, existing);
  }

  const totalHighValuePlayers = records.reduce((sum, record) => sum + record.highValuePlayers, 0);
  const clusters = [...groups.values()].map((group) => buildCluster(group, totalHighValuePlayers));

  return clusters
    .sort((a, b) => {
      const byHighValueShare = b.highValuePlayerShare - a.highValuePlayerShare;
      if (Math.abs(byHighValueShare) > 0.0001) return byHighValueShare;
      return b.pLtvWeightedRoas - a.pLtvWeightedRoas;
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function recommend_direction(clusters: ThemeCluster[]): CreativeDirection {
  if (clusters.length === 0) {
    throw new Error("cannot recommend a direction without clusters");
  }

  const sortedByIntent = [...clusters].sort((a, b) => {
    const byShare = b.highValuePlayerShare - a.highValuePlayerShare;
    if (Math.abs(byShare) > 0.0001) return byShare;
    return b.pLtvWeightedRoas - a.pLtvWeightedRoas;
  });
  const top = sortedByIntent[0];
  const averageShare = safeDivide(
    clusters.reduce((sum, item) => sum + item.highValuePlayers, 0),
    clusters.reduce((sum, item) => sum + item.installs, 0),
  );
  const spendHeavyLowIntent = [...clusters]
    .filter((item) => item.highValuePlayerShare < averageShare)
    .sort((a, b) => b.spend - a.spend)[0];

  return {
    themeKey: top.themeKey,
    themeLabel: top.themeLabel,
    evidenceRank: top.rank || 1,
    nextCreativePrompt: [
      `Create a premium ${top.artStyle} skin line built around ${top.motif}.`,
      `Use a ${top.hero} as the anchor character, emphasize status signaling, and keep the first frame readable for UA.`,
      `Avoid casual collection cues that inflate installs without high-value-player share.`,
    ].join(" "),
    rationale: [
      `${top.themeLabel} has the highest high-value-player share at ${formatPercent(top.highValuePlayerShare)}.`,
      `Its pLTV-weighted ROAS is ${top.pLtvWeightedRoas.toFixed(2)}x versus D7 ROAS of ${top.d7Roas.toFixed(2)}x, so the recommendation is based on future value rather than early revenue only.`,
      `The cluster contributes ${formatPercent(top.shareOfHighValuePlayers)} of high-value players while using ${formatMoney(top.spend)} in spend.`,
    ],
    avoidTheme: spendHeavyLowIntent?.themeLabel,
    avoidReason: spendHeavyLowIntent
      ? `${spendHeavyLowIntent.themeLabel} absorbs ${formatMoney(
          spendHeavyLowIntent.spend,
        )} but indexes below the portfolio high-value-player share. Treat it as tourist acquisition until creative or targeting changes.`
      : undefined,
  };
}

export function buildAnalysisSnapshot(csv: string, period: "all" | RawAdRow["period"] = "all"): AnalysisSnapshot {
  const parsed = parseAdsCsv(csv);
  const scoped = period === "all" ? parsed : parsed.filter((row) => row.period === period);
  const creatives = tag_themes(join_perf_ltv(scoped));
  const clusters = cluster(creatives);

  return {
    generatedAt: new Date().toISOString(),
    totals: buildTotals(creatives),
    creatives,
    clusters,
    recommendation: recommend_direction(clusters),
  };
}

export function calculateBacktest(rows: RawAdRow[]): BacktestResult {
  const history = rows.filter((row) => row.period === "history");
  const holdout = rows.filter((row) => row.period === "holdout");

  if (history.length === 0 || holdout.length === 0) {
    throw new Error("backtest requires history and holdout rows");
  }

  // Fit on history only, then evaluate on the untouched holdout split — a true out-of-sample test.
  const historicalClusters = cluster(tag_themes(join_perf_ltv(history)));
  // Use the SAME selection the agent surfaces to the user (recommend_direction's top-1 theme),
  // so the backtested number reflects the recommendation the demo actually makes — not a wider top-k.
  const recommendation = recommend_direction(historicalClusters);
  const recommendedThemes = [recommendation.themeKey];
  const recommendedLabels = [recommendation.themeLabel];

  const baselineHoldout = tag_themes(join_perf_ltv(holdout));
  const selectedHoldout = baselineHoldout.filter((item) => recommendedThemes.includes(item.theme.key));
  const rejectedHoldout = baselineHoldout.filter((item) => !recommendedThemes.includes(item.theme.key));

  const baselineRoas = weightedRoas(baselineHoldout);
  const selectedRoas = weightedRoas(selectedHoldout);
  const rejectedRoas = weightedRoas(rejectedHoldout);
  const selectorComparisons = compareBaselineSelectors(history, holdout);
  const uncertainty = bootstrapLift(holdout, recommendation.themeKey);

  return {
    recommendedThemes,
    recommendedLabels,
    baselineRoas,
    selectedRoas,
    rejectedRoas,
    liftVsPortfolioPct: baselineRoas === 0 ? 0 : ((selectedRoas - baselineRoas) / baselineRoas) * 100,
    liftVsRejectedPct: rejectedRoas === 0 ? 0 : ((selectedRoas - rejectedRoas) / rejectedRoas) * 100,
    selectedSpend: selectedHoldout.reduce((sum, row) => sum + row.spend, 0),
    rejectedSpend: rejectedHoldout.reduce((sum, row) => sum + row.spend, 0),
    holdoutSpend: baselineHoldout.reduce((sum, row) => sum + row.spend, 0),
    selectedCreatives: selectedHoldout.map((row) => row.creativeName),
    selectorComparisons,
    uncertainty,
    methodology:
      "Clusters are fit on the history split only; the agent's top-1 recommended theme (recommend_direction) " +
      "is then measured on the untouched holdout. Lift compares the recommended theme's spend-weighted pLTV ROAS " +
      "against the full holdout portfolio, the rejected themes, and naive baselines for D7 ROAS, installs, and spend. " +
      "The interval is a stratified creative-level bootstrap over selected-theme and portfolio holdout rows; " +
      "the p-value shuffles holdout theme labels.",
  };
}

export function compareBaselineSelectors(history: RawAdRow[], holdout: RawAdRow[]): BaselineComparison[] {
  const historyClusters = cluster(tag_themes(join_perf_ltv(history)));
  const holdoutCreatives = tag_themes(join_perf_ltv(holdout));
  const portfolioRoas = weightedRoas(holdoutCreatives);
  const agent = recommend_direction(historyClusters);
  const selectors: Array<{ id: BaselineSelectorId; label: string; pick: ThemeCluster }> = [
    { id: "agent", label: "Agent HVP-share pick", pick: byKey(historyClusters, agent.themeKey) },
    { id: "d7_roas", label: "Naive D7 ROAS picker", pick: pickByD7Roas(historyClusters) },
    { id: "installs", label: "Naive installs picker", pick: pickByInstalls(historyClusters) },
    { id: "spend", label: "Naive spend picker", pick: pickBySpend(historyClusters) },
  ];

  return selectors.map((selector) => {
    const selected = holdoutCreatives.filter((creative) => creative.theme.key === selector.pick.themeKey);
    const holdoutRoas = weightedRoas(selected);
    return {
      id: selector.id,
      label: selector.label,
      themeKey: selector.pick.themeKey,
      themeLabel: selector.pick.themeLabel,
      holdoutRoas,
      liftVsPortfolioPct: portfolioRoas === 0 ? 0 : ((holdoutRoas - portfolioRoas) / portfolioRoas) * 100,
    };
  });
}

export function pickByD7Roas(clusters: ThemeCluster[]): ThemeCluster {
  return requireCluster(clusters).sort((a, b) => b.d7Roas - a.d7Roas)[0];
}

export function pickByInstalls(clusters: ThemeCluster[]): ThemeCluster {
  return requireCluster(clusters).sort((a, b) => b.installs - a.installs)[0];
}

export function pickBySpend(clusters: ThemeCluster[]): ThemeCluster {
  return requireCluster(clusters).sort((a, b) => b.spend - a.spend)[0];
}

export function bootstrapLift(
  holdoutRows: RawAdRow[],
  selectedThemeKey: string,
  iterations = 5000,
  seed = 20260703,
): BootstrapLiftResult {
  const holdout = tag_themes(join_perf_ltv(holdoutRows.filter((row) => row.period === "holdout")));
  if (holdout.length === 0) {
    return { iterations: 0, meanLiftPct: 0, lowerPct: 0, upperPct: 0, winProbabilityPct: 0, permutationPValue: 1 };
  }

  const rng = mulberry32(seed);
  const observed = liftForTheme(holdout, selectedThemeKey);
  const selectedHoldout = holdout.filter((row) => row.theme.key === selectedThemeKey);
  if (selectedHoldout.length === 0) {
    return { iterations: 0, meanLiftPct: 0, lowerPct: 0, upperPct: 0, winProbabilityPct: 0, permutationPValue: 1 };
  }
  const lifts: number[] = [];
  const permuted: number[] = [];

  for (let i = 0; i < iterations; i += 1) {
    const selectedSample = Array.from(
      { length: selectedHoldout.length },
      () => selectedHoldout[Math.floor(rng() * selectedHoldout.length)],
    );
    const portfolioSample = Array.from({ length: holdout.length }, () => holdout[Math.floor(rng() * holdout.length)]);
    lifts.push(liftBetween(selectedSample, portfolioSample));

    const labels = shuffle(
      holdout.map((row) => row.theme.key),
      rng,
    );
    const relabeled = holdout.map((row, index) => ({
      ...row,
      theme: { ...row.theme, key: labels[index] },
    }));
    permuted.push(liftForTheme(relabeled, selectedThemeKey));
  }

  lifts.sort((a, b) => a - b);
  const pExtreme = (permuted.filter((value) => value >= observed).length + 1) / (iterations + 1);

  return {
    iterations,
    meanLiftPct: average(lifts),
    lowerPct: percentile(lifts, 0.025),
    upperPct: percentile(lifts, 0.975),
    winProbabilityPct: (lifts.filter((value) => value > 0).length / lifts.length) * 100,
    permutationPValue: pExtreme,
  };
}

function buildCluster(group: TaggedCreative[], totalHighValuePlayers: number): ThemeCluster {
  const first = group[0];
  const spend = group.reduce((sum, item) => sum + item.spend, 0);
  const installs = group.reduce((sum, item) => sum + item.installs, 0);
  const payers = group.reduce((sum, item) => sum + item.payers, 0);
  const highValuePlayers = group.reduce((sum, item) => sum + item.highValuePlayers, 0);
  const revenueD7 = group.reduce((sum, item) => sum + item.revenueD7, 0);
  const predictedLtvD30 = group.reduce((sum, item) => sum + item.predictedLtvD30, 0);
  const highValuePlayerShare = safeDivide(highValuePlayers, installs);
  const pLtvWeightedRoas = safeDivide(predictedLtvD30, spend);
  const d7Roas = safeDivide(revenueD7, spend);

  return {
    rank: 0,
    themeKey: first.theme.key,
    themeLabel: first.theme.label,
    artStyle: first.theme.artStyle,
    motif: first.theme.motif,
    hero: first.theme.hero,
    creativeCount: group.length,
    spend,
    installs,
    payers,
    highValuePlayers,
    revenueD7,
    predictedLtvD30,
    highValuePlayerShare,
    pLtvWeightedRoas,
    d7Roas,
    avgCostPerInstall: safeDivide(spend, installs),
    shareOfHighValuePlayers: safeDivide(highValuePlayers, totalHighValuePlayers),
    examples: group.map((item) => item.creativeName),
    diagnosis: clusterDiagnosis(highValuePlayerShare, pLtvWeightedRoas, d7Roas),
  };
}

export function buildTotals(records: TaggedCreative[]): AnalysisTotals {
  const spend = records.reduce((sum, item) => sum + item.spend, 0);
  const installs = records.reduce((sum, item) => sum + item.installs, 0);
  const highValuePlayers = records.reduce((sum, item) => sum + item.highValuePlayers, 0);
  const predictedLtvD30 = records.reduce((sum, item) => sum + item.predictedLtvD30, 0);

  return {
    spend,
    installs,
    highValuePlayers,
    predictedLtvD30,
    pLtvWeightedRoas: safeDivide(predictedLtvD30, spend),
    highValuePlayerShare: safeDivide(highValuePlayers, installs),
  };
}

function weightedRoas(records: TaggedCreative[]): number {
  const spend = records.reduce((sum, item) => sum + item.spend, 0);
  const predictedLtvD30 = records.reduce((sum, item) => sum + item.predictedLtvD30, 0);
  return safeDivide(predictedLtvD30, spend);
}

function liftForTheme(records: TaggedCreative[], selectedThemeKey: string): number {
  const portfolioRoas = weightedRoas(records);
  const selectedRoas = weightedRoas(records.filter((row) => row.theme.key === selectedThemeKey));
  return portfolioRoas === 0 ? 0 : ((selectedRoas - portfolioRoas) / portfolioRoas) * 100;
}

function liftBetween(selected: TaggedCreative[], portfolio: TaggedCreative[]): number {
  const portfolioRoas = weightedRoas(portfolio);
  const selectedRoas = weightedRoas(selected);
  return portfolioRoas === 0 ? 0 : ((selectedRoas - portfolioRoas) / portfolioRoas) * 100;
}

function requireCluster(clusters: ThemeCluster[]): ThemeCluster[] {
  if (clusters.length === 0) throw new Error("selector requires at least one cluster");
  return [...clusters];
}

function byKey(clusters: ThemeCluster[], themeKey: string): ThemeCluster {
  const found = clusters.find((cluster) => cluster.themeKey === themeKey);
  if (!found) throw new Error(`cluster not found for theme ${themeKey}`);
  return found;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor(p * (sortedValues.length - 1))));
  return sortedValues[index];
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clusterDiagnosis(highValuePlayerShare: number, pLtvWeightedRoas: number, d7Roas: number): string {
  if (highValuePlayerShare >= 0.19 && pLtvWeightedRoas >= 2.2) {
    return "High-intent cluster: likely whale/status creative.";
  }
  if (highValuePlayerShare < 0.12 && d7Roas < 1.1) {
    return "Tourist-magnet cluster: installs arrive, value does not.";
  }
  if (pLtvWeightedRoas > d7Roas * 1.5) {
    return "Delayed-value cluster: stronger on pLTV than D7 revenue.";
  }
  return "Mixed cluster: keep testing with tighter audience splits.";
}

function themeConfidence(record: CreativePerformance): number {
  const metadataFilled = [record.artStyle, record.visualMotif, record.heroArchetype, record.textHook].filter(Boolean).length;
  return Math.min(0.96, 0.72 + metadataFilled * 0.05);
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function themeKey(artStyle: string, motif: string, hero: string): string {
  return [artStyle, motif, hero].map(normalize).join("__");
}

function themeLabel(artStyle: string, motif: string, hero: string): string {
  return `${titleCase(artStyle)} / ${titleCase(motif)} / ${titleCase(hero)}`;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function toNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function safeDivide(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}
