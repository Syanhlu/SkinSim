"use client";

// ─── LottieAgent — the animated blob character ──────────────────────────────
// Loads the base Lottie ONCE and never rebuilds it. Emotion changes are applied
// live and smoothly, with no destroy/reload (which used to make agents snap):
//   • colour tone → a CSS filter that transitions over 0.5s
//   • energy      → anim.setSpeed() (instant, no restart)
//   • expression  → rewrite the (static) mouth path's control points in place
// Each agent runs on its own phase + speed so the crowd never looks synced.

import { useEffect, useRef } from "react";
import blobBase from "../character/blob.json";
import { styleLottie, stanceToState, CHAR_STATES, type CharacterState } from "@/lib/world/lottieCharacter";

// tone filter layered over the idle-orange base to reach each emotion's colour
const TONE: Record<CharacterState, string> = {
  idle: "none",
  happy: "saturate(1.12) brightness(1.04)",
  mad: "hue-rotate(-15deg) saturate(1.2) brightness(0.82)",
  sad: "saturate(0.5) brightness(1.08)",
};
// mouth curve depth relative to the idle smile (>0 smile, <0 frown)
const MOUTH: Record<CharacterState, number> = { idle: 1, happy: 1.4, mad: -1, sad: -0.55 };

// one shared lottie module across all agents
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _lottie: any = null;

export default function LottieAgent({ stance, seed }: { stance: string; seed: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const animRef = useRef<any>(null);
  const mouthRef = useRef<{ el: SVGPathElement; nums: number[] } | null>(null);
  const state: CharacterState = stanceToState(stance);
  const stateRef = useRef<CharacterState>(state);
  stateRef.current = state;
  const jitter = 0.85 + ((seed % 30) / 30) * 0.4; // per-agent speed variance

  // apply the current emotion without rebuilding the animation
  const apply = () => {
    const st = stateRef.current;
    if (ref.current) ref.current.style.filter = TONE[st];
    if (animRef.current) animRef.current.setSpeed(jitter * CHAR_STATES[st].speed);
    const m = mouthRef.current;
    if (m) {
      const f = MOUTH[st];
      const n = m.nums;
      const mid = n[1]; // endpoint baseline y
      const c1y = mid + (n[3] - mid) * f;
      const c2y = mid + (n[5] - mid) * f;
      m.el.setAttribute("d", `M${n[0]},${n[1]} C${n[2]},${c1y} ${n[4]},${c2y} ${n[6]},${n[7]}`);
    }
  };

  // load once
  useEffect(() => {
    let killed = false;
    (async () => {
      if (!_lottie) _lottie = (await import("lottie-web")).default;
      if (killed || !ref.current) return;
      const anim = _lottie.loadAnimation({
        container: ref.current,
        renderer: "svg",
        loop: true,
        autoplay: true,
        animationData: styleLottie(blobBase, "idle"),
        rendererSettings: { preserveAspectRatio: "xMidYMax meet" }, // feet to bottom
      });
      animRef.current = anim;
      anim.setSpeed(jitter * CHAR_STATES.idle.speed);
      anim.addEventListener("DOMLoaded", () => {
        const dur = Math.max(1, Math.floor(anim.getDuration(true) || 24));
        anim.goToAndPlay(seed % dur, true); // desync phase — seeded once, never re-seeked
        // find the mouth: widest near-horizontal path, cache its numbers
        const svg = ref.current?.querySelector("svg");
        if (svg) {
          let best: SVGPathElement | null = null;
          let bw = 0;
          svg.querySelectorAll("path").forEach((pa) => {
            try {
              const bb = (pa as SVGPathElement).getBBox();
              if (bb.width > 150 && bb.width > bb.height * 2 && bb.width > bw) { bw = bb.width; best = pa as SVGPathElement; }
            } catch { /* getBBox can throw on detached nodes */ }
          });
          if (best) {
            const n = ((best as SVGPathElement).getAttribute("d") || "").match(/-?\d+\.?\d*/g)?.map(Number);
            if (n && n.length >= 8) mouthRef.current = { el: best, nums: n };
          }
        }
        apply(); // reflect the agent's current emotion now that the SVG exists
      });
    })();
    return () => {
      killed = true;
      if (animRef.current) { animRef.current.destroy(); animRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // emotion changed → live update, no reload
  useEffect(() => {
    apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return <div ref={ref} className="lottie-agent" aria-hidden />;
}
