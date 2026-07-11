// ─── World verdict — real statistics, never LLM math ────────────────────────
// Pools each variant's FINAL-frame agent stances into a binary observation
// (bullish = conversion) and runs the validated two-proportion z-test from
// lib/stats.ts, then maps to SHIP/ITERATE/KILL via lib/experiment.ts
// recommend(). Both imports are READ-ONLY reuse of the shared stats engine.

import { significanceTest, type ExperimentResults, type SignificanceResult } from "../stats";
import { checkGuardrails, recommend, type Recommendation } from "../experiment";
import type { WorldTimeline } from "./types";

export interface WorldVerdict {
  results: ExperimentResults;
  significance: SignificanceResult;
  recommendation: Recommendation;
  perVariant: Array<{
    label: string;
    agents: number;
    bullish: number;
    bullishRate: number;
  }>;
  /** Winner per demographic segment (region), for the lens chips. */
  segmentWinners: Array<{ segment: string; winner: string; delta: number }>;
}

export function computeWorldVerdict(a: WorldTimeline, b: WorldTimeline): WorldVerdict | null {
  const statsA = finalStanceCounts(a);
  const statsB = finalStanceCounts(b);
  if (!statsA || !statsB) return null;

  const results: ExperimentResults = {
    id: `world-${a.variantLabel}-vs-${b.variantLabel}`,
    metric: "positive stance rate",
    metricType: "binary",
    primaryUnit: "agents",
    alpha: 0.05,
    // The audience is fixed — the sample IS the population of the sim, so the
    // planned n equals the observed n (no underpowered trap on replay data).
    requiredSampleSizePerVariant: Math.min(statsA.agents, statsB.agents),
    plannedDays: 1,
    observedDays: 1,
    variants: [
      { name: "control", visitors: statsA.agents, conversions: statsA.bullish },
      { name: "treatment", visitors: statsB.agents, conversions: statsB.bullish },
    ],
    guardrails: [],
    notes: [
      `variant ${a.variantLabel}: ${statsA.bullish}/${statsA.agents} bullish`,
      `variant ${b.variantLabel}: ${statsB.bullish}/${statsB.agents} bullish`,
    ],
  };

  const significance = significanceTest(results);
  const guardrails = checkGuardrails(results);
  const recommendation = recommend({
    desiredDirection: "increase",
    significance,
    guardrails,
    results,
  });

  return {
    results,
    significance,
    recommendation,
    perVariant: [
      { label: a.variantLabel, agents: statsA.agents, bullish: statsA.bullish, bullishRate: statsA.bullish / statsA.agents },
      { label: b.variantLabel, agents: statsB.agents, bullish: statsB.bullish, bullishRate: statsB.bullish / statsB.agents },
    ],
    segmentWinners: segmentWinners(a, b),
  };
}

function finalStanceCounts(timeline: WorldTimeline): { agents: number; bullish: number } | null {
  const frame = timeline.frames[timeline.frames.length - 1];
  if (!frame || timeline.agents.length === 0) return null;
  let bullish = 0;
  for (const agent of timeline.agents) {
    if (frame.states[agent.id]?.stance === "bullish") bullish++;
  }
  return { agents: timeline.agents.length, bullish };
}

function segmentWinners(
  a: WorldTimeline,
  b: WorldTimeline,
): Array<{ segment: string; winner: string; delta: number }> {
  const lastA = a.frames[a.frames.length - 1];
  const lastB = b.frames[b.frames.length - 1];
  if (!lastA || !lastB) return [];

  const segments = new Map<string, { a: [number, number]; b: [number, number] }>();
  for (const agent of a.agents) {
    const segment = agent.demographics.region ?? "unknown";
    if (!segments.has(segment)) segments.set(segment, { a: [0, 0], b: [0, 0] });
    const entry = segments.get(segment)!;
    entry.a[1] += 1;
    if (lastA.states[agent.id]?.stance === "bullish") entry.a[0] += 1;
    // Same people on both sides — look the agent up in B's final frame too.
    entry.b[1] += 1;
    if (lastB.states[agent.id]?.stance === "bullish") entry.b[0] += 1;
  }

  const winners: Array<{ segment: string; winner: string; delta: number }> = [];
  for (const [segment, { a: ca, b: cb }] of segments) {
    if (ca[1] < 4) continue; // skip tiny segments — a 2-person "winner" is noise
    const rateA = ca[0] / ca[1];
    const rateB = cb[0] / cb[1];
    const delta = rateB - rateA;
    if (Math.abs(delta) < 0.005) continue;
    winners.push({
      segment,
      winner: delta > 0 ? b.variantLabel : a.variantLabel,
      delta: Math.round(Math.abs(delta) * 1000) / 10,
    });
  }
  return winners.sort((x, y) => y.delta - x.delta).slice(0, 6);
}
