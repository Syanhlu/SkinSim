// ─── Agent World data model (VNG_GRAND_PLAN §4.1) ───────────────────────────
// The core four interfaces are the plan contract, verbatim. Optional fields
// below the contract line are additive extensions used by the replay bundle
// (canned interviews, source simulation id) — they never break the contract.

export interface WorldAgent {
  id: string;
  name: string;
  avatarSeed: number;
  demographics: {
    age?: number;
    gender?: string;
    region?: string;
    occupation?: string;
  };
  personaSummary: string;
}

export type Stance = "bullish" | "bearish" | "neutral" | "unknown";

export interface AgentFrameState {
  stance: Stance;
  post?: { text: string; platform: "threads" | "facebook" };
  action?: string;
}

export interface WorldFrame {
  round: number;
  states: Record<string, AgentFrameState>;
  marketYesProb?: number;
}

export interface WorldTimeline {
  agents: WorldAgent[];
  frames: WorldFrame[];
  variantLabel: string;
  injectionText: string;

  // ── Additive extensions (all optional) ─────────────────────────────────
  /** MiroShark simulation this timeline was exported from — live interviews
   *  in replay mode target this sim on the local backend. */
  simulationId?: string;
  /** Agent ids worth clicking during the demo (they have canned interviews). */
  highlightedAgents?: string[];
  /** Canned Q&A per agent id — the offline fallback for the interview panel
   *  (plan §4.4). */
  interviews?: Record<string, CannedInterview[]>;
}

export interface CannedInterview {
  question: string;
  answer: string;
}

/** Both drivers (replay + live) speak this interface (plan §4.1). */
export interface WorldDriver {
  /** Subscribe to frames. The callback fires with each new/scrubbed frame.
   *  Returns an unsubscribe function. */
  subscribe(onFrame: (frame: WorldFrame, index: number) => void): () => void;
  play(): void;
  pause(): void;
  /** Playback speed multiplier, clamped to 0.5×–8×. */
  setSpeed(speed: number): void;
  /** Jump to a frame index (replay) / latest known frame (live ignores). */
  scrub(frameIndex: number): void;
  readonly playing: boolean;
  readonly speed: number;
  readonly frameCount: number;
  readonly currentIndex: number;
  dispose(): void;
}
