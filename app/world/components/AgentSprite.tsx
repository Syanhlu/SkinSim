"use client";

// ─── AgentSprite (plan §4.2) — hand-drawn inline-SVG character ───────────────
// 3 body types × 3 head shapes picked from avatarSeed. Stance drives tint,
// expression, lean, and drift (positions come from the store). Memoized: the
// sprite re-renders only when ITS OWN snapshot changes (per-agent
// useSyncExternalStore subscription), never on whole-frame updates.

import { memo, useMemo, useSyncExternalStore } from "react";
import type { WorldAgent } from "@/lib/world/types";
import type { WorldStore, AgentSnapshot } from "@/lib/world/store";
import { agentSegment, segmentColor, type LensMode } from "./DemographicLens";
import LottieAgent from "./LottieAgent";

interface AgentSpriteProps {
  agent: WorldAgent;
  store: WorldStore;
  lens: LensMode;
  silhouette?: boolean;
  /** Agent has pre-recorded interview answers — marked so replay users click the right people. */
  isHighlighted?: boolean;
  onClick?: (agent: WorldAgent) => void;
}

const FALLBACK_SNAPSHOT: AgentSnapshot = { stance: "unknown", x: 50, y: 70, talking: false };

function AgentSpriteImpl({ agent, store, lens, silhouette, isHighlighted, onClick }: AgentSpriteProps) {
  const subscribe = useMemo(() => store.subscribeAgent(agent.id), [store, agent.id]);
  const snapshot =
    useSyncExternalStore(
      subscribe,
      () => store.getAgentSnapshot(agent.id),
      () => store.getAgentSnapshot(agent.id),
    ) ?? FALLBACK_SNAPSHOT;

  const seed = agent.avatarSeed >>> 0;
  const swayDelay = -(seed % 3400);

  // Bullish agents face (and lean toward) the TV at x=50; bearish turn away.
  const tvIsLeft = snapshot.x > 50;
  let facingLeft = tvIsLeft;
  let lean = 0;
  if (snapshot.stance === "bullish") {
    facingLeft = tvIsLeft;
    lean = tvIsLeft ? -3.5 : 3.5;
  } else if (snapshot.stance === "bearish") {
    facingLeft = !tvIsLeft;
    lean = tvIsLeft ? 2.5 : -2.5;
  } else {
    facingLeft = seed % 2 === 0;
  }

  const segment = agentSegment(agent, lens);
  const halo = segment ? segmentColor(segment) : undefined;

  const meta = [
    agent.demographics.age !== undefined ? `${agent.demographics.age}t` : null,
    agent.demographics.occupation,
    agent.demographics.region,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={[
        "agent-sprite",
        `stance-${snapshot.stance}`,
        facingLeft ? "facing-left" : "",
        segment ? "lens-on" : "",
        silhouette ? "silhouette" : "",
        isHighlighted ? "highlighted" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ left: `${snapshot.x}%`, top: `${snapshot.y}%`, rotate: `${lean}deg` }}
      onClick={() => onClick?.(agent)}
      role="button"
      aria-label={`Interview ${agent.name}`}
    >
      {/* lens halo under the feet */}
      <svg className="halo-layer" viewBox="0 0 44 62" aria-hidden>
        <ellipse className="lens-halo" cx="22" cy="59" rx="13" ry="3.4" fill={halo ?? "none"} />
      </svg>
      <div className="sprite-inner" style={{ animationDelay: `${swayDelay}ms` }}>
        <LottieAgent stance={snapshot.stance} seed={seed} />
      </div>
      {isHighlighted && !silhouette && <span className="interview-flag">hỏi tôi!</span>}
      <div className="agent-tooltip">
        <div className="tooltip-name">{agent.name}</div>
        {meta && <div className="tooltip-meta">{meta}</div>}
        <div className="tooltip-persona">{agent.personaSummary}</div>
      </div>
    </div>
  );
}

const AgentSprite = memo(AgentSpriteImpl);
export default AgentSprite;
