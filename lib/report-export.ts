// ─── Client-side verdict report export (PDF via print) ───────────────────────
// Builds a judge-readable, plain-English HTML report from the already-computed
// deterministic stats and opens the browser's print dialog — "Save as PDF"
// produces the document. No API calls, no LLM, no new dependencies: every
// number was produced by the validated stats engine before this module runs.

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
  /** Free-form context rows shown under "The experiment" (label → value). */
  context?: Array<[string, string]>;
}

/** Open the browser print dialog on a formatted report — user saves as PDF. */
export function exportReportPdf(input: VerdictReportInput): void {
  const html = buildReportHtml(input);
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  iframe.srcdoc = html;
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
    win.onafterprint = () => iframe.remove();
    setTimeout(() => iframe.remove(), 120_000);
  };
  document.body.appendChild(iframe);
}

// ─── Report content ───────────────────────────────────────────────────────────

interface VariantRow {
  name: string;
  n: number;
  positive: number | undefined;
  rate: number | undefined;
}

function variantRows(input: VerdictReportInput): VariantRow[] {
  if (input.perVariant && input.perVariant.length > 0) {
    return input.perVariant.map((v) => ({
      name: `Variant ${v.label}`,
      n: v.agents,
      positive: v.bullish,
      rate: v.bullishRate,
    }));
  }
  return input.results.variants.map((v) => ({
    name: v.name,
    n: v.visitors,
    positive: v.conversions,
    rate: v.conversions !== undefined && v.visitors > 0 ? v.conversions / v.visitors : undefined,
  }));
}

const DECISION_MEANING: Record<string, { headline: string; plain: string }> = {
  ship: {
    headline: "SHIP — go ahead with the tested variant.",
    plain:
      "The tested version clearly beat the alternative, the sample was large enough to trust, and no safety check was violated. If this were a real campaign, the data says: launch it.",
  },
  iterate: {
    headline: "ITERATE — promising, but not proven. Do not launch yet.",
    plain:
      "The results lean one way, but the evidence is not strong enough to rule out plain luck. The honest call is to refine the idea or collect a bigger sample — not to ship. Most tools would say yes here; this one refuses to conclude on noise.",
  },
  kill: {
    headline: "KILL — do not ship the tested variant.",
    plain:
      "The evidence is statistically clear, and it points the wrong way: the tested version performed decisively worse than the alternative. Shipping it would waste the budget. The recommendation is to drop or rework this concept.",
  },
};

function pct(x: number | undefined, digits = 1): string {
  return x === undefined ? "—" : `${(x * 100).toFixed(digits)}%`;
}

function pValuePlain(p: number): string {
  if (p < 0.0001) return "less than a 0.01% chance that a gap this large is random luck";
  if (p < 0.01) return `about a ${(p * 100).toFixed(2)}% chance that the gap is random luck`;
  if (p < 0.05) return `about a ${(p * 100).toFixed(1)}% chance that the gap is random luck`;
  return `a ${(p * 100).toFixed(0)}% chance the gap is random luck — far too high to act on`;
}

function formatP(p: number): string {
  return p < 0.0001 ? "< 0.0001" : p.toFixed(4);
}

function signedPp(x: number): string {
  return `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} points`;
}

/** Strip diacritics so "Việt Nam" and "Vietnam" merge into one English label. */
function englishLabel(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯđ]/g, "")
    .replace(/đ/gi, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeSegments(
  winners: Array<{ segment: string; winner: string; delta: number }>,
): Array<{ segment: string; winner: string; delta: number }> {
  const seen = new Map<string, { segment: string; winner: string; delta: number }>();
  for (const w of winners) {
    const key = englishLabel(w.segment).toLowerCase();
    const existing = seen.get(key);
    if (!existing || w.delta > existing.delta) {
      seen.set(key, { ...w, segment: englishLabel(w.segment) });
    }
  }
  return [...seen.values()].sort((a, b) => b.delta - a.delta);
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ─── HTML assembly ────────────────────────────────────────────────────────────

function buildReportHtml(input: VerdictReportInput): string {
  const { results, significance, recommendation } = input;
  const rows = variantRows(input);
  const [control, treatment] = rows;
  const decision = recommendation.decision;
  const meaning = DECISION_MEANING[decision] ?? DECISION_MEANING.iterate;
  const [lo, hi] = significance.ci95;
  const generated = new Date().toUTCString();

  const winnerRow =
    control && treatment && control.rate !== undefined && treatment.rate !== undefined
      ? control.rate >= treatment.rate
        ? { better: control, worse: treatment }
        : { better: treatment, worse: control }
      : null;

  const headlineSentence = winnerRow
    ? `Out of ${control.n.toLocaleString()} simulated consumers shown each version, ` +
      `${escapeHtml(winnerRow.better.name)} convinced ${pct(winnerRow.better.rate)} of its audience while ` +
      `${escapeHtml(winnerRow.worse.name)} convinced ${pct(winnerRow.worse.rate)} — a gap of ` +
      `${Math.abs((winnerRow.better.rate! - winnerRow.worse.rate!) * 100).toFixed(1)} percentage points.`
    : "The two versions were shown to matched simulated audiences and their final opinions were compared.";

  const gapIsReal = significance.significant
    ? "The statistics engine checked whether a gap this large could happen by chance — and it effectively cannot. This difference is real (within the simulation)."
    : "The statistics engine checked whether this gap could happen by chance — and it plausibly could. That is exactly why the system refuses to declare a winner from this data.";

  const segments = dedupeSegments(input.segmentWinners ?? []);

  const contextRows = (input.context ?? [])
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
    .join("");

  const variantTable = rows
    .map(
      (v) =>
        `<tr><td><b>${escapeHtml(v.name)}</b></td><td class="num">${v.n.toLocaleString()}</td>` +
        `<td class="num">${v.positive?.toLocaleString() ?? "—"}</td><td class="num">${pct(v.rate)}</td></tr>`,
    )
    .join("");

  const segmentSection =
    segments.length > 0
      ? `<h2>Who preferred what</h2>
         <p class="gloss">The same result, broken down by audience group. "+64 points" means that within that group,
         the winning version convinced 64 more people out of every 100 than the losing one.</p>
         <table><thead><tr><th>Audience group</th><th>Preferred</th><th class="num">Margin</th></tr></thead><tbody>
         ${segments
           .map(
             (s) =>
               `<tr><td>${escapeHtml(s.segment)}</td><td>Variant ${escapeHtml(s.winner)}</td><td class="num">+${s.delta} points</td></tr>`,
           )
           .join("")}
         </tbody></table>`
      : "";

  const guardrailSection = input.guardrails
    ? `<h2>Safety checks</h2>
       <p class="gloss">Besides the main question, the engine watches "guardrail" metrics — things that must not get worse
       even if the main number improves (imagine a promo that lifts sales but crashes the app).</p>
       <p><b>${input.guardrails.passed ? "All safety checks passed." : "Attention needed:"}</b></p>
       ${
         input.guardrails.checks.length > 0
           ? `<ul>${input.guardrails.checks
               .map((c) => `<li><b>${escapeHtml(c.name)}</b>: ${escapeHtml(c.status)} — ${escapeHtml(c.rationale)}</li>`)
               .join("")}</ul>`
           : ""
       }`
    : "";

  const caveatSection =
    recommendation.caveats.length > 0
      ? `<h2>Watch-outs</h2><ul>${recommendation.caveats.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(input.title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; color: #26231d; font-size: 11.5px; line-height: 1.55; margin: 0; }
  h1 { font-size: 21px; margin: 0 0 2px; }
  .sub { color: #6b6558; margin: 0 0 14px; font-size: 11px; }
  h2 { font-size: 13.5px; margin: 18px 0 6px; border-bottom: 1.5px solid #26231d; padding-bottom: 3px; }
  p { margin: 6px 0; }
  .gloss { color: #6b6558; font-style: italic; }
  .verdict-box { border: 2.5px solid ${decision === "ship" ? "#1f7a4d" : decision === "kill" ? "#c2452d" : "#a96a10"}; border-radius: 10px; padding: 12px 14px; margin: 12px 0; }
  .verdict-word { font-size: 24px; font-weight: 800; letter-spacing: 0.04em; color: ${decision === "ship" ? "#1f7a4d" : decision === "kill" ? "#c2452d" : "#a96a10"}; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { border: 1px solid #c9c2b2; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f3efe3; font-weight: 700; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  ul, ol { margin: 6px 0 6px 18px; padding: 0; }
  li { margin: 3px 0; }
  .footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #c9c2b2; color: #6b6558; font-size: 10px; }
</style>
</head>
<body>

<h1>${escapeHtml(input.title)}</h1>
<p class="sub">Generated ${generated} · Agamotto synthetic A/B testing</p>

<h2>What you are looking at</h2>
<p>This report is the outcome of a <b>synthetic A/B test</b>: two versions of a marketing concept were shown to a
simulated crowd of consumers — AI characters grounded in real Vietnamese census records (age, region, occupation) —
who read, posted, argued, and made up their minds over dozens of rounds on a simulated social network. Because the
<i>same</i> crowd experiences both versions in two parallel timelines, this is a perfectly controlled experiment:
any difference in opinion can only come from the concept itself, never from testing on different people.</p>
${contextRows ? `<h2>The experiment</h2><table><tbody>${contextRows}</tbody></table>` : ""}

<h2>The verdict</h2>
<div class="verdict-box">
  <div class="verdict-word">${escapeHtml(decision.toUpperCase())}</div>
  <p><b>${escapeHtml(meaning.headline)}</b></p>
  <p>${escapeHtml(meaning.plain)}</p>
  <p class="gloss">Engine rationale: ${escapeHtml(recommendation.rationale)} (confidence ${(recommendation.confidence * 100).toFixed(0)}%)</p>
</div>

<h2>The headline result</h2>
<p>${headlineSentence}</p>
<p>${gapIsReal}</p>
<table>
  <thead><tr><th>Version</th><th class="num">Audience size</th><th class="num">Convinced</th><th class="num">Rate</th></tr></thead>
  <tbody>${variantTable}</tbody>
</table>

<h2>The numbers, explained for humans</h2>
<table>
  <thead><tr><th>Statistic</th><th>Value</th><th>What it means in plain English</th></tr></thead>
  <tbody>
    <tr><td>Metric</td><td>${escapeHtml(results.metric)}</td>
        <td>What was being measured: the share of the audience that ended up positive about the concept.</td></tr>
    <tr><td>Effect</td><td>${signedPp(significance.effect)}</td>
        <td>How much the tested version moved the needle versus the alternative, in people per hundred.
        ${signedPp(significance.effect)} means ${Math.abs(significance.effect * 100).toFixed(0)} ${significance.effect < 0 ? "fewer" : "more"} people out of every 100 were convinced.</td></tr>
    <tr><td>p-value</td><td>${formatP(significance.pValue)}</td>
        <td>The chance the observed gap is a fluke: here, ${pValuePlain(significance.pValue)}.</td></tr>
    <tr><td>95% confidence interval</td><td>[${(lo * 100).toFixed(1)}, ${(hi * 100).toFixed(1)}] points</td>
        <td>The range where the true gap most plausibly lies. If this range includes zero, "no difference at all" is still on the table.</td></tr>
    <tr><td>Statistical test</td><td>${escapeHtml(significance.test.replaceAll("_", " "))}</td>
        <td>The standard textbook method for comparing two conversion rates — the same math a pharma trial or a Google experiment would use.</td></tr>
    <tr><td>Significant at α = ${results.alpha}?</td><td>${significance.significant ? "Yes" : "No"}</td>
        <td>${significance.significant ? "The gap passes the standard bar of scientific evidence." : "The gap does not pass the standard bar of evidence — it could be noise."}</td></tr>
  </tbody>
</table>

${segmentSection}

<h2>How this experiment worked, step by step</h2>
<ol>
  <li><b>Build the audience.</b> AI personas are generated from the scenario and anchored to real census records — a student in Da Nang, an office worker in Hanoi, a skeptical reviewer — each with their own personality, budget and biases.</li>
  <li><b>Split reality in two.</b> The identical crowd is placed in two parallel simulations. One sees Version A, the other sees Version B. Same people, two realities.</li>
  <li><b>Let them react.</b> For dozens of simulated hours the characters post, comment, argue and influence each other on a simulated social network.</li>
  <li><b>Measure opinions.</b> At the end, each character's final stance — convinced, neutral, or against — is recorded on both sides.</li>
  <li><b>Do the math honestly.</b> A deterministic statistics engine compares the two sides. The AI language model narrates the story but <b>never computes a single number</b>.</li>
</ol>

<h2>Why these numbers can be trusted</h2>
<p>Every statistical routine in the engine is validated against <b>scipy and statsmodels</b> — the reference scientific
computing libraries — to four decimal places, and a decision test-suite verifies the system makes the statistically
correct call on experiments with known outcomes. Crucially, the language model is architecturally locked out of the
math: it can choose which test to run and explain the result, but the numbers come only from deterministic code.
The system is also designed to say <i>"not enough evidence"</i> — when results look exciting but the sample is too
small, it refuses to conclude rather than flattering the user.</p>

${guardrailSection}
${caveatSection}

<h2>Honest limitations</h2>
<ul>
  <li><b>Synthetic, not human.</b> These are AI consumers grounded in census data — strong directional evidence for comparing concepts, not a replacement for testing with real customers before a full launch.</li>
  <li><b>Sample size.</b> The verdict above compares one simulation per version. Repeated runs add spread; treat single-run margins as indicative, repeated-run agreement as convincing.</li>
  <li><b>Test choice.</b> The current test treats the two sides as independent samples, even though the same personas appear in both. A paired analysis (planned) would typically be even stronger.</li>
</ul>

<p class="footer">Report generated locally by Agamotto — hypothesis in, rigorous verdict out. Every figure above was
computed by the deterministic statistics engine; the AI wrote none of the numbers.</p>

</body>
</html>`;
}
