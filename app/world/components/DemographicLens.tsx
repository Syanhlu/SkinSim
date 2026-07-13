"use client";

// ─── DemographicLens (plan §4.2) — Region / Age / Off tint toggle ────────────

import type { WorldAgent } from "@/lib/world/types";
import { hashSeed } from "@/lib/world/seed";

export type LensMode = "off" | "region" | "age";

const LENS_PALETTE = [
  "#c2452d", // warm red
  "#1f7a72", // teal
  "#a96a10", // ochre
  "#5b6ee1", // periwinkle
  "#8a4fa3", // plum
  "#2d7a35", // leaf
  "#b3376b", // raspberry
  "#54707d", // slate
  "#946b3d", // tan
  "#3a8fb5", // sky
];

export function agentSegment(agent: WorldAgent, mode: LensMode): string | null {
  if (mode === "region") return agent.demographics.region ?? "other";
  if (mode === "age") {
    const age = agent.demographics.age;
    if (age === undefined) return "?";
    if (age < 20) return "<20";
    if (age < 30) return "20–29";
    if (age < 40) return "30–39";
    return "40+";
  }
  return null;
}

export function segmentColor(segment: string): string {
  return LENS_PALETTE[hashSeed(`lens:${segment}`) % LENS_PALETTE.length];
}

export function lensLegend(agents: WorldAgent[], mode: LensMode): Array<{ label: string; color: string }> {
  if (mode === "off") return [];
  const counts = new Map<string, number>();
  for (const agent of agents) {
    const segment = agentSegment(agent, mode);
    if (segment) counts.set(segment, (counts.get(segment) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label]) => ({ label, color: segmentColor(label) }));
}

export default function DemographicLens({
  mode,
  onChange,
  agents,
}: {
  mode: LensMode;
  onChange: (mode: LensMode) => void;
  agents: WorldAgent[];
}) {
  const legend = lensLegend(agents, mode);
  const chips: Array<{ value: LensMode; label: string }> = [
    { value: "region", label: "Region" },
    { value: "age", label: "Age" },
    { value: "off", label: "Off" },
  ];
  return (
    <div className="demographic-lens">
      {chips.map((chip) => (
        <button
          key={chip.value}
          type="button"
          className={`lens-chip${mode === chip.value ? " active" : ""}`}
          onClick={() => onChange(chip.value)}
        >
          {chip.label}
        </button>
      ))}
      {legend.length > 0 && (
        <span className="lens-legend">
          {legend.map((item) => (
            <span key={item.label} className="legend-item">
              <span className="legend-dot" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
