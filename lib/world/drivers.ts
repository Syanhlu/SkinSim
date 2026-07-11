// ─── World drivers (plan §4.1) ───────────────────────────────────────────────
// ReplayDriver — plays a bundled WorldTimeline on a timer (0.5×–8×, pause,
// scrub). LiveDriver — polls the Phase-3 `/api/experiment` proxy every 5s
// while an experiment runs and appends frames. Both expose the same
// subscribe(onFrame) interface (WorldDriver in ./types).

import type { AgentFrameState, Stance, WorldAgent, WorldDriver, WorldFrame, WorldTimeline } from "./types";
import { hashSeed } from "./seed";

const MIN_SPEED = 0.5;
const MAX_SPEED = 8;
/** Wall-clock ms per frame at 1× — 48 rounds ≈ 72s, inside the plan's 60–90s. */
const BASE_FRAME_MS = 1500;

type FrameListener = (frame: WorldFrame, index: number) => void;

abstract class BaseDriver implements WorldDriver {
  protected listeners = new Set<FrameListener>();
  protected index = -1;
  protected _playing = false;
  protected _speed = 1;
  protected disposed = false;

  abstract readonly frameCount: number;
  abstract play(): void;
  abstract pause(): void;
  abstract scrub(frameIndex: number): void;

  get playing(): boolean {
    return this._playing;
  }

  get speed(): number {
    return this._speed;
  }

  get currentIndex(): number {
    return this.index;
  }

  setSpeed(speed: number): void {
    this._speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, Number.isFinite(speed) ? speed : 1));
    this.onSpeedChanged();
  }

  protected onSpeedChanged(): void {}

  subscribe(onFrame: FrameListener): () => void {
    this.listeners.add(onFrame);
    return () => {
      this.listeners.delete(onFrame);
    };
  }

  protected emit(frame: WorldFrame, index: number): void {
    for (const listener of this.listeners) {
      try {
        listener(frame, index);
      } catch {
        // A broken listener must never stop the clock.
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this._playing = false;
    this.listeners.clear();
  }
}

// ── ReplayDriver ──────────────────────────────────────────────────────────────

export class ReplayDriver extends BaseDriver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onEnded?: () => void;

  constructor(
    private timeline: WorldTimeline,
    opts: { speed?: number; onEnded?: () => void } = {},
  ) {
    super();
    if (opts.speed !== undefined) this.setSpeed(opts.speed);
    this.onEnded = opts.onEnded;
  }

  get frameCount(): number {
    return this.timeline.frames.length;
  }

  play(): void {
    if (this.disposed || this._playing || this.frameCount === 0) return;
    this._playing = true;
    if (this.index >= this.frameCount - 1) {
      // Replay from the start when play is hit at the end.
      this.index = -1;
    }
    this.tick();
  }

  pause(): void {
    this._playing = false;
    this.clearTimer();
  }

  scrub(frameIndex: number): void {
    if (this.disposed || this.frameCount === 0) return;
    const clamped = Math.min(this.frameCount - 1, Math.max(0, Math.floor(frameIndex)));
    this.index = clamped;
    this.emit(this.timeline.frames[clamped], clamped);
    if (this._playing) {
      this.clearTimer();
      this.schedule();
    }
  }

  protected override onSpeedChanged(): void {
    if (this._playing) {
      this.clearTimer();
      this.schedule();
    }
  }

  private tick = (): void => {
    if (this.disposed || !this._playing) return;
    if (this.index >= this.frameCount - 1) {
      this._playing = false;
      this.clearTimer();
      this.onEnded?.();
      return;
    }
    this.index += 1;
    this.emit(this.timeline.frames[this.index], this.index);
    if (this.index >= this.frameCount - 1) {
      this._playing = false;
      this.onEnded?.();
      return;
    }
    this.schedule();
  };

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(this.tick, BASE_FRAME_MS / this._speed);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  override dispose(): void {
    this.clearTimer();
    super.dispose();
  }
}

// ── LiveDriver ────────────────────────────────────────────────────────────────

/** Status/results shapes of the Phase-3 proxy (`GET /api/experiment?id=...` and
 *  `GET /api/experiment?id=...&results=1`). Written defensively — every field
 *  is optional and any fetch/parse failure leaves the world on its last frame. */
interface ProxyStatus {
  experimentId?: string;
  experiment_id?: string;
  status?: string;
  progress?: {
    runs_total?: number;
    runs_done?: number;
    runs_active?: number;
    current_round_max?: number;
    rounds_per_run?: number;
  };
  error?: unknown;
}

interface ProxyResults {
  variants?: Array<{ name?: string; visitors?: number; conversions?: number }>;
  [key: string]: unknown;
}

export interface LiveDriverOptions {
  experimentId: string;
  /** Which variant this half of the world tracks: 0 = control/A, 1 = treatment/B. */
  variantIndex: 0 | 1;
  /** Known roster (shared parent personas). Optional — without it, result
   *  frames carry aggregate market probability only. */
  agents?: WorldAgent[];
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
  onStatus?: (status: "preparing" | "running" | "complete" | "failed" | "offline") => void;
}

export class LiveDriver extends BaseDriver {
  private frames: WorldFrame[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastRound = 0;
  private finished = false;
  private readonly pollIntervalMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private opts: LiveDriverOptions) {
    super();
    this.pollIntervalMs = opts.pollIntervalMs ?? 5000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  play(): void {
    if (this.disposed || this._playing) return;
    this._playing = true;
    void this.poll();
  }

  pause(): void {
    this._playing = false;
    this.clearTimer();
  }

  /** Live mode always shows the latest frame; scrubbing re-emits a past frame
   *  without stopping the poll loop. */
  scrub(frameIndex: number): void {
    if (this.frames.length === 0) return;
    const clamped = Math.min(this.frames.length - 1, Math.max(0, Math.floor(frameIndex)));
    this.index = clamped;
    this.emit(this.frames[clamped], clamped);
  }

  private schedule(): void {
    this.clearTimer();
    if (!this._playing || this.finished || this.disposed) return;
    this.timer = setTimeout(() => void this.poll(), this.pollIntervalMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.disposed || !this._playing || this.finished) return;
    let status: ProxyStatus | null = null;
    try {
      const res = await this.fetchImpl(
        `/api/experiment?id=${encodeURIComponent(this.opts.experimentId)}`,
        { cache: "no-store" },
      );
      if (res.ok) status = (await res.json()) as ProxyStatus;
    } catch {
      status = null;
    }

    if (!status) {
      // Engine unreachable: stay on the last frame, keep trying.
      this.opts.onStatus?.("offline");
      this.schedule();
      return;
    }

    const state = normalizeLiveStatus(status.status);
    this.opts.onStatus?.(state);

    if (state === "complete") {
      await this.finish();
      return;
    }
    if (state === "failed") {
      this.finished = true;
      this.clearTimer();
      return;
    }

    const round = status.progress?.current_round_max ?? 0;
    if (round > this.lastRound) {
      this.lastRound = round;
      this.appendFrame({ round, states: this.unknownStates() });
    } else if (this.frames.length === 0) {
      // Emit a round-0 "preparing audience…" frame so the UI has something.
      this.appendFrame({ round: 0, states: this.unknownStates() });
    }
    this.schedule();
  }

  private async finish(): Promise<void> {
    this.finished = true;
    this.clearTimer();
    let results: ProxyResults | null = null;
    try {
      const res = await this.fetchImpl(
        `/api/experiment?id=${encodeURIComponent(this.opts.experimentId)}&results=1`,
        { cache: "no-store" },
      );
      if (res.ok) results = (await res.json()) as ProxyResults;
    } catch {
      results = null;
    }

    const round = Math.max(this.lastRound, 1);
    const frame: WorldFrame = { round, states: this.unknownStates() };
    const variant = results?.variants?.[this.opts.variantIndex];
    if (variant && typeof variant.visitors === "number" && variant.visitors > 0) {
      const rate = Math.min(1, Math.max(0, (variant.conversions ?? 0) / variant.visitors));
      frame.marketYesProb = rate;
      if (this.opts.agents?.length) {
        frame.states = distributeFinalStances(this.opts.agents, rate);
      }
    }
    this.appendFrame(frame);
    this._playing = false;
  }

  private unknownStates(): Record<string, AgentFrameState> {
    const states: Record<string, AgentFrameState> = {};
    for (const agent of this.opts.agents ?? []) {
      states[agent.id] = { stance: "unknown" };
    }
    return states;
  }

  private appendFrame(frame: WorldFrame): void {
    this.frames.push(frame);
    this.index = this.frames.length - 1;
    this.emit(frame, this.index);
  }

  override dispose(): void {
    this.clearTimer();
    super.dispose();
  }
}

function normalizeLiveStatus(raw: unknown): "preparing" | "running" | "complete" | "failed" {
  const value = typeof raw === "string" ? raw.toLowerCase() : "";
  if (value === "complete" || value === "completed") return "complete";
  if (value === "failed" || value === "error") return "failed";
  if (value === "running") return "running";
  return "preparing";
}

/** Same affinity trick as adapters.distributeStances: with only an aggregate
 *  positive rate, assign bullish to the most bullish-affine agents so the
 *  final crowd shape is deterministic and believable. */
function distributeFinalStances(
  agents: WorldAgent[],
  bullishRate: number,
): Record<string, AgentFrameState> {
  const ordered = [...agents].sort(
    (a, b) => (hashSeed(`affinity:${a.id}`) % 100000) - (hashSeed(`affinity:${b.id}`) % 100000),
  );
  const nBullish = Math.round(bullishRate * agents.length);
  const nBearish = Math.round((1 - bullishRate) * 0.6 * agents.length); // rest splits bearish/neutral
  const states: Record<string, AgentFrameState> = {};
  ordered.forEach((agent, i) => {
    let stance: Stance = "neutral";
    if (i < nBullish) stance = "bullish";
    else if (i >= ordered.length - nBearish) stance = "bearish";
    states[agent.id] = { stance };
  });
  return states;
}
