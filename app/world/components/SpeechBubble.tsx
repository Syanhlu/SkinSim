"use client";

// ─── SpeechBubble + BubbleField (plan §4.2) ──────────────────────────────────
// Real Vietnamese post text, ≤ ~90 chars, scale-in pop, ~4s TTL, max 6 on
// screen — extra posts queue and drain as slots free so the world never soups.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { WorldStore, FramePost } from "@/lib/world/store";

const MAX_BUBBLES = 6;
const TTL_MS = 4000;
const MAX_QUEUE = 12;

interface ActiveBubble {
  key: string;
  agentId: string;
  text: string;
  platform: string;
  x: number;
  y: number;
}

export function BubbleField({ store, hiddenAgentId }: { store: WorldStore; hiddenAgentId?: string | null }) {
  const meta = useSyncExternalStore(store.subscribeMeta, store.getMeta, store.getMeta);
  const [bubbles, setBubbles] = useState<ActiveBubble[]>([]);
  const queue = useRef<FramePost[]>([]);
  const activeCount = useRef(0);
  const counter = useRef(0);
  const seenFrame = useRef(-1);

  useEffect(() => {
    if (meta.frameIndex === seenFrame.current) return;
    seenFrame.current = meta.frameIndex;
    const posts = store.getLatestPosts();
    if (posts.length > 0) {
      queue.current = [...queue.current, ...posts].slice(-MAX_QUEUE);
      drain();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.frameIndex]);

  function drain() {
    // Build additions OUTSIDE setState so the updater stays pure (StrictMode-safe).
    const additions: ActiveBubble[] = [];
    while (activeCount.current + additions.length < MAX_BUBBLES && queue.current.length > 0) {
      const post = queue.current.shift()!;
      const snap = store.getAgentSnapshot(post.agentId);
      if (!snap) continue;
      additions.push({
        key: `b${counter.current++}`,
        agentId: post.agentId,
        text: truncate(post.text, 90),
        platform: post.platform,
        x: snap.x,
        y: snap.y,
      });
    }
    if (additions.length === 0) return;
    activeCount.current += additions.length;
    setBubbles((current) => [...current, ...additions]);
    for (const bubble of additions) {
      setTimeout(() => {
        activeCount.current = Math.max(0, activeCount.current - 1);
        setBubbles((live) => live.filter((b) => b.key !== bubble.key));
        drain(); // a slot freed — pull from the queue
      }, TTL_MS);
    }
  }

  return (
    <>
      {bubbles.map((bubble) => {
        // Follow the speaker: re-read their LIVE position each frame (meta drives
        // the re-render) so the bubble stays pinned above the agent as it walks,
        // gliding in lockstep via the same --step transition. Falls back to the
        // spawn position if the agent snapshot is momentarily missing.
        const snap = store.getAgentSnapshot(bubble.agentId);
        const x = snap?.x ?? bubble.x;
        const y = snap?.y ?? bubble.y;
        // Top-of-field speakers would push their bubble up into the header — flip
        // it to hang below the head instead (like the persona card does).
        const below = y < 26;
        return (
          <div
            key={bubble.key}
            className={`speech-bubble${below ? " below" : ""}`}
            data-agent-id={bubble.agentId}
            style={{
              // Clamp into the half's safe zone so edge bubbles neither clip
              // off-screen nor collapse into one-word-per-line columns.
              left: `${Math.min(84, Math.max(11, x))}%`,
              top: below ? `${y + 2}%` : `${Math.max(6, y - 3)}%`,
              // hide this agent's speech while its persona card is open on hover
              visibility: hiddenAgentId === bubble.agentId ? "hidden" : undefined,
            }}
          >
            {bubble.text}
            <span className="bubble-platform">{bubble.platform === "threads" ? "@threads" : "fb"}</span>
          </div>
        );
      })}
    </>
  );
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export default BubbleField;
