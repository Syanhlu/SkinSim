"use client";

// ─── VerdictOverlay (plan §4.2) — SHIP / ITERATE / KILL, real statistics ─────
// All numbers come from lib/stats.ts (two-proportion z-test) via
// lib/world/verdict.ts — the UI only renders them.

import type { WorldVerdict } from "@/lib/world/verdict";
import { exportReportPdf } from "@/lib/report-export";

export default function VerdictOverlay({
  verdict,
  onClose,
}: {
  verdict: WorldVerdict;
  onClose: () => void;
}) {
  const { results, significance, recommendation, perVariant, segmentWinners } = verdict;
  const decision = recommendation.decision.toUpperCase();
  const [lo, hi] = significance.ci95;

  const exportReport = () => {
    const labels = perVariant.map((v) => v.label).join(" vs ");
    exportReportPdf({
      title: `Agamotto Experiment Report — Variant ${labels}`,
      results,
      significance,
      recommendation,
      perVariant,
      segmentWinners,
    });
  };

  return (
    <div className="verdict-dim" onClick={onClose}>
      <div className="verdict-card" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="verdict-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <span className={`verdict-badge decision-${recommendation.decision}`}>{decision}</span>
        <div className="verdict-stats">
          {perVariant.map((variant) => (
            <div key={variant.label}>
              Reality <b>{variant.label}</b>: {variant.bullish}/{variant.agents} bullish (
              {(variant.bullishRate * 100).toFixed(1)}%)
            </div>
          ))}
          <div>
            p-value <b>{formatP(significance.pValue)}</b> · effect{" "}
            <b>
              {significance.effect >= 0 ? "+" : ""}
              {(significance.effect * 100).toFixed(1)}pp
            </b>{" "}
            · 95% CI <b>[{(lo * 100).toFixed(1)}, {(hi * 100).toFixed(1)}]pp</b>
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{significance.details}</div>
        </div>
        <p className="verdict-rationale">{recommendation.rationale}</p>
        {segmentWinners.length > 0 && (
          <div className="segment-chips">
            {segmentWinners.map((winner) => (
              <span key={winner.segment} className="segment-chip">
                {winner.segment}: {winner.winner} +{winner.delta}pp
              </span>
            ))}
          </div>
        )}
        <button type="button" className="verdict-export" onClick={exportReport}>
          ⬇ Export report (PDF)
        </button>
      </div>
    </div>
  );
}

function formatP(p: number): string {
  if (p < 0.0001) return "< 0.0001";
  return p.toFixed(4);
}
