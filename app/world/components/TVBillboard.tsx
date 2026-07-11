"use client";

// ─── TVBillboard (plan §4.2) — sketchy CRT with antennas + market ticker ────

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { WorldStore } from "@/lib/world/store";

export default function TVBillboard({
  store,
  variantLabel,
  injectionText,
}: {
  store: WorldStore;
  variantLabel: string;
  injectionText: string;
}) {
  const meta = useSyncExternalStore(store.subscribeMeta, store.getMeta, store.getMeta);
  const prob = meta.marketYesProb;

  // pulse the ticker whenever the market number changes
  const prevProb = useRef<number | undefined>(undefined);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (prob !== undefined && prevProb.current !== undefined && prob !== prevProb.current) {
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 700);
      prevProb.current = prob;
      return () => clearTimeout(timer);
    }
    prevProb.current = prob;
  }, [prob]);

  return (
    <div className="tv-billboard">
      <div style={{ position: "relative" }}>
        <svg viewBox="0 0 240 172" width="100%">
          {/* antennas */}
          <g stroke="var(--ink)" strokeWidth="2.5" fill="none" strokeLinecap="round">
            <path d="M120 34 L86 6" />
            <path d="M120 34 L158 4" />
            <circle cx="86" cy="6" r="3" fill="var(--ink)" />
            <circle cx="158" cy="4" r="3" fill="var(--ink)" />
          </g>
          {/* body — slightly wobbly hand-drawn rect */}
          <path
            d="M16 40 q-4 -8 6 -8 L216 30 q10 -1 9 9 L226 148 q1 9 -9 9 L22 158 q-9 1 -9 -8 z"
            fill="var(--card-bg)"
            stroke="var(--ink)"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          {/* screen */}
          <rect x="26" y="44" width="176" height="102" rx="8" fill="#3b382f" stroke="var(--ink)" strokeWidth="2.5" />
          {/* knobs */}
          <circle cx="216" cy="62" r="5" fill="none" stroke="var(--ink)" strokeWidth="2" />
          <circle cx="216" cy="82" r="5" fill="none" stroke="var(--ink)" strokeWidth="2" />
          <path d="M208 100 L224 100 M208 110 L224 110" stroke="var(--ink)" strokeWidth="1.8" />
          {/* legs */}
          <path d="M52 158 L44 170 M188 158 L196 170" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
          {/* variant letter on the corner */}
          <text
            x="34"
            y="60"
            fontFamily="var(--hand-font)"
            fontSize="15"
            fontWeight="700"
            fill="var(--accent)"
          >
            {variantLabel}
          </text>
        </svg>
        {/* the broadcast text, overlaid on the screen area */}
        <div
          style={{
            position: "absolute",
            left: "13%",
            top: "30%",
            width: "70%",
            height: "54%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div className="tv-screen-text">{injectionText || "…"}</div>
        </div>
      </div>
      <div className={`tv-ticker${pulse ? " pulse" : ""}`}>
        {prob === undefined ? (
          <>Market: warming up…</>
        ) : (
          <>
            Market: <span className="ticker-num">{Math.round(prob * 100)}%</span> believe it works
          </>
        )}
      </div>
    </div>
  );
}
