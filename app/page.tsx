"use client";

// ─── SkinSim — liquid-glass stepped flow (visual shell) ──────────────────────
// Design language borrowed from the Aucctus "Idea Playground": a dark burgundy→
// black gradient, frosted glass cards, floating example pills, big white
// headings, soft fade/slide transitions. This is a VISUAL SHELL: the follow-up
// questions and results are canned mock data so the look and flow can be
// approved before wiring the real pipeline (extract → design → sim → verdict).
//
// The clarify step is intentionally shaped for AI-generated questions: swap
// MOCK_QUESTIONS for a fetch to an agent endpoint and nothing else changes.
// The old VNG-corporate tool still lives at /classic.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Step = "describe" | "clarify" | "plan" | "running" | "verdict";

const STEP_ORDER: Step[] = ["describe", "clarify", "plan", "running", "verdict"];
const STEP_LABELS: Record<Step, string> = {
  describe: "Describe",
  clarify: "Clarify",
  plan: "Plan",
  running: "Run",
  verdict: "Verdict",
};

const EXAMPLE_PROMPTS = [
  "A red Buy button lifts new-player conversion",
  "A Tết-themed promo boosts ARPU for returning players",
  "A shorter tutorial improves day-1 retention",
  "Zalo login instead of email raises signup completion",
  "A limited-time skin bundle increases first purchase rate",
  "Push-notification nudges reduce day-7 churn",
];

interface ClarifyQuestion {
  id: string;
  prompt: string;
  hint: string;
  quickPicks: string[];
  placeholder: string;
}

// Stand-in for the AI-generated follow-ups. In production these arrive from the
// agent after it reads the hypothesis; the shape below is what it returns.
const MOCK_QUESTIONS: ClarifyQuestion[] = [
  {
    id: "baseline",
    prompt: "Where does this metric sit today?",
    hint: "We need your real starting number so the statistics mean something.",
    quickPicks: ["~2%", "~5%", "~10%", "Not sure yet"],
    placeholder: "e.g. 4.3% of new players convert in week one",
  },
  {
    id: "segment",
    prompt: "Which players should feel this change?",
    hint: "A narrower audience gives a sharper, faster answer.",
    quickPicks: ["New players (first 7 days)", "Paying users", "All active users"],
    placeholder: "e.g. new players in Vietnam on mobile",
  },
  {
    id: "mde",
    prompt: "How big a lift would make this worth shipping?",
    hint: "Below this, the change is not worth the risk of shipping it.",
    quickPicks: ["+0.5pp", "+1pp", "+2pp"],
    placeholder: "e.g. anything above +1 percentage point",
  },
];

interface MockVerdict {
  decision: "ship" | "iterate" | "kill";
  rationale: string;
  change: string;
  luck: string;
  range: string;
  people: string;
}

const MOCK_VERDICT: MockVerdict = {
  decision: "ship",
  rationale:
    "The treatment beat control by a clear margin, the result is well outside the range of luck, and every safety check stayed green.",
  change: "+2.7pp",
  luck: "<0.001",
  range: "+1.9pp to +3.5pp",
  people: "12,400",
};

// ── Base palettes ────────────────────────────────────────────────────────────
// Orange (#f1592a) stays the constant accent on every base. Only the background
// gradient + aurora glow change, so we can audition the mood without touching
// any component. `bg` is the full `.stage` background; `aurora` is the drifting
// glow; `swatch` is the picker chip preview.
interface Theme {
  id: string;
  label: string;
  bg: string;
  swatch: string;
  /** Light bases flip text/glass tokens via [data-mode="light"]. */
  mode?: "light" | "dark";
  /** Optional faint hero art painted behind the flow (VNG key art). */
  image?: string;
}

// Glow lives only in the bottom-left + centre; the top-right stays flat.
const THEMES: Theme[] = [
  {
    id: "vng",
    label: "VNG Arena",
    mode: "light",
    bg: "radial-gradient(1400px 1000px at 50% -14%, rgba(241,89,42,0.30), transparent 60%), radial-gradient(1000px 780px at 100% 112%, rgba(216,96,40,0.20), transparent 62%), radial-gradient(1200px 900px at 50% 130%, rgba(60,38,20,0.28), transparent 60%), #d3b287",
    swatch: "linear-gradient(135deg,#e6cfb4,#f1592a)",
    image: "url(/vng-hero.png)",
  },
  {
    id: "sand",
    label: "Sand",
    mode: "light",
    bg: "radial-gradient(1000px 720px at 0% 112%, rgba(241,89,42,0.13), transparent 55%), radial-gradient(760px 560px at 62% 44%, rgba(255,255,255,0.55), transparent 72%), #f3ecdf",
    swatch: "linear-gradient(135deg,#f3ecdf,#f1592a)",
  },
  {
    id: "burgundy",
    label: "Burgundy",
    bg: "radial-gradient(900px 720px at -10% 108%, rgba(96,20,48,0.45), transparent 55%), radial-gradient(700px 520px at 50% 50%, rgba(60,12,30,0.30), transparent 70%), #08040a",
    swatch: "linear-gradient(135deg,#3a0d18,#a8223e)",
  },
  {
    id: "midnight",
    label: "Midnight",
    bg: "radial-gradient(900px 720px at -10% 108%, rgba(28,40,110,0.45), transparent 55%), radial-gradient(700px 520px at 50% 50%, rgba(18,26,70,0.35), transparent 70%), #04060f",
    swatch: "linear-gradient(135deg,#0a1636,#2a5bd0)",
  },
  {
    id: "charcoal",
    label: "Charcoal",
    bg: "radial-gradient(900px 720px at -10% 108%, rgba(255,255,255,0.05), transparent 55%), radial-gradient(700px 520px at 50% 50%, rgba(255,255,255,0.03), transparent 70%), #0c0c0f",
    swatch: "linear-gradient(135deg,#161619,#3a3a40)",
  },
  {
    id: "teal",
    label: "Deep teal",
    bg: "radial-gradient(900px 720px at -10% 108%, rgba(12,90,90,0.42), transparent 55%), radial-gradient(700px 520px at 50% 50%, rgba(8,50,55,0.35), transparent 70%), #04100e",
    swatch: "linear-gradient(135deg,#062018,#12a082)",
  },
  {
    id: "plum",
    label: "Plum",
    bg: "radial-gradient(900px 720px at -10% 108%, rgba(80,40,150,0.42), transparent 55%), radial-gradient(700px 520px at 50% 50%, rgba(45,25,90,0.35), transparent 70%), #0a0614",
    swatch: "linear-gradient(135deg,#150a28,#8246dc)",
  },
  {
    id: "espresso",
    label: "Espresso",
    bg: "radial-gradient(900px 720px at -10% 108%, rgba(120,60,25,0.42), transparent 55%), radial-gradient(700px 520px at 50% 50%, rgba(70,40,20,0.35), transparent 70%), #0d0906",
    swatch: "linear-gradient(135deg,#1a1109,#b4652a)",
  },
];

// ── Texture layer ────────────────────────────────────────────────────────────
// A pattern painted over the base color — the second creative axis. Each is a
// CSS class in the stylesheet (see `.texture.*`). Labels are thematic to the
// product (a crowd of agents, a sonar ping of an audience, a blueprint plan).
const PATTERNS: Array<{ id: string; label: string }> = [
  { id: "none", label: "Plain" },
  { id: "dots", label: "Crowd" },
  { id: "grid", label: "Blueprint" },
  { id: "mesh", label: "Mesh" },
  { id: "rings", label: "Sonar" },
  { id: "waves", label: "Ridge" },
  { id: "grain", label: "Film" },
];

export default function Home() {
  const [step, setStep] = useState<Step>("describe");
  const [hypothesis, setHypothesis] = useState("");
  const [thinking, setThinking] = useState<string | null>(null);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [runPct, setRunPct] = useState(0);
  const [themeId, setThemeId] = useState("vng");
  const [pattern, setPattern] = useState("grid");
  // Furthest step the user has reached — the rail lets them jump back to any
  // reached step; editing an earlier step collapses this frontier so the
  // downstream analysis has to be redone.
  const [maxReached, setMaxReached] = useState(0);

  const theme = useMemo(() => THEMES.find((t) => t.id === themeId) ?? THEMES[0], [themeId]);

  // Remember the chosen base + texture across reloads while auditioning looks.
  // Key is versioned (v2) so an earlier saved choice doesn't pin the old default.
  useEffect(() => {
    const savedTheme = window.localStorage.getItem("skinsim-theme-v3");
    if (savedTheme && THEMES.some((t) => t.id === savedTheme)) setThemeId(savedTheme);
    const savedPattern = window.localStorage.getItem("skinsim-pattern-v3");
    if (savedPattern && PATTERNS.some((p) => p.id === savedPattern)) setPattern(savedPattern);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("skinsim-theme-v3", themeId);
  }, [themeId]);
  useEffect(() => {
    window.localStorage.setItem("skinsim-pattern-v3", pattern);
  }, [pattern]);

  // Cursor tracking drives the interactive blueprint: --mx/--my position the
  // glow spotlight, --gx/--gy give the grid a gentle parallax wobble.
  const onStageMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const el = e.currentTarget;
    el.style.setProperty("--mx", `${x}px`);
    el.style.setProperty("--my", `${y}px`);
    el.style.setProperty("--gx", `${((x - r.width / 2) / 34).toFixed(1)}px`);
    el.style.setProperty("--gy", `${((y - r.height / 2) / 34).toFixed(1)}px`);
  }, []);

  const goTo = useCallback((next: Step) => {
    setStep(next);
    setMaxReached((m) => Math.max(m, STEP_ORDER.indexOf(next)));
  }, []);

  // Jump straight to any already-reached step from the rail.
  const jumpTo = useCallback((i: number) => setStep(STEP_ORDER[i]), []);

  // Editing the hypothesis invalidates every downstream step.
  const changeHypothesis = useCallback((v: string) => {
    setHypothesis(v);
    setMaxReached((m) => Math.min(m, 0));
    setRunPct(0);
  }, []);

  // Simulate the agent "reading" the idea before the clarify step. Wired later
  // to the real extract endpoint that also generates the questions.
  const submitIdea = useCallback(() => {
    if (!hypothesis.trim()) return;
    setThinking("Reading your idea and figuring out what to ask");
    window.setTimeout(() => {
      setThinking(null);
      setQIndex(0);
      goTo("clarify");
    }, 1400);
  }, [hypothesis, goTo]);

  const answerCurrent = useCallback(
    (value: string) => {
      const q = MOCK_QUESTIONS[qIndex];
      setAnswers((prev) => ({ ...prev, [q.id]: value }));
      // Changing an answer invalidates the plan, run, and verdict.
      setMaxReached((m) => Math.min(m, 1));
      setRunPct(0);
    },
    [qIndex],
  );

  const nextQuestion = useCallback(() => {
    if (qIndex < MOCK_QUESTIONS.length - 1) {
      setQIndex((i) => i + 1);
      return;
    }
    setThinking("Designing a rigorous test from your answers");
    window.setTimeout(() => {
      setThinking(null);
      goTo("plan");
    }, 1400);
  }, [qIndex, goTo]);

  const prevQuestion = useCallback(() => {
    if (qIndex > 0) setQIndex((i) => i - 1);
    else goTo("describe");
  }, [qIndex, goTo]);

  const runTest = useCallback(() => {
    setRunPct(0);
    goTo("running");
  }, [goTo]);

  // Drive the fake progress bar, then reveal the verdict.
  useEffect(() => {
    if (step !== "running") return;
    let pct = 0;
    const timer = window.setInterval(() => {
      pct = Math.min(100, pct + 4 + Math.random() * 6);
      setRunPct(pct);
      if (pct >= 100) {
        window.clearInterval(timer);
        window.setTimeout(() => goTo("verdict"), 500);
      }
    }, 140);
    return () => window.clearInterval(timer);
  }, [step, goTo]);

  const restart = useCallback(() => {
    setHypothesis("");
    setAnswers({});
    setQIndex(0);
    setRunPct(0);
    setMaxReached(0);
    goTo("describe");
  }, [goTo]);

  const activeIndex = STEP_ORDER.indexOf(step);

  return (
    <main
      className="stage"
      data-mode={theme.mode ?? "dark"}
      onMouseMove={onStageMove}
      style={
        {
          ["--stage-bg" as string]: theme.bg,
          ["--stage-image" as string]: theme.image ?? "none",
        } as React.CSSProperties
      }
    >
      {theme.image && <div className="stage-image" aria-hidden />}
      <div className={`texture ${pattern}`} aria-hidden />

      <nav className="topbar">
        <span className="brandmark">
          <span className="brand-dot" /> SkinSim
        </span>
        <div className="top-links">
          <a href="/world?mode=replay&demo=kfc">Watch the crowd →</a>
          <a href="/classic">Classic view</a>
        </div>
      </nav>

      <StepRail activeIndex={activeIndex} maxReached={maxReached} onJump={jumpTo} />

      <section className="flow">
        {step === "describe" && (
          <DescribeStep
            hypothesis={hypothesis}
            setHypothesis={changeHypothesis}
            onSubmit={submitIdea}
          />
        )}

        {step === "clarify" && (
          <ClarifyStep
            question={MOCK_QUESTIONS[qIndex]}
            index={qIndex}
            total={MOCK_QUESTIONS.length}
            value={answers[MOCK_QUESTIONS[qIndex].id] ?? ""}
            onAnswer={answerCurrent}
            onNext={nextQuestion}
            onPrev={prevQuestion}
          />
        )}

        {step === "plan" && (
          <PlanStep hypothesis={hypothesis} answers={answers} onRun={runTest} onBack={() => goTo("clarify")} />
        )}

        {step === "running" && <RunningStep pct={runPct} />}

        {step === "verdict" && <VerdictStep verdict={MOCK_VERDICT} onRestart={restart} />}
      </section>

      {thinking && <ThinkingOverlay />}

      <style>{styles}</style>
    </main>
  );
}

// ── Step rail ──────────────────────────────────────────────────────────────
function StepRail({
  activeIndex,
  maxReached,
  onJump,
}: {
  activeIndex: number;
  maxReached: number;
  onJump: (i: number) => void;
}) {
  return (
    <div className="rail" aria-label="Progress">
      {STEP_ORDER.map((s, i) => {
        const reached = i <= maxReached;
        const isActive = i === activeIndex;
        const isDone = reached && !isActive;
        return (
          <button
            key={s}
            type="button"
            className={`rail-item ${isActive ? "active" : ""} ${isDone ? "done" : ""} ${reached ? "reachable" : "locked"}`}
            onClick={() => reached && onJump(i)}
            disabled={!reached}
            aria-current={isActive ? "step" : undefined}
          >
            <span className="rail-dot">{isDone ? "✓" : i + 1}</span>
            <span className="rail-label">{STEP_LABELS[s]}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Step 1: Describe ─────────────────────────────────────────────────────────
function DescribeStep({
  hypothesis,
  setHypothesis,
  onSubmit,
}: {
  hypothesis: string;
  setHypothesis: (v: string) => void;
  onSubmit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="describe fade-in">
      {EXAMPLE_PROMPTS.map((p, i) => (
        <button
          key={p}
          type="button"
          className={`float-pill pill-${i}`}
          onClick={() => setHypothesis(p)}
          tabIndex={-1}
        >
          {p}
        </button>
      ))}

      <div className="hero">
        <h1 className="headline" data-text="What do you want to test?">What do you want to test?</h1>
        <p className="subhead">
          Describe a change and we will find out if it wins with a simulated Vietnamese
          audience.
        </p>

        <div className="glass input-card">
          <textarea
            ref={ref}
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            rows={1}
            placeholder="Describe an ad, a promo, a price, or a UX change on your mind"
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 160) + "px";
            }}
          />
          <div className="input-bar">
            <span className="input-hint">Press Enter to begin</span>
            <button type="button" className="send" onClick={onSubmit} disabled={!hypothesis.trim()} aria-label="Begin">
              →
            </button>
          </div>
        </div>

        <p className="tap-hint">Tap an idea above, or write your own</p>
      </div>
    </div>
  );
}

// ── Step 2: Clarify ──────────────────────────────────────────────────────────
function ClarifyStep({
  question,
  index,
  total,
  value,
  onAnswer,
  onNext,
  onPrev,
}: {
  question: ClarifyQuestion;
  index: number;
  total: number;
  value: string;
  onAnswer: (v: string) => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  const canNext = value.trim().length > 0;
  return (
    <div className="clarify fade-in" key={question.id}>
      <div className="question-card slide-in">
        <h2 className="question">{question.prompt}</h2>
        <p className="question-hint">{question.hint}</p>

        <div className="quick-picks">
          {question.quickPicks.map((pick) => (
            <button
              key={pick}
              type="button"
              className={`chip ${value === pick ? "chip-on" : ""}`}
              onClick={() => onAnswer(pick)}
            >
              {pick}
            </button>
          ))}
        </div>

        <input
          className="answer-input"
          value={value}
          onChange={(e) => onAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canNext) onNext();
          }}
          placeholder={question.placeholder}
        />
      </div>

      <div className="clarify-nav">
        <button type="button" className="ghost-btn" onClick={onPrev}>
          Back
        </button>
        <div className="dots">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`dot ${i === index ? "dot-on" : ""} ${i < index ? "dot-done" : ""}`} />
          ))}
        </div>
        <button type="button" className="primary-btn" onClick={onNext} disabled={!canNext}>
          {index === total - 1 ? "Build my test plan" : "Next"}
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Plan ─────────────────────────────────────────────────────────────
function PlanStep({
  hypothesis,
  answers,
  onRun,
  onBack,
}: {
  hypothesis: string;
  answers: Record<string, string>;
  onRun: () => void;
  onBack: () => void;
}) {
  return (
    <div className="plan fade-in">
      <div className="plan-card slide-in">
        <p className="plan-idea">&ldquo;{hypothesis || "Your idea"}&rdquo;</p>

        <div className="plan-grid">
          <PlanCell label="What we measure" value="Purchase conversion" />
          <PlanCell label="Audience" value={answers.segment || "New players"} />
          <PlanCell label="Starting point" value={answers.baseline || "~5%"} />
          <PlanCell label="Lift that matters" value={answers.mde || "+1pp"} />
          <PlanCell label="People per version" value="6,200" />
          <PlanCell label="Days to run" value="14 days" />
        </div>

        <div className="plan-rows">
          <PlanRow label="Versions" value="Two versions, each shown to half the audience, split fairly" />
          <PlanRow label="When we stop" value="At the planned sample, or when a safety check trips" />
          <PlanRow label="Safety checks" value="Crash rate and refund rate must not regress" />
        </div>
      </div>

      <div className="clarify-nav">
        <button type="button" className="ghost-btn" onClick={onBack}>
          Back
        </button>
        <button type="button" className="primary-btn wide" onClick={onRun}>
          Run the test
        </button>
      </div>
    </div>
  );
}

function PlanCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="plan-cell">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PlanRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="plan-row">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

// ── Step 4: Running ──────────────────────────────────────────────────────────
function RunningStep({ pct }: { pct: number }) {
  return (
    <div className="running fade-in">
      <div className="crowd" aria-hidden>
        {Array.from({ length: 40 }, (_, i) => (
          <span key={i} className="crowd-dot" style={{ animationDelay: `${(i % 10) * 0.12}s` }} />
        ))}
      </div>
      <h2 className="headline sm" data-text="The crowd is reacting">The crowd is reacting</h2>
      <p className="subhead">Showing both versions to the same simulated audience</p>
      <div className="progress-card">
        <div className="track">
          <div className="fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="pct">{Math.round(pct)}%</span>
      </div>
    </div>
  );
}

// ── Step 5: Verdict ──────────────────────────────────────────────────────────
function VerdictStep({ verdict, onRestart }: { verdict: MockVerdict; onRestart: () => void }) {
  const label = verdict.decision.toUpperCase();
  return (
    <div className="verdict fade-in">
      <div className={`verdict-card ${verdict.decision} slide-in`}>
        <span className={`verdict-badge ${verdict.decision}`}>{label}</span>
        <p className="verdict-rationale">{verdict.rationale}</p>
        <div className="verdict-grid">
          <PlanCell label="Change we saw" value={verdict.change} />
          <PlanCell label="Chance it's just luck" value={verdict.luck} />
          <PlanCell label="Likely true range" value={verdict.range} />
          <PlanCell label="People tested" value={verdict.people} />
        </div>
        <div className="verdict-actions">
          <a className="primary-btn wide" href="/world?mode=replay&demo=kfc">
            Watch the crowd react
          </a>
          <button type="button" className="ghost-btn" onClick={onRestart}>
            Test another idea
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Thinking overlay ─────────────────────────────────────────────────────────
function ThinkingOverlay() {
  return (
    <div className="thinking-overlay">
      <span className="big-spinner" />
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = `
  :root {
    --ink: #ffffff;
    --soft: rgba(255,255,255,0.62);
    --faint: rgba(255,255,255,0.4);
    --vng-orange: #f1592a;
    --vng-orange-deep: #d64a1f;
    --glass-bg: rgba(255,255,255,0.07);
    --glass-bg-strong: rgba(255,255,255,0.12);
    --glass-border: rgba(255,255,255,0.16);
    --glass-border-strong: rgba(255,255,255,0.28);
    --good: #34d17a;
    --warn: #f0b23a;
    --bad: #ff5b6a;
    --radius: 22px;
    --radius-sm: 14px;
    --stage-bg:
      radial-gradient(1100px 760px at 100% -5%, rgba(168,34,62,0.55), transparent 58%),
      radial-gradient(900px 720px at -10% 108%, rgba(96,20,48,0.45), transparent 55%),
      radial-gradient(700px 520px at 50% 50%, rgba(60,12,30,0.30), transparent 70%),
      #08040a;
    --grid-line: rgba(255,255,255,0.06);
    --grid-glow: rgba(241,89,42,0.75);
    --grid-halo: rgba(241,89,42,0.10);
  }

  * { box-sizing: border-box; }

  body { margin: 0; }

  .stage {
    position: relative;
    min-height: 100vh;
    overflow: hidden;
    color: var(--ink);
    font-family: "SVN-Gilroy", "Gilroy", var(--font-brand), "Segoe UI", system-ui, sans-serif;
    background: var(--stage-bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 22px clamp(16px, 4vw, 48px) 60px;
  }

  /* top bar */
  .topbar {
    width: 100%;
    max-width: 1080px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    z-index: 3;
  }

  .brandmark {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font-weight: 700;
    font-size: 16px;
    letter-spacing: 0.01em;
  }

  .brand-dot {
    width: 15px;
    height: 15px;
    border-radius: 6px;
    background: linear-gradient(135deg, var(--vng-orange), #ff8a5c);
    box-shadow: 0 0 16px rgba(241, 89, 42, 0.6);
  }

  .top-links { display: flex; gap: 18px; }

  .top-links a {
    color: var(--soft);
    text-decoration: none;
    font-size: 13.5px;
    font-weight: 500;
    transition: color 0.15s ease;
  }

  .top-links a:hover { color: var(--ink); }

  /* step rail */
  .rail {
    display: flex;
    gap: 8px;
    margin: 26px 0 8px;
    padding: 8px 10px;
    border-radius: 999px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    z-index: 3;
  }

  .rail-item {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 12px 5px 6px;
    border-radius: 999px;
    color: var(--faint);
    background: none;
    border: none;
    font-family: inherit;
    cursor: pointer;
    transition: color 0.2s ease, background 0.2s ease;
  }

  .rail-item.locked { cursor: default; }
  .rail-item.reachable:not(.active):hover { background: rgba(255,255,255,0.1); color: var(--ink); }

  .rail-item.active { color: var(--ink); background: rgba(255,255,255,0.08); }
  .rail-item.done { color: var(--soft); }

  .rail-dot {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 11.5px;
    font-weight: 700;
    border: 1px solid var(--glass-border-strong);
    background: rgba(255,255,255,0.05);
  }

  .rail-item.active .rail-dot {
    background: var(--vng-orange);
    border-color: transparent;
    box-shadow: 0 0 14px rgba(241, 89, 42, 0.55);
  }

  .rail-item.done .rail-dot { background: rgba(52, 209, 122, 0.22); border-color: rgba(52,209,122,0.5); }

  .rail-label { font-size: 13px; font-weight: 600; }

  /* flow container */
  .flow {
    position: relative;
    z-index: 2;
    width: 100%;
    max-width: 720px;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
  }

  /* glass primitive */
  .glass {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    box-shadow: 0 24px 60px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08);
  }

  /* headings */
  .headline {
    margin: 0;
    font-size: clamp(24px, 4.5vw, 46px);
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: 1.08;
    white-space: nowrap;
    color: #fff;
    text-shadow: 0 1px 16px rgba(40,20,5,0.4);
  }

  .headline.sm { font-size: clamp(22px, 3.4vw, 34px); }

  @media (max-width: 560px) {
    .headline { white-space: normal; }
  }

  .subhead {
    margin: 14px auto 0;
    max-width: 460px;
    color: rgba(255,255,255,0.85);
    font-size: 15.5px;
    line-height: 1.6;
    text-shadow: 0 1px 12px rgba(40,20,5,0.35);
  }

  /* describe step */
  .describe { position: relative; width: 100%; padding: 96px 0; }

  .hero { text-align: center; position: relative; z-index: 2; max-width: 760px; margin: 0 auto; }

  .input-card {
    margin: 26px auto 0;
    max-width: 540px;
    border-radius: var(--radius);
    padding: 8px 8px 8px 18px;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .input-card:focus-within {
    border-color: var(--glass-border-strong);
    box-shadow: 0 24px 60px rgba(0,0,0,0.4), 0 0 0 3px rgba(241, 89, 42, 0.18);
  }

  .input-card textarea {
    width: 100%;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: var(--ink);
    font-family: inherit;
    font-size: 16px;
    line-height: 1.5;
    padding: 12px 0 4px;
  }

  .input-card textarea::placeholder { color: var(--faint); }

  .input-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 2px 2px 0;
  }

  .input-hint { font-size: 12px; color: var(--faint); }

  .send {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    font-size: 19px;
    color: #fff;
    background: var(--vng-orange);
    box-shadow: 0 6px 18px rgba(241, 89, 42, 0.45);
    transition: transform 0.12s ease, background 0.15s ease, opacity 0.15s ease;
  }

  .send:hover:not(:disabled) { background: var(--vng-orange-deep); }
  .send:active:not(:disabled) { transform: scale(0.94); }
  .send:disabled { opacity: 0.35; cursor: default; box-shadow: none; }

  .tap-hint { margin-top: 18px; color: var(--faint); font-size: 13px; }

  /* floating example pills */
  .float-pill {
    position: absolute;
    z-index: 1;
    padding: 9px 17px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--soft);
    background: var(--glass-bg);
    border: 1px solid var(--glass-border-strong);
    backdrop-filter: blur(18px) saturate(1.6);
    -webkit-backdrop-filter: blur(18px) saturate(1.6);
    box-shadow: 0 12px 30px rgba(60,35,15,0.16), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(0,0,0,0.05);
    cursor: pointer;
    white-space: nowrap;
    max-width: 230px;
    overflow: hidden;
    text-overflow: ellipsis;
    will-change: transform;
    animation: floatpill 6s ease-in-out infinite alternate;
    transition: color 0.15s ease, border-color 0.15s ease, box-shadow 0.25s ease, max-width 0.3s ease;
  }

  .float-pill:hover {
    color: var(--ink);
    border-color: var(--glass-border-strong);
    box-shadow: 0 18px 44px rgba(60,35,15,0.24), inset 0 1px 0 rgba(255,255,255,0.7);
    max-width: min(72vw, 480px);
    z-index: 6;
  }

  /* Pills frame the hero: two above the headline, two in the side gutters at
     input level, two below the hint. They never enter the centre text column. */
  /* Left-column pills anchor their RIGHT edge so they expand leftward (outward);
     right-column pills anchor their LEFT edge so they expand rightward. Both
     grow into the empty gutter, never toward the centre content. */
  .pill-0 { top: 20px; right: calc(100% - 168px); animation-delay: 0s; animation-duration: 6.2s; }
  .pill-1 { top: 46px; left: calc(100% - 172px); animation-delay: 0.8s; animation-duration: 7.4s; }
  .pill-2 { top: 52%; right: calc(100% - 12px); animation-delay: 1.6s; animation-duration: 6.8s; }
  .pill-3 { top: 60%; left: calc(100% - 20px); animation-delay: 2.2s; animation-duration: 8s; }
  .pill-4 { bottom: 20px; right: calc(100% - 190px); animation-delay: 1.1s; animation-duration: 7s; }
  .pill-5 { bottom: 46px; left: calc(100% - 186px); animation-delay: 2.6s; animation-duration: 6.5s; }

  @keyframes floatpill {
    0%   { transform: translate(0, 0) rotate(-0.5deg); }
    50%  { transform: translate(3px, -7px) rotate(0.4deg); }
    100% { transform: translate(-2px, -13px) rotate(-0.3deg); }
  }

  /* Side pills need the outer gutter; hide the whole set when it gets tight. */
  @media (max-width: 1040px) {
    .float-pill { display: none; }
  }

  /* faint hero art behind everything */
  .stage-image {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    aspect-ratio: 1672 / 941;
    z-index: 0;
    background-image: var(--stage-image);
    background-size: cover;
    background-position: 50% 40%;
    opacity: 0.16;
    transform: translate(calc(var(--gx, 0px) * 1.6), calc(var(--gy, 0px) * 1.1));
    transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
    -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 62%, transparent 100%);
            mask-image: linear-gradient(to bottom, #000 0%, #000 62%, transparent 100%);
    pointer-events: none;
  }

  /* texture layer */
  .texture {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
  }

  .texture.dots {
    background-image: radial-gradient(rgba(255,255,255,0.16) 1.3px, transparent 1.5px);
    background-size: 24px 24px;
    -webkit-mask-image: radial-gradient(120% 90% at 50% 32%, #000 22%, transparent 72%);
            mask-image: radial-gradient(120% 90% at 50% 32%, #000 22%, transparent 72%);
  }

  /* Blueprint: a parallax base grid + a cursor-following glow overlay that
     lights up and nudges the lines near the pointer (the hover wobble). */
  .texture.grid {
    background-image:
      linear-gradient(var(--grid-line) 1px, transparent 1px),
      linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
    background-size: 46px 46px;
    background-position: var(--gx, 0px) var(--gy, 0px);
    transition: background-position 0.35s cubic-bezier(0.22, 1, 0.36, 1);
    -webkit-mask-image: radial-gradient(120% 90% at 50% 28%, #000 30%, transparent 78%);
            mask-image: radial-gradient(120% 90% at 50% 28%, #000 30%, transparent 78%);
  }

  /* soft warm halo disc under the cursor */
  .texture.grid::before {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(circle 120px at var(--mx, -999px) var(--my, -999px), var(--grid-halo, rgba(241,89,42,0.12)), transparent 72%);
    pointer-events: none;
  }

  /* brighter grid lines that light up around the pointer */
  .texture.grid::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(var(--grid-glow) 1.6px, transparent 1.6px),
      linear-gradient(90deg, var(--grid-glow) 1.6px, transparent 1.6px);
    background-size: 46px 46px;
    background-position: var(--gx, 0px) var(--gy, 0px);
    -webkit-mask-image: radial-gradient(circle 125px at var(--mx, -999px) var(--my, -999px), #000 0%, #000 42%, transparent 80%);
            mask-image: radial-gradient(circle 125px at var(--mx, -999px) var(--my, -999px), #000 0%, #000 42%, transparent 80%);
    transition: background-position 0.35s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .texture.mesh {
    background-image:
      radial-gradient(38% 40% at 16% 20%, rgba(241,89,42,0.30), transparent 70%),
      radial-gradient(42% 44% at 84% 26%, rgba(130,80,220,0.24), transparent 70%),
      radial-gradient(48% 50% at 28% 84%, rgba(40,170,190,0.22), transparent 70%),
      radial-gradient(40% 42% at 78% 80%, rgba(226,58,120,0.24), transparent 70%);
    filter: blur(14px);
  }

  .texture.rings {
    background-image: repeating-radial-gradient(circle at 50% 40%, rgba(255,255,255,0.07) 0 1.5px, transparent 1.5px 58px);
    -webkit-mask-image: radial-gradient(78% 78% at 50% 40%, #000, transparent 78%);
            mask-image: radial-gradient(78% 78% at 50% 40%, #000, transparent 78%);
  }

  .texture.waves {
    background-image: repeating-linear-gradient(118deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 24px);
    -webkit-mask-image: radial-gradient(130% 100% at 50% 18%, #000 42%, transparent 82%);
            mask-image: radial-gradient(130% 100% at 50% 18%, #000 42%, transparent 82%);
  }

  .texture.grain {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    opacity: 0.07;
  }

  /* style dock */
  .style-dock {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px;
    border-radius: 18px;
  }

  .dock-row { display: flex; align-items: center; gap: 8px; }

  .dock-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--faint);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    width: 58px;
    flex: none;
  }

  .swatch {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12);
    transition: transform 0.12s ease, border-color 0.12s ease;
  }

  .swatch:hover { transform: scale(1.12); }

  .swatch-on {
    border-color: #fff;
    box-shadow: 0 0 0 2px rgba(241, 89, 42, 0.5);
  }

  .tex-pill {
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    color: var(--soft);
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--glass-border);
    border-radius: 999px;
    padding: 5px 12px;
    cursor: pointer;
    transition: all 0.14s ease;
  }

  .tex-pill:hover { color: var(--ink); border-color: var(--glass-border-strong); }

  .tex-on {
    color: #fff;
    background: rgba(241, 89, 42, 0.22);
    border-color: rgba(241, 89, 42, 0.7);
  }

  @media (max-width: 640px) {
    .style-dock { max-width: 92vw; }
    .dock-row { flex-wrap: wrap; }
  }

  /* ── light bases (Sand) ─────────────────────────────────────────────────── */
  .stage[data-mode="light"] {
    --ink: #201c16;
    --soft: rgba(32,28,22,0.66);
    --faint: rgba(32,28,22,0.44);
    --glass-bg: rgba(255,244,232,0.46);
    --glass-bg-strong: rgba(255,246,236,0.66);
    --glass-border: rgba(40,30,20,0.14);
    --glass-border-strong: rgba(40,30,20,0.26);
    --grid-line: rgba(110,70,35,0.12);
    --grid-glow: rgba(241,89,42,1);
    --grid-halo: rgba(241,89,42,0.18);
  }

  /* Dark hero art becomes a sepia watermark on the beige base. */
  .stage[data-mode="light"] .stage-image {
    opacity: 0.22;
    mix-blend-mode: multiply;
  }

  .stage[data-mode="light"] .glass {
    box-shadow: 0 18px 46px rgba(70,48,24,0.14), inset 0 1px 0 rgba(255,255,255,0.6);
  }

  .stage[data-mode="light"] .input-card:focus-within {
    box-shadow: 0 18px 46px rgba(70,48,24,0.18), 0 0 0 3px rgba(241,89,42,0.20);
  }

  .stage[data-mode="light"] .float-pill,
  .stage[data-mode="light"] .chip,
  .stage[data-mode="light"] .tex-pill,
  .stage[data-mode="light"] .rail-dot {
    background: rgba(255,255,255,0.55);
  }

  .stage[data-mode="light"] .float-pill {
    background: rgba(255,247,238,0.4);
    box-shadow: 0 12px 30px rgba(80,45,20,0.16), inset 0 1px 0 rgba(255,255,255,0.7);
  }

  .stage[data-mode="light"] .answer-input { background: rgba(255,246,236,0.5); }
  .stage[data-mode="light"] .track { background: rgba(40,30,20,0.12); }
  .stage[data-mode="light"] .crowd-dot { background: rgba(40,30,20,0.18); }

  .stage[data-mode="light"] .chip-on,
  .stage[data-mode="light"] .tex-on {
    background: var(--vng-orange);
    color: #fff;
    border-color: transparent;
  }

  .stage[data-mode="light"] .rail-item.done .rail-dot {
    background: rgba(52,209,122,0.28);
    border-color: rgba(52,209,122,0.6);
  }

  /* clarify step */
  .clarify { width: 100%; text-align: center; margin-top: -120px; }

  .step-eyebrow {
    margin: 0 0 16px;
    color: var(--faint);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .question-card {
    border-radius: var(--radius);
    padding: 34px 30px;
    text-align: left;
  }

  .question {
    margin: 0;
    font-size: clamp(22px, 3vw, 30px);
    font-weight: 500;
    letter-spacing: -0.01em;
    line-height: 1.2;
    color: #fff;
    text-shadow: 0 1px 16px rgba(40,20,5,0.4);
  }

  .question-hint {
    margin: 10px 0 22px;
    color: rgba(255,255,255,0.85);
    font-size: 14.5px;
    line-height: 1.55;
    text-shadow: 0 1px 12px rgba(40,20,5,0.35);
  }

  .quick-picks { display: flex; flex-wrap: wrap; gap: 9px; margin-bottom: 18px; }

  .chip {
    padding: 9px 16px;
    border-radius: 999px;
    font-size: 13.5px;
    font-weight: 500;
    color: var(--soft);
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--glass-border);
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s ease;
  }

  .chip:hover { color: var(--ink); border-color: var(--glass-border-strong); }

  .chip-on {
    color: #fff;
    background: rgba(241, 89, 42, 0.22);
    border-color: rgba(241, 89, 42, 0.7);
  }

  .answer-input {
    width: 100%;
    padding: 13px 15px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    color: var(--ink);
    font-family: inherit;
    font-size: 15px;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .answer-input::placeholder { color: var(--faint); }
  .answer-input:focus {
    border-color: rgba(241, 89, 42, 0.6);
    box-shadow: 0 0 0 3px rgba(241, 89, 42, 0.14);
  }

  /* nav row */
  .clarify-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-top: 22px;
  }

  .dots { display: flex; gap: 7px; }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(255,255,255,0.18);
    transition: all 0.2s ease;
  }

  .dot-on { background: var(--vng-orange); box-shadow: 0 0 10px rgba(241,89,42,0.6); }
  .dot-done { background: rgba(52,209,122,0.7); }

  .primary-btn, .ghost-btn {
    font-family: inherit;
    font-size: 14.5px;
    font-weight: 600;
    border-radius: 999px;
    padding: 12px 24px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-decoration: none;
    display: inline-block;
  }

  .primary-btn {
    color: #fff;
    background: var(--vng-orange);
    border: none;
    box-shadow: 0 8px 22px rgba(241, 89, 42, 0.4);
  }

  .primary-btn:hover:not(:disabled) { background: var(--vng-orange-deep); transform: translateY(-1px); }
  .primary-btn:disabled { opacity: 0.4; cursor: default; box-shadow: none; }
  .primary-btn.wide { padding-left: 34px; padding-right: 34px; }

  .ghost-btn {
    color: var(--soft);
    background: transparent;
    border: 1px solid var(--glass-border);
  }

  .ghost-btn:hover {
    color: #fff;
    border-color: rgba(255,255,255,0.9);
  }

  /* plan step */
  .plan { width: 100%; text-align: center; margin-top: -80px; }

  .plan-card { border-radius: var(--radius); padding: 30px; text-align: left; }

  .plan-idea {
    margin: 0 0 22px;
    font-size: 18px;
    font-weight: 600;
    line-height: 1.4;
    color: #fff;
    text-shadow: 0 1px 14px rgba(40,20,5,0.4);
  }

  .plan-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 18px 16px;
    padding-bottom: 22px;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--glass-border);
  }

  .plan-cell span, .plan-row span {
    display: block;
    font-size: 11.5px;
    font-weight: 600;
    color: rgba(255,255,255,0.72);
    margin-bottom: 5px;
    text-shadow: 0 1px 10px rgba(40,20,5,0.35);
  }

  .plan-cell strong {
    font-size: 19px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #fff;
    text-shadow: 0 1px 14px rgba(40,20,5,0.4);
  }

  .plan-rows { display: flex; flex-direction: column; gap: 14px; }

  .plan-row { display: grid; grid-template-columns: 130px 1fr; gap: 14px; align-items: baseline; }
  .plan-row span { margin: 0; }
  .plan-row p { margin: 0; font-size: 14px; line-height: 1.5; color: rgba(255,255,255,0.88); text-shadow: 0 1px 10px rgba(40,20,5,0.35); }

  @media (max-width: 620px) {
    .plan-grid { grid-template-columns: repeat(2, 1fr); }
    .plan-row { grid-template-columns: 1fr; gap: 3px; }
  }

  /* running step */
  .running { width: 100%; text-align: center; margin-top: -80px; }

  .crowd {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    max-width: 300px;
    margin: 0 auto 28px;
  }

  .crowd-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: rgba(255,255,255,0.25);
    animation: pulse 1.3s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { transform: scale(1); background: rgba(255,255,255,0.22); }
    50% { transform: scale(1.35); background: rgba(241, 89, 42, 0.85); }
  }

  .progress-card {
    margin: 30px auto 0;
    max-width: 460px;
    border-radius: var(--radius);
    padding: 22px 24px;
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .track {
    flex: 1;
    height: 10px;
    border-radius: 999px;
    background: rgba(0,0,0,0.3);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--vng-orange), #ff8a5c);
    transition: width 0.15s ease;
  }

  .pct { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; min-width: 44px; color: #fff; text-shadow: 0 1px 10px rgba(40,20,5,0.35); }

  /* verdict step */
  .verdict { width: 100%; margin-top: -80px; }

  .verdict-card {
    border-radius: var(--radius);
    padding: 34px 32px;
    text-align: left;
    position: relative;
    overflow: hidden;
  }

  .verdict-card.ship { box-shadow: 0 24px 60px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(52,209,122,0.35), inset 0 60px 120px rgba(52,209,122,0.10); }
  .verdict-card.iterate { box-shadow: 0 24px 60px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(240,178,58,0.35), inset 0 60px 120px rgba(240,178,58,0.10); }
  .verdict-card.kill { box-shadow: 0 24px 60px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,91,106,0.35), inset 0 60px 120px rgba(255,91,106,0.10); }

  .verdict-badge {
    display: inline-block;
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 7px 20px;
    border-radius: 999px;
    color: #06120b;
  }

  .verdict-badge.ship { background: var(--good); }
  .verdict-badge.iterate { background: var(--warn); }
  .verdict-badge.kill { background: var(--bad); color: #fff; }

  .verdict-rationale {
    margin: 18px 0 24px;
    font-size: 17px;
    line-height: 1.55;
    color: #fff;
    text-shadow: 0 1px 14px rgba(40,20,5,0.4);
  }

  .running .headline { color: #fff; text-shadow: 0 1px 14px rgba(40,20,5,0.4); }
  .running .subhead { color: rgba(255,255,255,0.85); text-shadow: 0 1px 10px rgba(40,20,5,0.35); }

  .verdict-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 20px 16px;
    padding-bottom: 26px;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--glass-border);
  }

  .verdict-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }

  /* thinking overlay — just a big orange spinner over a blurred backdrop */
  .thinking-overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    background: rgba(30, 18, 8, 0.18);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    animation: fadein 0.25s ease;
  }

  .big-spinner {
    width: 88px;
    height: 88px;
    border-radius: 50%;
    border: 7px solid rgba(241,89,42,0.18);
    border-top-color: var(--vng-orange);
    animation: spin 0.85s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* transitions */
  .fade-in { animation: fadein 0.5s ease both; }
  .slide-in { animation: slidein 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }

  @keyframes fadein {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes slidein {
    from { opacity: 0; transform: translateY(16px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
`;
