// ─── Client-side verdict report export ───────────────────────────────────────
// Formats the already-computed deterministic stats (lib/stats.ts via the
// verdict/readout pipelines) into a markdown report and triggers a browser
// download. No API calls, no LLM — every number in the report was produced by
// the validated stats engine before this module ever runs.

import type { ExperimentResults, SignificanceResult } from "./stats";
import type { GuardrailReport, Recommendation } from "./experiment";

export interface VerdictReportInput {
  title: string;
  results: ExperimentResults;
  significance: SignificanceResult;
  recommendation: Recommendation;
  guardrails?: GuardrailReport;
  /** Per-variant stance/conversion rows, e.g. from WorldVerdict.perVariant. */
  perVariant?: Array<{ label: string; agents: number; bullish: number; bullishRate: number }>;
  segmentWinners?: Array<{ segment: string; winner: string; delta: number }>;
  /** Free-form context rows appended to the header table (label → value). */
  context?: Array<[string, string]>;
}

export function buildVerdictReport(input: VerdictReportInput): string {
  const { title, results, significance, recommendation, guardrails, perVariant, segmentWinners, context } = input;
  const [lo, hi] = significance.ci95;
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`## Verdict: ${recommendation.decision.toUpperCase()}`);
  lines.push("");
  lines.push(recommendation.rationale);
  lines.push("");

  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| Metric | ${results.metric} |`);
  lines.push(`| Test | ${significance.test.replaceAll("_", " ")} |`);
  lines.push(`| p-value | ${formatP(significance.pValue)} |`);
  lines.push(`| Effect | ${signed(significance.effect * 100)}pp |`);
  lines.push(`| 95% CI | [${(lo * 100).toFixed(1)}, ${(hi * 100).toFixed(1)}]pp |`);
  lines.push(`| Significant at α=${results.alpha} | ${significance.significant ? "yes" : "no"} |`);
  lines.push(`| Confidence in call | ${(recommendation.confidence * 100).toFixed(0)}% |`);
  for (const [label, value] of context ?? []) {
    lines.push(`| ${label} | ${value} |`);
  }
  lines.push("");

  lines.push("## Variants");
  lines.push("");
  if (perVariant && perVariant.length > 0) {
    lines.push("| Variant | Agents | Positive stance | Rate |");
    lines.push("|---|---:|---:|---:|");
    for (const v of perVariant) {
      lines.push(`| ${v.label} | ${v.agents} | ${v.bullish} | ${(v.bullishRate * 100).toFixed(1)}% |`);
    }
  } else {
    lines.push("| Variant | Sample | Conversions | Rate |");
    lines.push("|---|---:|---:|---:|");
    for (const v of results.variants) {
      lines.push(`| ${v.name} | ${v.visitors} | ${v.conversions ?? "—"} | ${rate(v.conversions, v.visitors)} |`);
    }
  }
  lines.push("");

  if (segmentWinners && segmentWinners.length > 0) {
    lines.push("## Segment winners");
    lines.push("");
    lines.push("| Segment | Winner | Delta |");
    lines.push("|---|---|---:|");
    for (const s of segmentWinners) {
      lines.push(`| ${s.segment} | ${s.winner} | +${s.delta}pp |`);
    }
    lines.push("");
  }

  if (guardrails) {
    lines.push("## Safety checks");
    lines.push("");
    lines.push(guardrails.passed ? "All clear." : "Something needs attention:");
    for (const check of guardrails.checks ?? []) {
      lines.push(`- ${check.name}: ${check.status}${check.rationale ? ` — ${check.rationale}` : ""}`);
    }
    lines.push("");
  }

  if (recommendation.caveats.length > 0) {
    lines.push("## Watch-outs");
    lines.push("");
    for (const caveat of recommendation.caveats) lines.push(`- ${caveat}`);
    lines.push("");
  }

  for (const note of results.notes ?? []) {
    lines.push(`> ${note}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    "_Every number above comes from the deterministic statistics engine (validated against scipy/statsmodels); the language model computes none of them._",
  );
  lines.push("");

  return lines.join("\n");
}

/** Trigger a browser download of the report. Client-side only. */
export function downloadReport(filename: string, markdown: string): void {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function reportFilename(prefix: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  return `${prefix}-${stamp}.md`;
}

function formatP(p: number): string {
  if (p < 0.0001) return "< 0.0001";
  return p.toFixed(4);
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
}

function rate(conversions: number | undefined, visitors: number): string {
  if (conversions === undefined || visitors === 0) return "—";
  return `${((conversions / visitors) * 100).toFixed(1)}%`;
}
