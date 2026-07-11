"use client";

// ─── TimeScrubber (plan §4.2) — round slider + play/pause + speed ────────────

const SPEEDS = [0.5, 1, 2, 4, 8];

export default function TimeScrubber({
  frameIndex,
  frameCount,
  round,
  playing,
  speed,
  onPlay,
  onPause,
  onScrub,
  onSpeed,
}: {
  frameIndex: number;
  frameCount: number;
  round: number;
  playing: boolean;
  speed: number;
  onPlay: () => void;
  onPause: () => void;
  onScrub: (index: number) => void;
  onSpeed: (speed: number) => void;
}) {
  return (
    <div className="time-scrubber">
      <button
        type="button"
        className="world-btn"
        onClick={playing ? onPause : onPlay}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(0, frameCount - 1)}
        value={Math.max(0, frameIndex)}
        onChange={(event) => onScrub(Number(event.target.value))}
        aria-label="Round"
      />
      <span className="round-label">
        round {round}/{frameCount}
      </span>
      <select value={speed} onChange={(event) => onSpeed(Number(event.target.value))} aria-label="Speed">
        {SPEEDS.map((value) => (
          <option key={value} value={value}>
            {value}×
          </option>
        ))}
      </select>
    </div>
  );
}
