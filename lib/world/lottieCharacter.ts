// ─── Lottie character recolor + expression engine ───────────────────────────
// Takes the base blob Lottie JSON and rewrites it at runtime per emotion:
//   • body gradient stops  → an orange ramp (luminance preserved, ink kept dark)
//   • mouth bezier tangents → smile ↔ frown
//   • arm rotation swing    → gentle / big wave / tight shake / low droop
// The original art, keyframes, and motion are otherwise untouched.

export type CharacterState = "idle" | "happy" | "mad" | "sad";

interface StateSpec {
  hue: number; sat: number; lmul: number; // colour bias
  mouth: number;                          // >0 smile, <0 frown, magnitude = depth
  armHi: number; armLo: number;           // limb swing extremes (deg)
  speed: number;                          // playback multiplier
}

export const CHAR_STATES: Record<CharacterState, StateSpec> = {
  idle:  { hue: 32, sat: 0.82, lmul: 1.00, mouth:  1.00, armHi: 55,  armLo: 12,  speed: 1.00 }, // light orange, gentle sway
  happy: { hue: 36, sat: 0.90, lmul: 1.06, mouth:  1.40, armHi: 125, armLo: -15, speed: 1.55 }, // warm, big excited wave
  mad:   { hue: 18, sat: 0.95, lmul: 0.80, mouth: -1.00, armHi: 32,  armLo: -8,  speed: 1.45 }, // deep orange, tight fast shake
  sad:   { hue: 30, sat: 0.45, lmul: 1.10, mouth: -0.55, armHi: 10,  armLo: -4,  speed: 0.60 }, // pale, slow low droop
};

/** Map the world's stance vocabulary onto a character emotion. */
export function stanceToState(stance: string): CharacterState {
  if (stance === "bullish") return "happy";
  if (stance === "bearish") return "mad";
  return "idle"; // neutral + unknown
}

type RGB = [number, number, number];

function rgb2hsl(r: number, g: number, b: number): RGB {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s, l];
}
function hsl2rgb(h: number, s: number, l: number): RGB {
  h /= 360;
  const f = (p: number, q: number, t: number) => {
    if (t < 0) t++; if (t > 1) t--;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3);
  }
  return [r, g, b];
}
// dark, low-saturation colours are outlines/eyes — never recolour them
function isInk(r: number, g: number, b: number): boolean {
  const [, s, l] = rgb2hsl(r, g, b);
  return l < 0.28 && s < 0.35;
}
// map one 0..1 rgb triple to the state's orange, preserving its luminance
function toOrange(r01: number, g01: number, b01: number, st: StateSpec): RGB {
  const r = r01 * 255, g = g01 * 255, b = b01 * 255;
  if (isInk(r, g, b)) return [r01, g01, b01];
  let [, , l] = rgb2hsl(r, g, b);
  l = Math.min(0.95, Math.max(0.12, l * st.lmul));
  return hsl2rgb(st.hue, st.sat, l);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function setArm(d: any, st: StateSpec): void {
  for (const l of d.layers || []) {
    const r = l.ks && l.ks.r;
    if (!(r && r.a === 1 && Array.isArray(r.k))) continue;
    const vals = r.k.map((kf: any) => (Array.isArray(kf.s) ? kf.s[0] : kf.s)).filter((v: any) => typeof v === "number");
    if (!vals.length) continue;
    const mn = Math.min(...vals), mx = Math.max(...vals);
    if (mx - mn < 40) continue; // skip the small body/face wobble
    const mirrored = mn + mx < 0;
    const thi = mirrored ? -st.armLo : st.armHi;
    const tlo = mirrored ? -st.armHi : st.armLo;
    const mid = (mn + mx) / 2;
    r.k.forEach((kf: any) => { const v = Array.isArray(kf.s) ? kf.s[0] : kf.s; kf.s = [v >= mid ? thi : tlo]; });
  }
}
function findMouth(d: any): any {
  const cands: { k: any; w: number }[] = [];
  const walk = (o: any) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === "object") {
      if (o.ty === "sh" && o.ks && o.ks.k && o.ks.k.v && o.ks.k.v.length === 2 && o.ks.k.c === false) {
        const v = o.ks.k.v;
        if (Math.abs(v[1][1] - v[0][1]) < 5) cands.push({ k: o.ks.k, w: Math.abs(v[1][0] - v[0][0]) });
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(d.layers);
  cands.sort((a, b) => b.w - a.w);
  return cands.length ? cands[0].k : null;
}
function flipMouth(d: any, factor: number): void {
  const p = findMouth(d);
  if (!p) return;
  const setY = (arr: number[][]) => arr.forEach((t) => { t[1] = Math.abs(t[1]) * factor; });
  setY(p.i); setY(p.o);
}

/** Deep-clone the base JSON and restyle it for `state`. Returns a fresh animationData object. */
export function styleLottie(base: any, state: CharacterState): any {
  const st = CHAR_STATES[state] || CHAR_STATES.idle;
  const d = JSON.parse(JSON.stringify(base));
  const walk = (o: any) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === "object") {
      if (o.ty === "gf" && o.g && o.g.k) {
        const k = o.g.k.k as number[]; const n = o.g.p || Math.floor(k.length / 4);
        for (let i = 0; i < n; i++) { const j = i * 4 + 1; const [r, g, b] = toOrange(k[j], k[j + 1], k[j + 2], st); k[j] = r; k[j + 1] = g; k[j + 2] = b; }
      }
      if ((o.ty === "fl" || o.ty === "st") && o.c && Array.isArray(o.c.k) && typeof o.c.k[0] === "number") {
        const c = o.c.k as number[]; const [r, g, b] = toOrange(c[0], c[1], c[2], st); c[0] = r; c[1] = g; c[2] = b;
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(d.layers);
  flipMouth(d, st.mouth);
  setArm(d, st);
  return d;
}
