"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { demoScenarios, type DemoScenario } from "@/lib/mock-results";
import {
  checkGuardrails,
  designTest,
  parseHypothesis,
  recommend,
  type Decision,
  type Direction,
  type ParsedHypothesis,
  type TestDesign,
} from "@/lib/experiment";
import type { BriefSource, HypothesisBrief } from "@/lib/extract";
import type { ExperimentJob, ExperimentProgress } from "@/lib/sim-client";
import { significanceTest, type ExperimentResults, type MetricType } from "@/lib/stats";

const defaultHypothesis = "A red Buy button will lift purchase conversion for new players.";

interface BriefForm {
  metric: string;
  metricType: MetricType;
  unit: string;
  direction: Direction;
  baseline: string;
  mde: string;
  rationale: string;
  source: BriefSource;
}

type RunPhase = "idle" | "launching" | "preparing" | "running" | "complete" | "failed";

interface RunState {
  phase: RunPhase;
  experimentId?: string;
  progress?: ExperimentProgress;
  results?: ExperimentResults;
  error?: string;
  /** Set when the proxy fell back to the mock engine (MiroShark unreachable). */
  engineNote?: string;
}

function briefToForm(brief: HypothesisBrief): BriefForm {
  return {
    metric: brief.metric,
    metricType: brief.metricType,
    unit: brief.unit,
    direction: brief.direction,
    baseline: String(brief.baseline),
    mde: String(brief.mdeGuess),
    rationale: brief.rationale,
    source: brief.source,
  };
}

export default function Home() {
  const [hypothesis, setHypothesis] = useState(defaultHypothesis);
  const [scenario, setScenario] = useState<DemoScenario>("ship");
  const [form, setForm] = useState<BriefForm>(() => briefToForm({ ...parseHypothesis(defaultHypothesis), source: "heuristic" }));
  const [edited, setEdited] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [run, setRun] = useState<RunState>({ phase: "idle" });
  const runToken = useRef(0);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/agent" }),
  });

  // Extract an editable brief server-side (LLM when a key is configured, deterministic
  // heuristic otherwise — the server labels which one produced it).
  useEffect(() => {
    let cancelled = false;
    setExtracting(true);
    const timer = setTimeout(async () => {
      let brief: HypothesisBrief;
      try {
        const res = await fetch("/api/experiment", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "extract", hypothesis }),
        });
        const body = (await res.json()) as { brief?: HypothesisBrief };
        if (!res.ok || !body.brief) throw new Error("extract failed");
        brief = body.brief;
      } catch {
        brief = { ...parseHypothesis(hypothesis), source: "heuristic" };
      }
      if (cancelled) return;
      setForm(briefToForm(brief));
      setEdited(false);
      setExtracting(false);
      cancelInFlightRun();
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hypothesis]);

  const confirmedBrief = useMemo<ParsedHypothesis | null>(() => {
    const baseline = Number(form.baseline);
    const mde = Number(form.mde);
    if (!Number.isFinite(baseline) || baseline < 0 || !Number.isFinite(mde) || mde === 0) return null;
    return {
      text: hypothesis,
      metric: form.metric,
      metricType: form.metricType,
      unit: form.unit,
      direction: form.direction,
      baseline,
      mdeGuess: mde,
      stdGuess: form.metricType === "continuous" ? 2.1 : undefined,
      rationale: form.rationale,
    };
  }, [form, hypothesis]);

  const design = useMemo<TestDesign | null>(() => {
    if (!confirmedBrief) return null;
    try {
      return designTest(confirmedBrief);
    } catch {
      return null;
    }
  }, [confirmedBrief]);

  // Deterministic readout math — all numbers come from lib/stats.ts, never the model.
  const readout = useMemo(() => {
    if (!run.results) return null;
    const significance = significanceTest(run.results);
    const guardrails = checkGuardrails(run.results);
    const recommendation = recommend({
      desiredDirection: form.direction,
      significance,
      guardrails,
      results: run.results,
    });
    return { significance, guardrails, recommendation };
  }, [run.results, form.direction]);

  function cancelInFlightRun() {
    runToken.current += 1;
    setRun({ phase: "idle" });
  }

  function updateForm(patch: Partial<BriefForm>) {
    setForm((prev) => ({ ...prev, ...patch }));
    setEdited(true);
    cancelInFlightRun();
  }

  function selectScenario(next: DemoScenario) {
    setScenario(next);
    cancelInFlightRun();
  }

  const launch = async () => {
    if (!design || !confirmedBrief) return;
    runToken.current += 1;
    const token = runToken.current;
    setRun({ phase: "launching" });

    try {
      const createRes = await fetch("/api/experiment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hypothesis,
          variants: [
            { name: "control", text: "Current LiveOps experience." },
            { name: "treatment", text: hypothesis },
          ],
          demoScenario: scenario,
          metric: confirmedBrief.metric,
          metricType: confirmedBrief.metricType,
          unit: confirmedBrief.unit,
          alpha: design.power.alpha,
          requiredSampleSizePerVariant: design.power.sampleSizePerVariant,
          plannedDays: design.power.durationDays,
        }),
      });
      const created = (await createRes.json()) as ExperimentJob & {
        error?: { message?: string };
        engine?: string;
        engineNote?: string;
      };
      if (!createRes.ok) throw new Error(created.error?.message ?? `Create failed (HTTP ${createRes.status}).`);
      let job: ExperimentJob = created;
      // The proxy falls back to the mock engine when MiroShark is unreachable —
      // keep polling the same engine and tell the operator.
      const simParam = created.engine === "mock" ? "&sim=mock" : "";
      const engineNote = created.engineNote;
      if (runToken.current !== token) return;
      setRun({ phase: job.status === "running" ? "running" : "preparing", experimentId: job.experimentId, progress: job.progress, engineNote });

      for (let poll = 0; poll < 60 && job.status !== "complete" && job.status !== "failed"; poll += 1) {
        await sleep(650);
        const statusRes = await fetch(`/api/experiment?id=${encodeURIComponent(job.experimentId)}${simParam}`);
        const statusBody = (await statusRes.json()) as ExperimentJob & { error?: { message?: string } };
        if (!statusRes.ok) throw new Error(statusBody.error?.message ?? `Status failed (HTTP ${statusRes.status}).`);
        job = statusBody;
        if (runToken.current !== token) return;
        setRun({
          phase: job.status === "preparing" ? "preparing" : job.status === "complete" ? "running" : "running",
          experimentId: job.experimentId,
          progress: job.progress,
          engineNote,
        });
      }

      if (job.status !== "complete") {
        throw new Error(job.error || `Experiment ended as ${job.status}.`);
      }

      const resultsRes = await fetch(`/api/experiment?id=${encodeURIComponent(job.experimentId)}&results=1${simParam}`);
      const resultsBody = (await resultsRes.json()) as { results?: ExperimentResults; error?: { message?: string } };
      if (!resultsRes.ok || !resultsBody.results) {
        throw new Error(resultsBody.error?.message ?? `Results failed (HTTP ${resultsRes.status}).`);
      }
      // MiroShark leaves requiredSampleSizePerVariant at 0 — fill it from our power analysis.
      const results: ExperimentResults = resultsBody.results.requiredSampleSizePerVariant
        ? resultsBody.results
        : { ...resultsBody.results, requiredSampleSizePerVariant: design.power.sampleSizePerVariant };
      if (runToken.current !== token) return;
      setRun({ phase: "complete", experimentId: job.experimentId, progress: job.progress, results, engineNote });
    } catch (error) {
      if (runToken.current !== token) return;
      setRun({ phase: "failed", error: error instanceof Error ? error.message : "Experiment failed." });
    }
  };

  const sendToAgent = () => {
    sendMessage({
      text: `Design and read out this experiment using scenario "${scenario}": ${hypothesis}`,
    });
  };

  const toolTrace = useMemo(() => {
    const trace: Array<{ tool: string; output: unknown }> = [];
    if (confirmedBrief) trace.push({ tool: "parse_hypothesis", output: { ...confirmedBrief, source: form.source, edited } });
    if (design) {
      trace.push({ tool: "power_analysis", output: design.power });
      trace.push({ tool: "design_test", output: design });
    }
    if (run.results && readout) {
      trace.push({ tool: "significance_test", output: readout.significance });
      trace.push({ tool: "check_guardrails", output: readout.guardrails });
      trace.push({ tool: "recommend", output: readout.recommendation });
    }
    return trace;
  }, [confirmedBrief, design, run.results, readout, form.source, edited]);

  const launchDisabled = !design || extracting || run.phase === "launching" || run.phase === "preparing" || run.phase === "running";

  return (
    <main className="shell">
      <section className="intro">
        <div>
          <p className="eyebrow">SkinSim · Synthetic A/B Testing</p>
          <h1>Statistically sound decisions, not LLM math.</h1>
          <a className="world-link" href="/world?mode=replay&demo=kfc">
            ✦ Watch the crowd react in the Agent World →
          </a>
        </div>
        <p className="brief-note">
          Type a hypothesis, confirm the extracted test brief, then launch a synthetic experiment — real MiroShark
          engine when configured, deterministic mock otherwise — and get a ship, iterate, or kill call from real
          statistics with traps for underpowered tests, peeking, and novelty.
        </p>
      </section>

      <section className="workspace">
        <div className="control-panel">
          <label htmlFor="hypothesis">Hypothesis</label>
          <textarea
            id="hypothesis"
            value={hypothesis}
            onChange={(event) => setHypothesis(event.target.value)}
            rows={5}
          />

          <div className="scenario-grid" aria-label="Demo result scenario">
            {demoScenarios.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === scenario ? "scenario active" : "scenario"}
                onClick={() => selectScenario(item.id)}
              >
                <span>{item.label}</span>
                <small>{item.summary}</small>
              </button>
            ))}
          </div>

          <button className="agent-button" type="button" onClick={sendToAgent} disabled={status !== "ready"}>
            Ask agent
          </button>
        </div>

        <section className="card brief-card">
          <div className="card-heading">
            <p className="eyebrow">Test Brief · confirm before launch</p>
            <span className={`source-badge ${form.source}`}>
              {extracting ? "extracting…" : form.source === "agent" ? "extracted by agent" : "heuristic"}
              {edited && !extracting ? " · edited" : ""}
            </span>
          </div>
          <p className="rationale">{form.rationale}</p>

          <div className="brief-form">
            <div className="field">
              <label htmlFor="brief-metric">Metric</label>
              <input
                id="brief-metric"
                type="text"
                value={form.metric}
                onChange={(event) => updateForm({ metric: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="brief-type">Type</label>
              <select
                id="brief-type"
                value={form.metricType}
                onChange={(event) => updateForm({ metricType: event.target.value as MetricType })}
              >
                <option value="binary">binary</option>
                <option value="continuous">continuous</option>
                <option value="count">count</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="brief-baseline">Baseline</label>
              <input
                id="brief-baseline"
                type="number"
                step="any"
                value={form.baseline}
                onChange={(event) => updateForm({ baseline: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="brief-mde">MDE</label>
              <input
                id="brief-mde"
                type="number"
                step="any"
                value={form.mde}
                onChange={(event) => updateForm({ mde: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="brief-direction">Direction</label>
              <select
                id="brief-direction"
                value={form.direction}
                onChange={(event) => updateForm({ direction: event.target.value as Direction })}
              >
                <option value="increase">increase</option>
                <option value="decrease">decrease</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="brief-unit">Unit</label>
              <input
                id="brief-unit"
                type="text"
                value={form.unit}
                onChange={(event) => updateForm({ unit: event.target.value })}
              />
            </div>
          </div>

          <div className="metric-grid">
            <Metric label="n / variant" value={design ? design.power.sampleSizePerVariant.toLocaleString() : "—"} />
            <Metric label="Duration" value={design ? `${design.power.durationDays} days` : "—"} />
          </div>

          <div className="row-list">
            <Row label="Variants" value="Control vs treatment, 50/50 player-level randomization" />
            <Row label="Stop rule" value={design ? design.stopConditions.join("; ") : "Fix baseline/MDE to compute the stop rule."} />
            <Row label="Guardrails" value={design ? design.guardrails.join("; ") : "—"} />
          </div>

          <button className="launch-button" type="button" onClick={launch} disabled={launchDisabled}>
            {run.phase === "launching" || run.phase === "preparing" || run.phase === "running"
              ? "Experiment running…"
              : "Launch experiment"}
          </button>
        </section>

        <section className="card readout-card">
          <div className="card-heading">
            <p className="eyebrow">Readout Report · deterministic stats engine (source of truth)</p>
            {readout ? <DecisionBadge decision={readout.recommendation.decision} /> : <span className="phase-badge">{phaseLabel(run.phase)}</span>}
          </div>

          {readout && run.results ? (
            <>
              <p className="rationale">{readout.recommendation.rationale}</p>
              <div className="metric-grid">
                <Metric label="Test picked" value={readout.significance.test.replaceAll("_", " ")} />
                <Metric label="p-value" value={formatPValue(readout.significance.pValue)} />
                <Metric label="Effect" value={formatSignedLevel(readout.significance.effect, run.results.metricType)} />
                <Metric label="95% CI" value={formatCi(readout.significance.ci95, run.results.metricType)} />
              </div>
              <div className="row-list">
                <Row
                  label="Sample"
                  value={`${run.results.variants[0].visitors.toLocaleString()} control / ${run.results.variants[1].visitors.toLocaleString()} treatment`}
                />
                <Row label="Guardrail state" value={readout.guardrails.passed ? "Clean" : "Needs action"} />
                <Row
                  label="Caveats"
                  value={
                    readout.recommendation.caveats.length > 0 ? readout.recommendation.caveats.join("; ") : "None"
                  }
                />
                <Row label="Engine" value={run.engineNote ?? "as configured"} />
              </div>
            </>
          ) : (
            <div className="run-status">
              {run.phase === "idle" && (
                <p className="empty">
                  Confirm the brief on the left, then launch. The experiment runs as an async job — create, poll,
                  readout — against MiroShark when configured, or the deterministic mock engine otherwise.
                </p>
              )}
              {(run.phase === "launching" || run.phase === "preparing") && (
                <p className="empty">Preparing audience… spawning census-grounded personas for both variants.</p>
              )}
              {run.phase === "running" && (
                <p className="empty">
                  Running simulation…
                  {run.progress
                    ? ` ${run.progress.runsDone}/${run.progress.runsTotal} runs done${
                        run.progress.runsActive ? `, ${run.progress.runsActive} active` : ""
                      }.`
                    : ""}
                </p>
              )}
              {run.phase === "failed" && <p className="empty error-text">Experiment failed: {run.error}</p>}
              {run.engineNote && run.phase !== "failed" && (
                <p className="empty engine-note">⚠ {run.engineNote}</p>
              )}
              {(run.phase === "launching" || run.phase === "preparing" || run.phase === "running") && (
                <div className="progress-track" role="progressbar" aria-label="Experiment progress">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${progressPct(run)}%`,
                    }}
                  />
                </div>
              )}
              {run.experimentId && <p className="experiment-id">job: {run.experimentId}</p>}
            </div>
          )}
        </section>
      </section>

      <section className="lower-grid">
        <section className="card">
          <div className="card-heading">
            <p className="eyebrow">Tool Trace</p>
            <strong>Visible orchestration</strong>
          </div>
          <div className="trace-list">
            {toolTrace.map((item) => (
              <details key={item.tool} open={item.tool === "recommend"}>
                <summary>{item.tool}</summary>
                <pre>{JSON.stringify(item.output, null, 2)}</pre>
              </details>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-heading">
            <p className="eyebrow">Agent Stream</p>
            <strong>{status === "ready" ? "Ready" : status}</strong>
          </div>
          <div className="message-list">
            {messages.length === 0 ? (
              <p className="empty">
                Use Ask agent to stream the same workflow through AI SDK tool calls. The agent only
                orchestrates and narrates — every number it shows comes from the same deterministic
                stats tools as the readout above, never from the model.
              </p>
            ) : (
              messages.map((message) => (
                <article key={message.id} className={message.role === "user" ? "message user" : "message assistant"}>
                  <strong>{message.role}</strong>
                  {message.parts.map((part, index) => {
                    if (part.type === "text") return <p key={index}>{part.text}</p>;
                    if (part.type.startsWith("tool-")) {
                      return (
                        <pre key={index} className="tool-call">
                          {part.type}
                          {"\n"}
                          {JSON.stringify(part, null, 2)}
                        </pre>
                      );
                    }
                    return null;
                  })}
                </article>
              ))
            )}
          </div>
        </section>
      </section>

      <style>{styles}</style>
    </main>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function phaseLabel(phase: RunPhase): string {
  if (phase === "idle") return "Awaiting launch";
  if (phase === "launching") return "Creating job";
  if (phase === "preparing") return "Preparing";
  if (phase === "running") return "Running";
  if (phase === "failed") return "Failed";
  return "Complete";
}

function progressPct(run: RunState): number {
  if (run.phase === "launching") return 5;
  if (run.phase === "preparing") return 15;
  if (run.progress && run.progress.runsTotal > 0) {
    return Math.min(95, 20 + (run.progress.runsDone / run.progress.runsTotal) * 75);
  }
  return 50;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

function DecisionBadge({ decision }: { decision: Decision }) {
  return <span className={`decision ${decision}`}>{decision.toUpperCase()}</span>;
}

function formatSignedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}pp`;
}

function formatSignedCurrency(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

// Continuous metrics (ARPU) are dollar amounts; binary/count metrics are rates.
function formatSignedLevel(value: number, metricType: MetricType): string {
  return metricType === "continuous" ? formatSignedCurrency(value) : formatSignedPct(value);
}

function formatPValue(value: number): string {
  return value < 0.001 ? "<0.001" : value.toFixed(3);
}

function formatCi([low, high]: [number, number], metricType: MetricType): string {
  return `${formatSignedLevel(low, metricType)} to ${formatSignedLevel(high, metricType)}`;
}


const styles = `
  :root {
    --paper: #f7f4ea;
    --paper-deep: #efeadb;
    --grass: #e5e8d3;
    --ink: #33302a;
    --ink-soft: #6b6558;
    --ink-faint: #a39c8b;
    --accent-a: #c2452d;
    --accent-b: #1f7a72;
    --card-bg: #fffdf6;
    --shadow: 0 2px 0 rgba(51, 48, 42, 0.18);
    --shadow-card: 0 3px 0 rgba(51, 48, 42, 0.22);
    --hand-font: "Segoe Print", "Comic Sans MS", "Patrick Hand", cursive;
    --body-font: ui-rounded, "Segoe UI", system-ui, sans-serif;
    color: var(--ink);
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    color: var(--ink);
    font-family: var(--body-font);
    background:
      radial-gradient(ellipse at 50% -20%, rgba(255, 255, 255, 0.7), transparent 60%),
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='120' viewBox='0 0 140 120'%3E%3Cg stroke='%23b9bf9a' stroke-width='1.2' fill='none' stroke-linecap='round' opacity='0.55'%3E%3Cpath d='M12 30 q2 -7 4 0'/%3E%3Cpath d='M17 31 q2 -5 4 0'/%3E%3Cpath d='M62 66 q2 -7 4 0'/%3E%3Cpath d='M67 67 q2 -5 4 0'/%3E%3Cpath d='M108 24 q2 -6 4 0'/%3E%3Cpath d='M30 96 q2 -7 4 0'/%3E%3Cpath d='M35 97 q2 -5 4 0'/%3E%3Cpath d='M96 104 q2 -6 4 0'/%3E%3Cpath d='M126 74 q2 -7 4 0'/%3E%3Cpath d='M84 40 q2 -5 4 0'/%3E%3C/g%3E%3C/svg%3E"),
      var(--paper);
  }

  .shell {
    max-width: 1240px;
    margin: 0 auto;
    padding: 26px 22px 56px;
  }

  /* intro */
  .intro {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 24px;
    align-items: end;
    padding: 18px 0 24px;
    border-bottom: 2px dashed var(--ink-faint);
  }

  .eyebrow {
    margin: 0 0 8px;
    font-family: var(--hand-font);
    color: var(--ink-soft);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .intro h1 {
    margin: 0;
    font-family: var(--hand-font);
    font-size: clamp(26px, 3.6vw, 44px);
    font-weight: 700;
    line-height: 1.12;
    color: var(--ink);
  }

  .world-link {
    display: inline-block;
    margin-top: 12px;
    font-family: var(--hand-font);
    color: var(--accent-a);
    font-size: 15px;
    font-weight: 700;
    text-decoration: none;
    border-bottom: 2px dashed var(--accent-a);
    transition: transform 0.1s ease;
  }

  .world-link:hover { transform: translateY(-1px) rotate(-0.5deg); }

  .brief-note {
    margin: 0;
    color: var(--ink-soft);
    font-size: 14.5px;
    line-height: 1.55;
  }

  /* layout */
  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.05fr) minmax(0, 1.15fr);
    gap: 18px;
    padding-top: 22px;
  }

  .lower-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 18px;
    margin-top: 18px;
  }

  /* cards */
  .card,
  .control-panel {
    background: var(--card-bg);
    border: 2px solid var(--ink);
    border-radius: 14px 18px 15px 13px / 15px 13px 18px 16px;
    box-shadow: var(--shadow-card);
    padding: 16px 18px;
  }

  .card-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .card-heading .eyebrow { margin: 0; }
  .card-heading strong { font-family: var(--hand-font); font-size: 15px; }

  .rationale {
    margin: 0 0 12px;
    color: var(--ink-soft);
    font-size: 13.5px;
    line-height: 1.5;
  }

  /* control panel */
  .control-panel { display: flex; flex-direction: column; gap: 10px; }

  .control-panel label {
    font-family: var(--hand-font);
    font-weight: 700;
    font-size: 14px;
  }

  .control-panel textarea {
    width: 100%;
    resize: vertical;
    font-family: var(--body-font);
    font-size: 14px;
    line-height: 1.5;
    color: var(--ink);
    background: var(--paper);
    border: 2px solid var(--ink-faint);
    border-radius: 10px 13px 11px 10px / 11px 10px 13px 11px;
    padding: 10px 12px;
  }

  .control-panel textarea:focus-visible,
  .field input:focus-visible,
  .field select:focus-visible {
    outline: none;
    border-color: var(--ink);
  }

  .scenario-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 7px;
  }

  .scenario {
    text-align: left;
    background: var(--paper);
    border: 2px solid var(--ink-faint);
    border-radius: 10px 13px 11px 10px / 11px 10px 13px 11px;
    padding: 7px 12px;
    cursor: pointer;
    box-shadow: var(--shadow);
    transition: transform 0.1s ease;
  }

  .scenario:hover { transform: translateY(-1px) rotate(-0.3deg); }

  .scenario.active {
    border-color: var(--ink);
    background: var(--grass);
  }

  .scenario span {
    display: block;
    font-family: var(--hand-font);
    font-weight: 700;
    font-size: 13.5px;
    color: var(--ink);
  }

  .scenario small {
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 1.35;
  }

  .agent-button,
  .launch-button {
    font-family: var(--hand-font);
    font-size: 15px;
    font-weight: 700;
    color: var(--paper);
    background: var(--ink);
    border: 2px solid var(--ink);
    border-radius: 11px 14px 12px 11px / 12px 11px 14px 12px;
    padding: 9px 18px;
    cursor: pointer;
    box-shadow: var(--shadow);
    transition: transform 0.1s ease;
  }

  .launch-button {
    width: 100%;
    margin-top: 12px;
    background: var(--accent-a);
    border-color: var(--accent-a);
  }

  .agent-button:hover:not(:disabled),
  .launch-button:hover:not(:disabled) { transform: translateY(-1px) rotate(-0.5deg); }

  .agent-button:active:not(:disabled),
  .launch-button:active:not(:disabled) { transform: translateY(1px); }

  .agent-button:disabled,
  .launch-button:disabled { opacity: 0.45; cursor: default; }

  /* brief form */
  .brief-form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 12px;
    margin-bottom: 12px;
  }

  .field { display: flex; flex-direction: column; gap: 4px; }

  .field label {
    font-family: var(--hand-font);
    font-size: 12px;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .field input,
  .field select {
    font-family: var(--body-font);
    font-size: 13.5px;
    color: var(--ink);
    background: var(--paper);
    border: 2px solid var(--ink-faint);
    border-radius: 9px 12px 10px 9px / 10px 9px 12px 10px;
    padding: 7px 10px;
  }

  .source-badge {
    font-family: var(--hand-font);
    font-size: 11.5px;
    font-weight: 700;
    white-space: nowrap;
    padding: 2px 10px;
    border: 2px solid var(--ink);
    border-radius: 999px;
    background: var(--paper);
    transform: rotate(-1.5deg);
  }

  .source-badge.agent { background: var(--grass); }
  .source-badge.heuristic { background: var(--paper-deep); }

  /* metrics & rows */
  .metric-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 9px;
    margin-bottom: 12px;
  }

  .metric {
    background: var(--paper);
    border: 1.5px solid var(--ink-faint);
    border-radius: 10px 13px 11px 10px / 11px 10px 13px 11px;
    padding: 8px 11px;
  }

  .metric span {
    display: block;
    font-family: var(--hand-font);
    font-size: 11px;
    font-weight: 700;
    color: var(--ink-soft);
    margin-bottom: 2px;
  }

  .metric strong {
    font-size: 16.5px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .row-list { display: flex; flex-direction: column; gap: 7px; }

  .row {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 10px;
    align-items: baseline;
    border-top: 1.5px dashed var(--paper-deep);
    padding-top: 7px;
  }

  .row span {
    font-family: var(--hand-font);
    font-size: 11.5px;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .row p { margin: 0; font-size: 13px; line-height: 1.45; }

  /* decision & phase badges */
  .decision {
    font-family: var(--hand-font);
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 2px 14px;
    border: 2.5px solid;
    border-radius: 10px 14px 11px 10px / 11px 10px 14px 11px;
    display: inline-block;
    transform: rotate(-2deg);
    background: var(--card-bg);
  }

  .decision.ship { color: #276a45; border-color: #276a45; }
  .decision.iterate { color: #9a6a1a; border-color: #9a6a1a; }
  .decision.kill { color: var(--accent-a); border-color: var(--accent-a); }

  .phase-badge {
    font-family: var(--hand-font);
    font-size: 12px;
    font-weight: 700;
    color: var(--ink-soft);
    border: 2px solid var(--ink-faint);
    border-radius: 999px;
    padding: 2px 12px;
    background: var(--paper);
    white-space: nowrap;
  }

  /* run status */
  .run-status { display: flex; flex-direction: column; gap: 10px; }

  .empty {
    margin: 0;
    color: var(--ink-soft);
    font-size: 13.5px;
    line-height: 1.55;
  }

  .error-text { color: var(--accent-a); font-weight: 600; }

  .engine-note {
    font-family: var(--hand-font);
    color: #9a6a1a;
    font-weight: 700;
  }

  .experiment-id {
    font-family: ui-monospace, "Cascadia Code", monospace;
    font-size: 11.5px;
    color: var(--ink-faint);
  }

  .progress-track {
    height: 14px;
    border: 2px solid var(--ink);
    border-radius: 999px;
    background: var(--paper);
    overflow: hidden;
    box-shadow: var(--shadow);
  }

  .progress-fill {
    height: 100%;
    background: repeating-linear-gradient(
      -45deg,
      var(--accent-b),
      var(--accent-b) 8px,
      #2c948a 8px,
      #2c948a 16px
    );
    border-radius: 999px;
    transition: width 0.5s ease;
  }

  /* tool trace */
  .trace-list { display: flex; flex-direction: column; gap: 8px; }

  .tool-call {
    border: 1.5px solid var(--ink-faint);
    border-radius: 10px 13px 11px 10px / 11px 10px 13px 11px;
    background: var(--paper);
    padding: 6px 10px;
  }

  .tool-call summary {
    font-family: var(--hand-font);
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
  }

  .tool-call pre {
    margin: 8px 0 4px;
    padding: 10px;
    font-size: 11.5px;
    line-height: 1.5;
    overflow-x: auto;
    color: var(--ink);
    background: var(--paper-deep);
    border-radius: 8px;
  }

  /* agent stream */
  .message-list { display: flex; flex-direction: column; gap: 9px; }

  .message {
    border: 1.5px solid var(--ink-faint);
    border-radius: 12px 15px 13px 11px / 13px 11px 15px 12px;
    background: var(--paper);
    padding: 9px 12px;
    font-size: 13.5px;
    line-height: 1.55;
  }

  .message.user {
    background: var(--grass);
    border-color: var(--ink-soft);
  }

  .message.assistant { background: var(--card-bg); }

  /* responsive */
  @media (max-width: 1080px) {
    .workspace { grid-template-columns: 1fr; }
    .lower-grid { grid-template-columns: 1fr; }
    .intro { grid-template-columns: 1fr; }
  }

  @media (max-width: 720px) {
    .shell { padding: 18px 14px 40px; }
    .metric-grid { grid-template-columns: 1fr; }
    .brief-form { grid-template-columns: 1fr; }
  }
`;
