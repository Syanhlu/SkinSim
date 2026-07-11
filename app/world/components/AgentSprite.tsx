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
  const bodyType = seed % 3;
  const headShape = Math.floor(seed / 7) % 3;
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
      <div className="sprite-inner" style={{ animationDelay: `${swayDelay}ms` }}>
        <svg viewBox="0 0 44 62" width="100%" height="100%">
          {/* lens halo under the feet */}
          <ellipse className="lens-halo" cx="22" cy="59" rx="13" ry="3.4" fill={halo ?? "none"} />
          <Body bodyType={bodyType} />
          <Head headShape={headShape} stance={snapshot.stance} />
          {/* bullish spark */}
          <g className="sprite-mark mark-spark">
            <path d="M36 8 l1.4 3.2 3.2 1.4 -3.2 1.4 -1.4 3.2 -1.4 -3.2 -3.2 -1.4 3.2 -1.4 z" />
          </g>
          {/* bearish scribble cloud */}
          <g className="sprite-mark mark-cloud" fill="none" strokeWidth="1.3" strokeLinecap="round">
            <path d="M31 6 q3 -4 6 -1 q3 3 -1 5 q-4 2 -6 -1 q-1.5 -2 1 -3 z M30 4 l3 4 M35 3 l2 5" />
          </g>
        </svg>
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

function Body({ bodyType }: { bodyType: number }) {
  const stroke = 2;
  if (bodyType === 0) {
    // stick figure
    return (
      <g className="sprite-ink" fill="none" strokeWidth={stroke} strokeLinecap="round">
        <path d="M22 26 L22 46" />
        <path d="M22 31 L13 39 M22 31 L31 38" />
        <path d="M22 46 L15 59 M22 46 L29 59" />
      </g>
    );
  }
  if (bodyType === 1) {
    // round belly
    return (
      <g strokeWidth={stroke} strokeLinecap="round">
        <ellipse className="sprite-ink sprite-fill" cx="22" cy="38" rx="10" ry="11" />
        <path className="sprite-ink" fill="none" d="M12 36 L6 43 M32 36 L38 42" />
        <path className="sprite-ink" fill="none" d="M18 48 L16 59 M26 48 L28 59" />
      </g>
    );
  }
  // boxy torso
  return (
    <g strokeWidth={stroke} strokeLinecap="round">
      <rect className="sprite-ink sprite-fill" x="14" y="27" width="16" height="20" rx="4" />
      <path className="sprite-ink" fill="none" d="M14 32 L7 40 M30 32 L37 39" />
      <path className="sprite-ink" fill="none" d="M18 47 L16 59 M26 47 L28 59" />
    </g>
  );
}

function Head({ headShape, stance }: { headShape: number; stance: string }) {
  const mouth =
    stance === "bullish" ? (
      <path d="M18 18 q4 3.4 8 0" fill="none" strokeWidth="1.4" />
    ) : stance === "bearish" ? (
      <path d="M18 20 q4 -3 8 0" fill="none" strokeWidth="1.4" />
    ) : (
      <path d="M19 19 L26 19" fill="none" strokeWidth="1.4" />
    );

  return (
    <g className="sprite-ink" strokeWidth="2" strokeLinecap="round">
      {headShape === 0 && <circle className="sprite-fill" cx="22" cy="14" r="9.5" />}
      {headShape === 1 && <rect className="sprite-fill" x="13" y="5" width="18" height="17" rx="3.5" />}
      {headShape === 2 && <rect className="sprite-fill" x="15" y="2" width="14" height="21" rx="5" />}
      <circle cx="18.5" cy="13" r="1.3" fill="currentColor" stroke="none" style={{ fill: "var(--ink)" }} />
      <circle cx="25.5" cy="13" r="1.3" stroke="none" style={{ fill: "var(--ink)" }} />
      {mouth}
    </g>
  );
}

const AgentSprite = memo(AgentSpriteImpl);
export default AgentSprite;
