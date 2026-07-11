"use client";

// ─── WorldApp — the split-world orchestrator (plan §4.3/§4.4) ────────────────
// One world, sketchy center fence, a TV per half, the SAME agents mirrored on
// both halves (shared layout salt), each half bound to its own timeline.
// Replay mode (stage default): bundled /demo JSONs through ReplayDrivers with
// a sync-scrub lock (master drives, slave follows by frame index).
// Live mode: LiveDrivers polling the /api/experiment proxy every 5s.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { WorldAgent, WorldTimeline } from "@/lib/world/types";
import { ReplayDriver, LiveDriver } from "@/lib/world/drivers";
import { WorldStore, type WorldMeta } from "@/lib/world/store";
import { computeWorldVerdict, type WorldVerdict } from "@/lib/world/verdict";
import { hashSeed } from "@/lib/world/seed";
import WorldCanvas from "./WorldCanvas";
import TimeScrubber from "./TimeScrubber";
import DemographicLens, { type LensMode } from "./DemographicLens";
import PromptDock from "./PromptDock";
import InterviewPanel from "./InterviewPanel";
import VerdictOverlay from "./VerdictOverlay";

interface WorldSetup {
  tlA: WorldTimeline;
  tlB: WorldTimeline;
  storeA: WorldStore;
  storeB: WorldStore;
  /** Control surface — replay: the master driver; live: both drivers. */
  play: () => void;
  pause: () => void;
  scrub: (index: number) => void;
  setSpeed: (speed: number) => void;
  dispose: () => void;
}

const EMPTY_META: WorldMeta = { frameIndex: -1, round: 0, frameCount: 0 };
const emptySubscribe = () => () => {};
const emptyMeta = () => EMPTY_META;

export default function WorldApp({
  mode,
  demo,
  experimentId,
}: {
  mode: "replay" | "live";
  demo: string;
  experimentId?: string;
}) {
  const router = useRouter();
  const [setup, setSetup] = useState<WorldSetup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [lens, setLens] = useState<LensMode>("off");
  const [selected, setSelected] = useState<{ agent: WorldAgent; side: "A" | "B" } | null>(null);
  const [liveStatus, setLiveStatus] = useState<string | null>(mode === "live" ? "preparing" : null);
  const [verdict, setVerdict] = useState<WorldVerdict | null>(null);
  const [verdictVisible, setVerdictVisible] = useState(false);
  const endedRef = useRef(false);

  // ── build the world for the current mode ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let built: WorldSetup | null = null;

    async function buildReplay() {
      const suffix = demo && demo !== "kfc" ? `-${demo}` : "";
      const [tlA, tlB] = await Promise.all([
        fetchTimeline(`/demo/timeline${suffix}-A.json`),
        fetchTimeline(`/demo/timeline${suffix}-B.json`),
      ]);
      if (cancelled) return;

      // Same layout salt on both halves → the same person stands in the same
      // spot in both realities.
      const storeA = new WorldStore(tlA.agents, { layoutSalt: "shared-world" });
      const storeB = new WorldStore(tlB.agents, { layoutSalt: "shared-world" });
      storeA.precompute(tlA.frames);
      storeB.precompute(tlB.frames);

      const slave = new ReplayDriver(tlB);
      const master = new ReplayDriver(tlA, {
        onEnded: () => {
          if (endedRef.current) return;
          endedRef.current = true;
          setPlaying(false);
          setVerdict(computeWorldVerdict(tlA, tlB));
          setVerdictVisible(true);
        },
      });
      // Sync-scrub lock: whatever frame the master emits, the slave mirrors.
      const unsubMaster = master.subscribe((frame, index) => {
        storeA.applyFrame(frame, index);
        slave.scrub(index);
      });
      const unsubSlave = slave.subscribe((frame, index) => storeB.applyFrame(frame, index));

      built = {
        tlA,
        tlB,
        storeA,
        storeB,
        play: () => master.play(),
        pause: () => master.pause(),
        scrub: (index) => master.scrub(index),
        setSpeed: (value) => master.setSpeed(value),
        dispose: () => {
          unsubMaster();
          unsubSlave();
          master.dispose();
          slave.dispose();
        },
      };
      setSetup(built);
      master.scrub(0);
      // Stage default: start rolling after a beat.
      setTimeout(() => {
        if (!cancelled) {
          master.play();
          setPlaying(true);
        }
      }, 700);
    }

    function buildLive(id: string) {
      const roster = silhouetteRoster(60);
      const tlA: WorldTimeline = { agents: roster, frames: [], variantLabel: "A", injectionText: "live experiment" };
      const tlB: WorldTimeline = { agents: roster, frames: [], variantLabel: "B", injectionText: "live experiment" };
      const storeA = new WorldStore(roster, { layoutSalt: "shared-world" });
      const storeB = new WorldStore(roster, { layoutSalt: "shared-world" });

      const driverA = new LiveDriver({
        experimentId: id,
        variantIndex: 0,
        agents: roster,
        onStatus: (status) => setLiveStatus(status),
      });
      const driverB = new LiveDriver({ experimentId: id, variantIndex: 1, agents: roster });
      const unsubA = driverA.subscribe((frame, index) => {
        storeA.applyFrame(frame, index);
        tlA.frames[index] = frame;
      });
      const unsubB = driverB.subscribe((frame, index) => {
        storeB.applyFrame(frame, index);
        tlB.frames[index] = frame;
      });

      built = {
        tlA,
        tlB,
        storeA,
        storeB,
        play: () => {
          driverA.play();
          driverB.play();
        },
        pause: () => {
          driverA.pause();
          driverB.pause();
        },
        scrub: (index) => {
          driverA.scrub(index);
          driverB.scrub(index);
        },
        setSpeed: (value) => {
          driverA.setSpeed(value);
          driverB.setSpeed(value);
        },
        dispose: () => {
          unsubA();
          unsubB();
          driverA.dispose();
          driverB.dispose();
        },
      };
      setSetup(built);
      driverA.play();
      driverB.play();
      setPlaying(true);
    }

    endedRef.current = false;
    setSetup(null);
    setVerdict(null);
    setVerdictVisible(false);
    setLoadError(null);

    if (mode === "live" && experimentId) {
      buildLive(experimentId);
    } else {
      buildReplay().catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "failed to load demo timelines");
        }
      });
    }

    return () => {
      cancelled = true;
      built?.dispose();
    };
  }, [mode, demo, experimentId]);

  // ── shared meta (round/frame index) from the A-side store ───────────────
  const meta = useSyncExternalStore(
    setup ? setup.storeA.subscribeMeta : emptySubscribe,
    setup ? setup.storeA.getMeta : emptyMeta,
    setup ? setup.storeA.getMeta : emptyMeta,
  );

  const onPlay = useCallback(() => {
    setup?.play();
    setPlaying(true);
    endedRef.current = false;
  }, [setup]);
  const onPause = useCallback(() => {
    setup?.pause();
    setPlaying(false);
  }, [setup]);
  const onScrub = useCallback(
    (index: number) => {
      setup?.scrub(index);
    },
    [setup],
  );
  const onSpeed = useCallback(
    (value: number) => {
      setup?.setSpeed(value);
      setSpeedState(value);
    },
    [setup],
  );

  const clickAgentA = useCallback((agent: WorldAgent) => setSelected({ agent, side: "A" }), []);
  const clickAgentB = useCallback((agent: WorldAgent) => setSelected({ agent, side: "B" }), []);

  const agentCount = setup?.tlA.agents.length ?? 0;
  const silhouette = mode === "live" && (liveStatus === "preparing" || liveStatus === "offline");

  const headerSubtitle = useMemo(() => {
    if (mode === "live") {
      return liveStatus === "offline"
        ? "engine unreachable — holding last frame"
        : `live experiment ${experimentId ?? ""} · ${liveStatus ?? "…"}`;
    }
    return `${agentCount} census-grounded personas · replay`;
  }, [mode, liveStatus, experimentId, agentCount]);

  return (
    <div className="world-root">
      <header className="world-header">
        <h1>Same 100 people. Two realities.</h1>
        <div className="world-subtitle">{headerSubtitle}</div>
        <a className="world-classic-link" href="/">
          stats view →
        </a>
      </header>

      {setup ? (
        <div className="world-split">
          <WorldCanvas
            store={setup.storeA}
            variantLabel={setup.tlA.variantLabel}
            injectionText={setup.tlA.injectionText}
            variantClass="variant-a"
            lens={lens}
            silhouette={silhouette}
            onAgentClick={clickAgentA}
          />
          <WorldCanvas
            store={setup.storeB}
            variantLabel={setup.tlB.variantLabel}
            injectionText={setup.tlB.injectionText}
            variantClass="variant-b"
            lens={lens}
            silhouette={silhouette}
            onAgentClick={clickAgentB}
          />
        </div>
      ) : (
        <div className="world-loading">
          {loadError ? <span>could not load the demo world — {loadError}</span> : (
            <span>
              gathering the crowd<span className="loading-dots" />
            </span>
          )}
        </div>
      )}

      {silhouette && setup && (
        <div className="world-loading">
          <span>
            preparing audience<span className="loading-dots" />
          </span>
        </div>
      )}

      <Fence />

      {setup && <DemographicLens mode={lens} onChange={setLens} agents={setup.tlA.agents} />}

      {mode === "replay" && (
        <PromptDock
          onLaunched={(id) => router.push(`/world?mode=live&experiment=${encodeURIComponent(id)}`)}
        />
      )}

      {setup && (
        <TimeScrubber
          frameIndex={meta.frameIndex}
          frameCount={meta.frameCount}
          round={meta.round}
          playing={playing}
          speed={speed}
          onPlay={onPlay}
          onPause={onPause}
          onScrub={onScrub}
          onSpeed={onSpeed}
        />
      )}

      {selected && setup && (
        <InterviewPanel
          key={`${selected.side}:${selected.agent.id}`}
          agent={selected.agent}
          timeline={selected.side === "A" ? setup.tlA : setup.tlB}
          onClose={() => setSelected(null)}
        />
      )}

      {verdict && verdictVisible && (
        <VerdictOverlay verdict={verdict} onClose={() => setVerdictVisible(false)} />
      )}
      {verdict && !verdictVisible && (
        <button type="button" className="world-btn verdict-reopen" onClick={() => setVerdictVisible(true)}>
          verdict
        </button>
      )}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function fetchTimeline(path: string): Promise<WorldTimeline> {
  const res = await fetch(path, { cache: "force-cache" });
  if (!res.ok) throw new Error(`missing ${path} (HTTP ${res.status})`);
  const body = (await res.json()) as WorldTimeline;
  if (!Array.isArray(body.agents) || !Array.isArray(body.frames)) {
    throw new Error(`${path} is not a WorldTimeline`);
  }
  return body;
}

/** Placeholder roster while a live experiment prepares its real personas. */
function silhouetteRoster(count: number): WorldAgent[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `pending-${String(index + 1).padStart(2, "0")}`;
    return {
      id,
      name: `Agent ${index + 1}`,
      avatarSeed: hashSeed(`silhouette:${id}`),
      demographics: {},
      personaSummary: "persona being generated…",
    };
  });
}

/** Sketchy center fence dividing the two realities. */
function Fence() {
  return (
    <div className="world-fence" aria-hidden>
      <svg viewBox="0 0 26 800" preserveAspectRatio="none">
        <g stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" opacity="0.7" fill="none">
          <path d="M13 0 q3 60 -2 120 q-3 60 2 120 q4 60 -1 120 q-3 60 1 120 q3 60 -2 120 q-2 50 1 100 q2 50 0 100" strokeDasharray="14 10" />
          <path d="M5 90 L21 84 M5 210 L21 204 M5 330 L21 324 M5 450 L21 444 M5 570 L21 564 M5 690 L21 684" strokeWidth="1.6" opacity="0.65" />
        </g>
      </svg>
    </div>
  );
}
