// ─── WorldStore — per-agent subscription store (perf contract, plan §4) ──────
// One store per world half. The driver pushes frames in; the store diffs them
// against the previous per-agent snapshots and notifies ONLY the agents whose
// state changed, so a frame that flips 4 stances re-renders 4 sprites, not 120.
// Sprites subscribe via useSyncExternalStore(store.subscribeAgent(id), ...).
//
// Positions: base layout is a deterministic seeded scatter around the TV
// (percent coordinates → resize-safe). Stance drives a cumulative drift toward
// (bullish) or away from (bearish) the TV; positions per frame are precomputed
// (replay) or sequentially cached (live) so scrubbing is deterministic.

import type { AgentFrameState, Stance, WorldAgent, WorldFrame } from "./types";
import { mulberry32, hashSeed } from "./seed";

export interface AgentSnapshot {
  stance: Stance;
  /** Position in % of the world half. */
  x: number;
  y: number;
  /** True on frames where this agent published a post. */
  talking: boolean;
}

export interface WorldMeta {
  frameIndex: number;
  round: number;
  marketYesProb?: number;
  frameCount: number;
}

export interface FramePost {
  agentId: string;
  text: string;
  platform: "threads" | "facebook";
  round: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Where the TV sits inside a world half (percent). */
export const TV_POS: Point = { x: 50, y: 30 };

const BOUNDS = { minX: 5, maxX: 95, minY: 16, maxY: 92 };
/** Keep the base scatter out of the TV's footprint. */
const TV_ZONE = { minX: 33, maxX: 67, minY: 12, maxY: 48 };
const MIN_DIST = 6.5;

const DRIFT_IN = 0.075; // per bullish round, toward the TV
const DRIFT_OUT = 0.06; // per bearish round, away from the TV
const DRIFT_DECAY = 0.02;
const MAX_IN = 0.6;
const MAX_OUT = 0.55;

export class WorldStore {
  readonly agents: WorldAgent[];
  private readonly baseLayout = new Map<string, Point>();
  private readonly snapshots = new Map<string, AgentSnapshot>();
  private readonly agentSubs = new Map<string, Set<() => void>>();
  private readonly metaSubs = new Set<() => void>();

  private meta: WorldMeta = { frameIndex: -1, round: 0, frameCount: 0 };
  private latestPosts: FramePost[] = [];

  /** Sequential drift cache: positionCache[frameIndex] = Map(agentId → Point). */
  private positionCache: Array<Map<string, Point>> = [];
  private driftAfterFrame: Array<Map<string, number>> = [];

  constructor(agents: WorldAgent[], opts: { layoutSalt?: string; frameCount?: number } = {}) {
    this.agents = agents;
    this.meta.frameCount = opts.frameCount ?? 0;
    this.computeBaseLayout(opts.layoutSalt ?? "world");
    for (const agent of agents) {
      const base = this.baseLayout.get(agent.id)!;
      this.snapshots.set(agent.id, { stance: "unknown", x: base.x, y: base.y, talking: false });
    }
  }

  // ── subscriptions ───────────────────────────────────────────────────────

  subscribeAgent(agentId: string): (cb: () => void) => () => void {
    return (cb: () => void) => {
      if (!this.agentSubs.has(agentId)) this.agentSubs.set(agentId, new Set());
      this.agentSubs.get(agentId)!.add(cb);
      return () => this.agentSubs.get(agentId)?.delete(cb);
    };
  }

  subscribeMeta = (cb: () => void): (() => void) => {
    this.metaSubs.add(cb);
    return () => this.metaSubs.delete(cb);
  };

  getAgentSnapshot = (agentId: string): AgentSnapshot | undefined => this.snapshots.get(agentId);

  getMeta = (): WorldMeta => this.meta;

  /** Posts published on the most recently applied frame (bubble feed). */
  getLatestPosts(): FramePost[] {
    return this.latestPosts;
  }

  getBasePosition(agentId: string): Point | undefined {
    return this.baseLayout.get(agentId);
  }

  setFrameCount(count: number): void {
    if (count !== this.meta.frameCount) {
      this.meta = { ...this.meta, frameCount: count };
      this.notifyMeta();
    }
  }

  // ── frame application ───────────────────────────────────────────────────

  applyFrame(frame: WorldFrame, frameIndex: number): void {
    const positions = this.positionsForFrame(frame, frameIndex);
    const posts: FramePost[] = [];

    for (const agent of this.agents) {
      const state: AgentFrameState | undefined = frame.states[agent.id];
      const stance = state?.stance ?? "unknown";
      const pos = positions.get(agent.id) ?? this.baseLayout.get(agent.id)!;
      const talking = Boolean(state?.post);
      if (state?.post) {
        posts.push({ agentId: agent.id, text: state.post.text, platform: state.post.platform, round: frame.round });
      }

      const prev = this.snapshots.get(agent.id)!;
      if (
        prev.stance !== stance ||
        Math.abs(prev.x - pos.x) > 0.01 ||
        Math.abs(prev.y - pos.y) > 0.01 ||
        prev.talking !== talking
      ) {
        this.snapshots.set(agent.id, { stance, x: pos.x, y: pos.y, talking });
        this.notifyAgent(agent.id);
      }
    }

    this.latestPosts = posts;
    this.meta = {
      frameIndex,
      round: frame.round,
      marketYesProb: frame.marketYesProb ?? this.meta.marketYesProb,
      frameCount: Math.max(this.meta.frameCount, frameIndex + 1),
    };
    this.notifyMeta();
  }

  /** Precompute the whole drift path for a known timeline (replay mode) so
   *  scrubbing anywhere is O(agents) and fully deterministic. */
  precompute(frames: WorldFrame[]): void {
    this.positionCache = [];
    this.driftAfterFrame = [];
    for (let i = 0; i < frames.length; i++) {
      this.computeFramePositions(frames[i], i);
    }
    this.setFrameCount(frames.length);
  }

  // ── internals ───────────────────────────────────────────────────────────

  private positionsForFrame(frame: WorldFrame, frameIndex: number): Map<string, Point> {
    if (this.positionCache[frameIndex]) return this.positionCache[frameIndex];
    // Sequential fill (live mode appends frames one by one).
    return this.computeFramePositions(frame, frameIndex);
  }

  private computeFramePositions(frame: WorldFrame, frameIndex: number): Map<string, Point> {
    const prevDrift = frameIndex > 0 ? this.driftAfterFrame[frameIndex - 1] : undefined;
    const drift = new Map<string, number>();
    const positions = new Map<string, Point>();

    for (const agent of this.agents) {
      const stance = frame.states[agent.id]?.stance ?? "unknown";
      let d = prevDrift?.get(agent.id) ?? 0;
      if (stance === "bullish") d = Math.min(MAX_IN, d + DRIFT_IN);
      else if (stance === "bearish") d = Math.max(-MAX_OUT, d - DRIFT_OUT);
      else d = d > 0 ? Math.max(0, d - DRIFT_DECAY) : Math.min(0, d + DRIFT_DECAY);
      drift.set(agent.id, d);

      const base = this.baseLayout.get(agent.id)!;
      positions.set(agent.id, driftedPosition(base, d));
    }

    this.driftAfterFrame[frameIndex] = drift;
    this.positionCache[frameIndex] = positions;
    return positions;
  }

  private computeBaseLayout(salt: string): void {
    const placed: Point[] = [];
    for (const agent of this.agents) {
      const rand = mulberry32(hashSeed(`${salt}:${agent.id}`));
      let candidate: Point = { x: 50, y: 70 };
      for (let attempt = 0; attempt < 60; attempt++) {
        candidate = {
          x: BOUNDS.minX + rand() * (BOUNDS.maxX - BOUNDS.minX),
          y: BOUNDS.minY + rand() * (BOUNDS.maxY - BOUNDS.minY),
        };
        if (insideTvZone(candidate)) continue;
        if (placed.every((p) => dist(p, candidate) >= MIN_DIST)) break;
      }
      placed.push(candidate);
      this.baseLayout.set(agent.id, candidate);
    }
  }

  private notifyAgent(agentId: string): void {
    const subs = this.agentSubs.get(agentId);
    if (subs) for (const cb of subs) cb();
  }

  private notifyMeta(): void {
    for (const cb of this.metaSubs) cb();
  }
}

function driftedPosition(base: Point, d: number): Point {
  if (Math.abs(d) < 0.001) return base;
  let x: number;
  let y: number;
  if (d > 0) {
    // Walk toward the TV, stopping at a respectful distance.
    x = base.x + (TV_POS.x - base.x) * d * 0.8;
    y = base.y + (TV_POS.y - base.y) * d * 0.8;
  } else {
    // Turn away and walk outward.
    x = base.x + (base.x - TV_POS.x) * -d * 0.5;
    y = base.y + (base.y - TV_POS.y) * -d * 0.5;
  }
  return {
    x: Math.min(BOUNDS.maxX + 2, Math.max(BOUNDS.minX - 2, x)),
    y: Math.min(BOUNDS.maxY + 3, Math.max(BOUNDS.minY, y)),
  };
}

function insideTvZone(p: Point): boolean {
  return p.x > TV_ZONE.minX && p.x < TV_ZONE.maxX && p.y > TV_ZONE.minY && p.y < TV_ZONE.maxY;
}

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
