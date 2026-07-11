"use client";

// ─── WorldCanvas (plan §4.2) — one half of the split world ──────────────────
// Grass-textured paper stage, agents scattered by the store's seeded layout,
// TV at the center of the half, speech bubbles on top. Positions are % based
// so resizing is safe.

import type { WorldAgent, WorldTimeline } from "@/lib/world/types";
import type { WorldStore } from "@/lib/world/store";
import AgentSprite from "./AgentSprite";
import TVBillboard from "./TVBillboard";
import BubbleField from "./SpeechBubble";
import type { LensMode } from "./DemographicLens";

export default function WorldCanvas({
  store,
  variantLabel,
  injectionText,
  variantClass,
  lens,
  silhouette,
  onAgentClick,
}: {
  store: WorldStore;
  variantLabel: string;
  injectionText: string;
  variantClass: "variant-a" | "variant-b";
  lens: LensMode;
  /** Render agents as gray silhouettes ("preparing audience…"). */
  silhouette?: boolean;
  onAgentClick?: (agent: WorldAgent) => void;
}) {
  return (
    <div className={`world-half ${variantClass}`}>
      <div className="world-ground" />
      <span className="variant-tag">
        {variantLabel === "A" ? "Reality A" : variantLabel === "B" ? "Reality B" : variantLabel}
      </span>
      <TVBillboard store={store} variantLabel={variantLabel} injectionText={injectionText} />
      {store.agents.map((agent) => (
        <AgentSprite
          key={agent.id}
          agent={agent}
          store={store}
          lens={lens}
          silhouette={silhouette}
          onClick={onAgentClick}
        />
      ))}
      <BubbleField store={store} />
    </div>
  );
}

/** Convenience for callers that only have the timeline. */
export function timelineVariantClass(timeline: WorldTimeline): "variant-a" | "variant-b" {
  return timeline.variantLabel.toUpperCase() === "B" ? "variant-b" : "variant-a";
}
