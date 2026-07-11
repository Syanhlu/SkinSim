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
      const created = (await createRes.json()) as ExperimentJob & { error?: { message?: string } };
      if (!createRes.ok) throw new Error(created.error?.message ?? `Create failed (HTTP ${createRes.status}).`);
      let job: ExperimentJob = created;
      if (runToken.current !== token) return;
      setRun({ phase: job.status === "running" ? "running" : "preparing", experimentId: job.experimentId, progress: job.progress });

      for (let poll = 0; poll < 60 && job.status !== "complete" && job.status !== "failed"; poll += 1) {
        await sleep(650);
        const statusRes = await fetch(`/api/experiment?id=${encodeURIComponent(job.experimentId)}`);
        const statusBody = (await statusRes.json()) as ExperimentJob & { error?: { message?: string } };
        if (!statusRes.ok) throw new Error(statusBody.error?.message ?? `Status failed (HTTP ${statusRes.status}).`);
        job = statusBody;
        if (runToken.current !== token) return;
        setRun({
          phase: job.status === "preparing" ? "preparing" : job.status === "complete" ? "running" : "running",
          experimentId: job.experimentId,
          progress: job.progress,
        });
      }

      if (job.status !== "complete") {
        throw new Error(job.error || `Experiment ended as ${job.status}.`);
      }

      const resultsRes = await fetch(`/api/experiment?id=${encodeURIComponent(job.experimentId)}&results=1`);
      const resultsBody = (await resultsRes.json()) as { results?: ExperimentResults; error?: { message?: string } };
      if (!resultsRes.ok || !resultsBody.results) {
        throw new Error(resultsBody.error?.message ?? `Results failed (HTTP ${resultsRes.status}).`);
      }
      // MiroShark leaves requiredSampleSizePerVariant at 0 — fill it from our power analysis.
      const results: ExperimentResults = resultsBody.results.requiredSampleSizePerVariant
        ? resultsBody.results
        : { ...resultsBody.results, requiredSampleSizePerVariant: design.power.sampleSizePerVariant };
      if (runToken.current !== token) return;
      setRun({ phase: "complete", experimentId: job.experimentId, progress: job.progress, results });
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
    color: #161616;
    background: #f3f1ec;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background:
      linear-gradient(180deg, rgba(255,255,255,0.72), rgba(255,255,255,0)),
      #f3f1ec;
  }

  button,
  textarea,
  input,
  select {
    font: inherit;
  }

  .shell {
    width: min(1180px, calc(100vw - 32px));
    margin: 0 auto;
    padding: 28px 0 40px;
  }

  .intro {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 420px);
    gap: 28px;
    align-items: end;
    padding: 22px 0 26px;
    border-bottom: 1px solid #d8d3c8;
  }

  .eyebrow {
    margin: 0 0 8px;
    color: #6d6659;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .world-link {
    display: inline-block;
    margin-top: 10px;
    color: #8a4b2d;
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    border-bottom: 1px dashed #8a4b2d;
  }

  .world-link:hover {
    color: #5f3420;
  }

  h1 {
    max-width: 760px;
    margin: 0;
    font-size: 64px;
    line-height: 0.95;
    letter-spacing: 0;
  }

  .brief-note,
  .rationale,
  .empty {
    margin: 0;
    color: #5c564c;
    font-size: 15px;
    line-height: 1.55;
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(300px, 0.8fr) minmax(310px, 1fr) minmax(310px, 1fr);
    gap: 16px;
    margin-top: 18px;
    align-items: stretch;
  }

  .lower-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 16px;
  }

  .control-panel,
  .card {
    background: rgba(255, 255, 255, 0.88);
    border: 1px solid #d8d3c8;
    border-radius: 8px;
    box-shadow: 0 16px 40px rgba(57, 48, 35, 0.08);
  }

  .control-panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
  }

  .control-panel label {
    color: #3a352e;
    font-size: 13px;
    font-weight: 700;
  }

  textarea {
    width: 100%;
    min-height: 132px;
    resize: vertical;
    border: 1px solid #bfb7a8;
    border-radius: 6px;
    padding: 12px;
    color: #181714;
    background: #fffdf8;
    line-height: 1.45;
  }

  .scenario-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .scenario,
  .agent-button {
    border: 1px solid #c7c0b3;
    border-radius: 6px;
    background: #fbfaf7;
    color: #20201d;
    cursor: pointer;
    text-align: left;
  }

  .scenario {
    display: grid;
    gap: 3px;
    padding: 10px;
  }

  .scenario span {
    font-weight: 800;
  }

  .scenario small {
    color: #6c665d;
    line-height: 1.35;
  }

  .scenario.active {
    border-color: #1d5f75;
    background: #e7f4f6;
  }

  .agent-button {
    min-height: 44px;
    padding: 0 14px;
    background: #181714;
    color: #fffaf0;
    font-weight: 800;
    text-align: center;
  }

  .agent-button:disabled {
    cursor: wait;
    opacity: 0.6;
  }

  .card {
    padding: 16px;
  }

  .card-heading {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
    margin-bottom: 12px;
  }

  .card-heading strong {
    font-size: 17px;
    text-align: right;
  }

  .source-badge {
    border: 1px solid #c7c0b3;
    border-radius: 999px;
    padding: 6px 10px;
    background: #fbfaf7;
    color: #4c463c;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .source-badge.agent {
    border-color: #1d5f75;
    background: #e7f4f6;
    color: #14505f;
  }

  .phase-badge {
    border-radius: 999px;
    padding: 7px 10px;
    background: #eee9dd;
    color: #5c564c;
    font-size: 12px;
    font-weight: 900;
    text-align: center;
    white-space: nowrap;
  }

  .brief-form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin: 14px 0 2px;
  }

  .brief-form .field {
    display: grid;
    gap: 4px;
  }

  .brief-form label {
    color: #766f63;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .brief-form input,
  .brief-form select {
    width: 100%;
    border: 1px solid #bfb7a8;
    border-radius: 6px;
    padding: 8px 10px;
    color: #181714;
    background: #fffdf8;
  }

  .launch-button {
    width: 100%;
    min-height: 44px;
    margin-top: 14px;
    border: 1px solid #14505f;
    border-radius: 6px;
    padding: 0 14px;
    background: #1d5f75;
    color: #f2fbfd;
    font-weight: 800;
    cursor: pointer;
  }

  .launch-button:disabled {
    cursor: wait;
    opacity: 0.55;
  }

  .run-status {
    display: grid;
    gap: 12px;
  }

  .error-text {
    color: #8a2a24;
  }

  .experiment-id {
    margin: 0;
    color: #918a7c;
    font-size: 12px;
  }

  .progress-track {
    height: 8px;
    border: 1px solid #d8d3c8;
    border-radius: 999px;
    background: #efece4;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #1d5f75;
    border-radius: 999px;
    transition: width 0.5s ease;
  }

  .metric-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin: 16px 0;
  }

  .metric {
    min-height: 72px;
    border: 1px solid #e0dbd0;
    border-radius: 6px;
    padding: 10px;
    background: #fffdf8;
  }

  .metric span,
  .row span {
    display: block;
    color: #766f63;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .metric strong {
    display: block;
    margin-top: 10px;
    font-size: 20px;
    letter-spacing: 0;
  }

  .row-list {
    display: grid;
    gap: 10px;
  }

  .row {
    border-top: 1px solid #e5dfd5;
    padding-top: 10px;
  }

  .row p {
    margin: 4px 0 0;
    color: #342f29;
    font-size: 14px;
    line-height: 1.45;
  }

  .decision {
    min-width: 76px;
    border-radius: 999px;
    padding: 7px 10px;
    font-size: 12px;
    font-weight: 900;
    text-align: center;
  }

  .decision.ship {
    color: #0f3f2b;
    background: #bfe8d1;
  }

  .decision.iterate {
    color: #644200;
    background: #ffe0a3;
  }

  .decision.kill {
    color: #621a1a;
    background: #f6b8b5;
  }

  .trace-list,
  .message-list {
    display: grid;
    gap: 10px;
    max-height: 520px;
    overflow: auto;
    padding-right: 4px;
  }

  details {
    border: 1px solid #e0dbd0;
    border-radius: 6px;
    background: #fffdf8;
  }

  summary {
    cursor: pointer;
    padding: 10px 12px;
    font-weight: 800;
  }

  pre {
    overflow: auto;
    margin: 0;
    padding: 12px;
    background: #111210;
    color: #baf7c2;
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-wrap;
  }

  .message {
    border: 1px solid #e0dbd0;
    border-radius: 6px;
    padding: 12px;
    background: #fffdf8;
  }

  .message.user {
    background: #eef5f7;
  }

  .message strong {
    display: block;
    margin-bottom: 6px;
    color: #6d6659;
    font-size: 12px;
    text-transform: uppercase;
  }

  .message p {
    margin: 0;
    line-height: 1.5;
  }

  .tool-call {
    border-radius: 6px;
  }

  @media (max-width: 980px) {
    .intro,
    .workspace,
    .lower-grid {
      grid-template-columns: 1fr;
    }

    .card-heading strong {
      text-align: left;
    }
  }

  @media (max-width: 560px) {
    .shell {
      width: min(100vw - 20px, 1180px);
      padding-top: 16px;
    }

    h1 {
      font-size: 38px;
    }

    .metric-grid,
    .brief-form {
      grid-template-columns: 1fr;
    }
  }
`;
