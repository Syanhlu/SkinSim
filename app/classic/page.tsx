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
import type { SimUrlDoc } from "@/lib/miroshark/client";
import type { ExperimentJob, ExperimentProgress } from "@/lib/sim-client";
import { significanceTest, type ExperimentResults, type MetricType } from "@/lib/stats";
import { buildVerdictReport, downloadReport, reportFilename } from "@/lib/report-export";

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
  // The live engine runs a real multi-hour, paid simulation. It is an explicit
  // opt-in with its own market-context field; the default is the instant preview.
  const [liveEngine, setLiveEngine] = useState(false);
  const [scenarioText, setScenarioText] = useState("");
  const [scrapeQuery, setScrapeQuery] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeDocs, setScrapeDocs] = useState<SimUrlDoc[]>([]);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
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
    const useLive = liveEngine && scenarioText.trim().length > 0;
    runToken.current += 1;
    const token = runToken.current;
    setRun({ phase: "launching" });

    try {
      const createRes = await fetch(useLive ? "/api/experiment" : "/api/experiment?sim=mock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hypothesis,
          variants: [
            { name: "control", text: "Current LiveOps experience." },
            { name: "treatment", text: hypothesis },
          ],
          scenario: useLive ? scenarioText.trim() : undefined,
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
      // The proxy falls back to the preview engine when the live engine is
      // unreachable; keep polling the same engine and tell the operator.
      const simParam = !useLive || created.engine === "mock" ? "&sim=mock" : "";
      const engineNote =
        created.engineNote ?? (useLive ? "live simulation engine" : "instant simulated preview");
      if (runToken.current !== token) return;
      setRun({ phase: job.status === "running" ? "running" : "preparing", experimentId: job.experimentId, progress: job.progress, engineNote });

      // Preview completes in seconds; a live run takes an hour or more, so poll
      // gently and never fake a failure just because the tab got bored.
      const pollDelay = useLive && !simParam ? 5000 : 650;
      const maxPolls = useLive && !simParam ? 1440 : 60;
      for (let poll = 0; poll < maxPolls && job.status !== "complete" && job.status !== "failed"; poll += 1) {
        await sleep(pollDelay);
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
        if (job.status === "failed") {
          throw new Error(job.error || "The engine reported a failure.");
        }
        // Still running after the polling window (live runs are long). Leave the
        // job visible instead of pretending it failed.
        setRun({
          phase: "running",
          experimentId: job.experimentId,
          progress: job.progress,
          engineNote: "Still running on the live engine. Keep this tab open, or note the job id and check back.",
        });
        return;
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

  const runScrape = async () => {
    const query = scrapeQuery.trim() || hypothesis.trim();
    if (!query) return;
    setScraping(true);
    setScrapeError(null);
    try {
      const res = await fetch("/api/experiment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "scrape", searchQuery: query }),
      });
      const body = (await res.json()) as { docs?: SimUrlDoc[]; error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `Research failed (HTTP ${res.status}).`);
      const docs = body.docs ?? [];
      setScrapeDocs(docs);
      if (docs.length === 0) {
        setScrapeError("No sources found. Try a different query, or add market context manually.");
        return;
      }
      const researched = docs.map((doc) => `Source: ${doc.title} (${doc.url})\n${doc.text}`).join("\n\n");
      setScenarioText((prev) => (prev.trim() ? `${prev.trim()}\n\n${researched}` : researched));
    } catch (error) {
      setScrapeError(error instanceof Error ? error.message : "Research failed.");
    } finally {
      setScraping(false);
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

  const launchDisabled =
    !design ||
    extracting ||
    (liveEngine && scenarioText.trim().length === 0) ||
    run.phase === "launching" ||
    run.phase === "preparing" ||
    run.phase === "running";

  return (
    <main className="shell">
      <section className="intro">
        <div>
          <p className="eyebrow">Agamotto</p>
          <h1>Know which idea wins before you spend real money.</h1>
          <a className="world-link" href="/world?mode=replay&demo=kfc">
            Watch a simulated Vietnamese crowd react live →
          </a>
        </div>
        <p className="brief-note">
          Describe what you want to test. We build the test for you, show it to a simulated
          audience of realistic Vietnamese consumers, and give you a clear answer:
          <strong> ship it, improve it, or drop it</strong>, backed by real statistics.
        </p>
      </section>

      <section className="workspace">
        <div className="control-panel">
          <label htmlFor="hypothesis">What do you want to test?</label>
          <textarea
            id="hypothesis"
            value={hypothesis}
            onChange={(event) => setHypothesis(event.target.value)}
            rows={5}
          />

          <label className="group-label">Try a sample outcome</label>
          <div className="scenario-grid" aria-label="Sample outcome presets">
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
            Ask the AI assistant
          </button>
        </div>

        <section className="card brief-card">
          <div className="card-heading">
            <p className="eyebrow">Your test plan</p>
            <span className={`source-badge ${form.source}`}>
              {extracting ? "filling in…" : form.source === "agent" ? "filled in by AI" : "auto-filled"}
              {edited && !extracting ? " · edited by you" : ""}
            </span>
          </div>
          <p className="rationale">{form.rationale}</p>

          <div className="brief-form">
            <div className="field">
              <label htmlFor="brief-metric">What we measure</label>
              <input
                id="brief-metric"
                type="text"
                value={form.metric}
                onChange={(event) => updateForm({ metric: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="brief-direction">We want it to</label>
              <select
                id="brief-direction"
                value={form.direction}
                onChange={(event) => updateForm({ direction: event.target.value as Direction })}
              >
                <option value="increase">go up</option>
                <option value="decrease">go down</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="brief-baseline">Where it is today</label>
              <input
                id="brief-baseline"
                type="number"
                step="any"
                value={form.baseline}
                onChange={(event) => updateForm({ baseline: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="brief-mde">Smallest change that matters</label>
              <input
                id="brief-mde"
                type="number"
                step="any"
                value={form.mde}
                onChange={(event) => updateForm({ mde: event.target.value })}
              />
            </div>
          </div>

          <details className="advanced">
            <summary>Advanced settings</summary>
            <div className="brief-form">
              <div className="field">
                <label htmlFor="brief-type">Metric type</label>
                <select
                  id="brief-type"
                  value={form.metricType}
                  onChange={(event) => updateForm({ metricType: event.target.value as MetricType })}
                >
                  <option value="binary">binary (yes/no)</option>
                  <option value="continuous">continuous (amounts)</option>
                  <option value="count">count (events)</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="brief-unit">Measured per</label>
                <input
                  id="brief-unit"
                  type="text"
                  value={form.unit}
                  onChange={(event) => updateForm({ unit: event.target.value })}
                />
              </div>
            </div>
            <label className="live-toggle">
              <input
                type="checkbox"
                checked={liveEngine}
                onChange={(event) => setLiveEngine(event.target.checked)}
              />
              <span>
                <strong>Run on the live engine</strong>
                <small>
                  Simulates a real crowd with AI agents. Costs real API money and takes an hour
                  or more. Off by default: the instant preview uses canned data and is free.
                </small>
              </span>
            </label>
            {liveEngine && (
              <div className="field">
                <label htmlFor="live-scenario">Market context (required for live runs)</label>
                <div className="scrape-row">
                  <input
                    id="scrape-query"
                    type="text"
                    value={scrapeQuery}
                    onChange={(event) => setScrapeQuery(event.target.value)}
                    placeholder="Search the web for market context (defaults to your hypothesis)"
                  />
                  <button type="button" className="scrape-button" onClick={runScrape} disabled={scraping}>
                    {scraping ? "Researching…" : "Research the web"}
                  </button>
                </div>
                {scrapeError && <p className="hint error">{scrapeError}</p>}
                {scrapeDocs.length > 0 && (
                  <ul className="scrape-sources">
                    {scrapeDocs.map((doc) => (
                      <li key={doc.url}>
                        <a href={doc.url} target="_blank" rel="noreferrer">
                          {doc.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                <textarea
                  id="live-scenario"
                  rows={4}
                  value={scenarioText}
                  onChange={(event) => setScenarioText(event.target.value)}
                  placeholder="Describe the market: product, competitors, audience segments, current mood. The richer this is, the more the simulated crowd disagrees like a real one."
                />
              </div>
            )}
          </details>

          <div className="metric-grid">
            <Metric label="People per version" value={design ? design.power.sampleSizePerVariant.toLocaleString() : "—"} />
            <Metric label="Days to run" value={design ? `${design.power.durationDays} days` : "—"} />
          </div>

          <div className="row-list">
            <Row label="Versions" value="Two versions, each shown to half the audience, split fairly" />
            <Row label="When we stop" value={design ? design.stopConditions.join("; ") : "Fill in the two numbers above to compute this."} />
            <Row label="Safety checks" value={design ? design.guardrails.join("; ") : "—"} />
          </div>

          <button className="launch-button" type="button" onClick={launch} disabled={launchDisabled}>
            {run.phase === "launching" || run.phase === "preparing" || run.phase === "running"
              ? "Test running…"
              : liveEngine
                ? "Run the deep simulation"
                : "Run the test"}
          </button>
          {liveEngine && scenarioText.trim().length === 0 && (
            <p className="hint">Add the market context above to enable the live run.</p>
          )}
        </section>

        <section className="card readout-card">
          <div className="card-heading">
            <p className="eyebrow">Result</p>
            {readout ? <DecisionBadge decision={readout.recommendation.decision} /> : <span className="phase-badge">{phaseLabel(run.phase)}</span>}
          </div>

          {readout && run.results ? (
            <>
              <p className="rationale">{readout.recommendation.rationale}</p>
              <div className="metric-grid">
                <Metric label="Change we saw" value={formatSignedLevel(readout.significance.effect, run.results.metricType)} />
                <Metric label="Chance it's just luck" value={formatPValue(readout.significance.pValue)} />
                <Metric label="Likely true range" value={formatCi(readout.significance.ci95, run.results.metricType)} />
                <Metric
                  label="People tested"
                  value={(run.results.variants[0].visitors + run.results.variants[1].visitors).toLocaleString()}
                />
              </div>
              <div className="row-list">
                <Row label="Safety checks" value={readout.guardrails.passed ? "All clear" : "Something needs attention"} />
                <Row
                  label="Watch-outs"
                  value={
                    readout.recommendation.caveats.length > 0 ? readout.recommendation.caveats.join("; ") : "None"
                  }
                />
                <Row label="Method" value={readout.significance.test.replaceAll("_", " ")} />
                <Row label="Data source" value={run.engineNote ?? "simulation engine"} />
              </div>
              <button
                type="button"
                className="export-report-button"
                onClick={() => {
                  const markdown = buildVerdictReport({
                    title: `Agamotto experiment report — ${run.results!.metric}`,
                    results: run.results!,
                    significance: readout.significance,
                    recommendation: readout.recommendation,
                    guardrails: readout.guardrails,
                    context: [
                      ["Hypothesis", hypothesis.trim() || "—"],
                      ["Data source", run.engineNote ?? "simulation engine"],
                    ],
                  });
                  downloadReport(reportFilename("agamotto-report"), markdown);
                }}
              >
                ⬇ Export report
              </button>
            </>
          ) : (
            <div className="run-status">
              {run.phase === "idle" && (
                <p className="empty">
                  Check your test plan on the left, then press <strong>Run the test</strong>. You&apos;ll
                  watch it go from preparing to done right here.
                </p>
              )}
              {(run.phase === "launching" || run.phase === "preparing") && (
                <p className="empty">Creating your simulated audience…</p>
              )}
              {run.phase === "running" && (
                <p className="empty">
                  The crowd is reacting…
                  {run.progress
                    ? ` ${run.progress.runsDone} of ${run.progress.runsTotal} rounds finished.`
                    : ""}
                </p>
              )}
              {run.phase === "failed" && <p className="empty error-text">The test hit a problem: {run.error}</p>}
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

      <details className="under-hood">
        <summary>Under the hood: how every number was computed (for the curious)</summary>
        <section className="lower-grid">
        <section className="card">
          <div className="card-heading">
            <p className="eyebrow">Calculation trace</p>
            <strong>Every number, shown working</strong>
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
            <p className="eyebrow">AI assistant</p>
            <strong>{status === "ready" ? "Ready" : status}</strong>
          </div>
          <div className="message-list">
            {messages.length === 0 ? (
              <p className="empty">
                Press &quot;Ask the AI assistant&quot; to have the AI walk through the same test and
                narrate it. It never does the math itself; every number comes from the same
                statistics engine as the result card.
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
      </details>

      <style>{styles}</style>
    </main>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function phaseLabel(phase: RunPhase): string {
  if (phase === "idle") return "Ready when you are";
  if (phase === "launching") return "Starting…";
  if (phase === "preparing") return "Preparing audience";
  if (phase === "running") return "Crowd reacting";
  if (phase === "failed") return "Hit a problem";
  return "Done";
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
    --vng-orange: #f1592a;
    --vng-orange-deep: #d64a1f;
    --vng-orange-tint: #fef0ea;
    --ink: #2b2a33;
    --ink-soft: #6b6b76;
    --ink-faint: #9d9da8;
    --line: #e7e7ec;
    --card-bg: #ffffff;
    --page-bg: #ffffff;
    --wash: #f7f7f9;
    --good: #1d7a46;
    --warn: #a06a12;
    --bad: #c0392b;
    --radius: 16px;
    --radius-sm: 10px;
    --shadow-card: 0 2px 10px rgba(43, 42, 51, 0.06);
    color: var(--ink);
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    color: var(--ink);
    font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif;
    background: var(--page-bg);
  }

  .shell {
    max-width: 1240px;
    margin: 0 auto;
    padding: 30px 24px 64px;
  }

  /* intro */
  .intro {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 28px;
    align-items: end;
    padding: 26px 0 30px;
    border-bottom: 1px solid var(--line);
  }

  .intro::before {
    content: "";
    position: absolute;
    right: -120px;
    top: -90px;
    width: 300px;
    height: 150px;
    border-radius: 50%;
    border: 2px solid var(--vng-orange-tint);
    border-top-color: transparent;
    border-left-color: transparent;
    transform: rotate(-14deg);
    pointer-events: none;
  }

  .intro > * { position: relative; z-index: 1; }

  .eyebrow {
    margin: 0 0 10px;
    color: var(--vng-orange);
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  .intro h1 {
    margin: 0;
    font-size: clamp(26px, 3.4vw, 42px);
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: -0.01em;
    color: var(--ink);
  }

  .world-link {
    display: inline-block;
    margin-top: 14px;
    color: var(--vng-orange);
    font-size: 15px;
    font-weight: 600;
    text-decoration: none;
  }

  .world-link:hover { color: var(--vng-orange-deep); text-decoration: underline; }

  .brief-note {
    margin: 0;
    color: var(--ink-soft);
    font-size: 15px;
    line-height: 1.6;
  }

  .brief-note strong { color: var(--ink); }

  /* layout */
  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.05fr) minmax(0, 1.15fr);
    gap: 20px;
    padding-top: 26px;
  }

  /* Three columns need real room. Collapse early rather than squeeze. */
  @media (max-width: 1280px) {
    .workspace { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .workspace .readout-card { grid-column: 1 / -1; }
  }

  .lower-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 20px;
    margin-top: 14px;
  }

  /* cards */
  .card,
  .control-panel {
    background: var(--card-bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow-card);
    padding: 24px;
  }

  .card-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .card-heading .eyebrow { margin: 0; font-size: 15px; }
  .card-heading strong { font-size: 13px; color: var(--ink-soft); font-weight: 600; }

  .rationale {
    margin: 0 0 14px;
    color: var(--ink-soft);
    font-size: 13.5px;
    line-height: 1.55;
  }

  /* control panel */
  .control-panel { display: flex; flex-direction: column; gap: 12px; }

  .control-panel label {
    font-weight: 600;
    font-size: 14px;
    color: var(--ink);
  }

  .control-panel .group-label {
    margin-top: 4px;
    font-size: 13px;
    color: var(--ink-soft);
    font-weight: 600;
  }

  .control-panel textarea {
    width: 100%;
    resize: vertical;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.55;
    color: var(--ink);
    background: var(--wash);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 11px 13px;
  }

  .control-panel textarea:focus-visible,
  .field input:focus-visible,
  .field select:focus-visible {
    outline: none;
    border-color: var(--vng-orange);
    box-shadow: 0 0 0 3px var(--vng-orange-tint);
  }

  .scenario-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .scenario {
    text-align: left;
    font-family: inherit;
    background: var(--card-bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 8px 13px;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .scenario:hover { border-color: var(--vng-orange); }

  .scenario.active {
    border-color: var(--vng-orange);
    background: var(--vng-orange-tint);
  }

  .scenario span {
    display: block;
    font-weight: 600;
    font-size: 13.5px;
    color: var(--ink);
  }

  .scenario.active span { color: var(--vng-orange-deep); }

  .scenario small {
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 1.4;
  }

  .agent-button,
  .launch-button {
    font-family: inherit;
    font-size: 15px;
    font-weight: 600;
    color: #fff;
    background: var(--ink);
    border: none;
    border-radius: 999px;
    padding: 11px 20px;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.1s ease;
  }

  .launch-button {
    width: 100%;
    margin-top: 14px;
    background: var(--vng-orange);
  }

  .agent-button:hover:not(:disabled) { background: #17171c; }
  .launch-button:hover:not(:disabled) { background: var(--vng-orange-deep); }

  .agent-button:active:not(:disabled),
  .launch-button:active:not(:disabled) { transform: translateY(1px); }

  .agent-button:disabled,
  .launch-button:disabled { opacity: 0.45; cursor: default; }

  .export-report-button {
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    background: transparent;
    border: 1.5px solid var(--ink);
    border-radius: 999px;
    padding: 8px 16px;
    margin-top: 12px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
  }
  .export-report-button:hover { background: var(--ink); color: #fff; }
  .export-report-button:active { transform: translateY(1px); }

  /* brief form */
  .brief-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 14px 16px;
    margin-bottom: 14px;
  }

  .field { display: flex; flex-direction: column; gap: 5px; }

  .field label {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-soft);
  }

  .field input,
  .field select {
    font-family: inherit;
    font-size: 14px;
    color: var(--ink);
    background: var(--wash);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 8px 11px;
  }

  .advanced { margin-bottom: 12px; }

  .advanced summary {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-faint);
    cursor: pointer;
    padding: 2px 0 8px;
  }

  .advanced summary:hover { color: var(--vng-orange); }

  .live-toggle {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    background: var(--wash);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 11px 13px;
    margin: 10px 0 12px;
    cursor: pointer;
  }

  .live-toggle input {
    margin-top: 3px;
    accent-color: var(--vng-orange);
    width: 15px;
    height: 15px;
    flex: none;
  }

  .live-toggle strong { display: block; font-size: 13.5px; }

  .live-toggle small {
    display: block;
    margin-top: 3px;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 1.5;
  }

  .field textarea {
    font-family: inherit;
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--ink);
    background: var(--wash);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 9px 11px;
    resize: vertical;
  }

  .field textarea:focus-visible {
    outline: none;
    border-color: var(--vng-orange);
    box-shadow: 0 0 0 3px var(--vng-orange-tint);
  }

  .hint {
    margin: 8px 0 0;
    font-size: 12.5px;
    color: var(--ink-faint);
    text-align: center;
  }

  .hint.error {
    color: var(--vng-orange-deep);
    text-align: left;
  }

  .scrape-row {
    display: flex;
    gap: 8px;
  }

  .scrape-row input {
    flex: 1;
    min-width: 0;
  }

  .scrape-button {
    flex: none;
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink);
    background: var(--wash);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 0 14px;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .scrape-button:hover:not(:disabled) { border-color: var(--vng-orange); }
  .scrape-button:disabled { opacity: 0.5; cursor: default; }

  .scrape-sources {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .scrape-sources a {
    font-size: 12px;
    color: var(--ink-soft);
  }

  .scrape-sources a:hover { color: var(--vng-orange-deep); }

  .source-badge {
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    padding: 3px 12px;
    border-radius: 999px;
    background: var(--wash);
    color: var(--ink-soft);
    border: 1px solid var(--line);
  }

  .source-badge.agent {
    background: var(--vng-orange-tint);
    color: var(--vng-orange-deep);
    border-color: var(--vng-orange);
  }

  /* metrics & rows */
  .metric-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 14px;
  }

  /* Stat pairs are type, not boxes: the card is the only container. */
  .metric {
    padding: 2px 0;
  }

  .metric-grid .metric:nth-child(even) {
    border-left: 1px solid var(--line);
    padding-left: 16px;
  }

  .metric span {
    display: block;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--ink-soft);
    margin-bottom: 3px;
  }

  .metric strong {
    font-size: 21px;
    line-height: 1.2;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }

  .row-list { display: flex; flex-direction: column; gap: 8px; }

  .row {
    display: grid;
    grid-template-columns: 118px minmax(0, 1fr);
    gap: 12px;
    align-items: baseline;
    border-top: 1px solid var(--wash);
    padding-top: 8px;
  }

  .row span {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-soft);
  }

  .row p { margin: 0; font-size: 13px; line-height: 1.5; }

  /* decision & phase badges */
  .decision {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 4px 16px;
    border-radius: 999px;
    display: inline-block;
    color: #fff;
  }

  .decision.ship { background: var(--good); }
  .decision.iterate { background: var(--warn); }
  .decision.kill { background: var(--bad); }

  .phase-badge {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-soft);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px 12px;
    background: var(--wash);
    white-space: nowrap;
  }

  /* run status */
  .run-status { display: flex; flex-direction: column; gap: 12px; }

  .empty {
    margin: 0;
    color: var(--ink-soft);
    font-size: 13.5px;
    line-height: 1.6;
  }

  .empty strong { color: var(--ink); }

  .error-text { color: var(--bad); font-weight: 600; }

  .engine-note { color: var(--warn); font-weight: 600; }

  .experiment-id {
    font-family: ui-monospace, "Cascadia Code", monospace;
    font-size: 11.5px;
    color: var(--ink-faint);
  }

  .progress-track {
    height: 10px;
    border-radius: 999px;
    background: var(--wash);
    border: 1px solid var(--line);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--vng-orange);
    border-radius: 999px;
    transition: width 0.5s ease;
  }

  /* under the hood */
  .under-hood { margin-top: 22px; }

  .under-hood > summary {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-faint);
    cursor: pointer;
    padding: 8px 0;
  }

  .under-hood > summary:hover { color: var(--vng-orange); }

  .trace-list { display: flex; flex-direction: column; gap: 8px; }

  .trace-list details {
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--wash);
    padding: 7px 11px;
  }

  .trace-list summary {
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    color: var(--ink);
  }

  .trace-list pre {
    margin: 8px 0 4px;
    padding: 10px;
    font-size: 11.5px;
    line-height: 1.5;
    overflow-x: auto;
    color: var(--ink);
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 8px;
  }

  /* agent stream */
  .message-list { display: flex; flex-direction: column; gap: 10px; }

  .message {
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--wash);
    padding: 10px 13px;
    font-size: 13.5px;
    line-height: 1.55;
  }

  .message.user {
    background: var(--vng-orange-tint);
    border-color: var(--vng-orange);
  }

  .message.assistant { background: var(--card-bg); }

  .message .tool-call {
    margin: 8px 0 4px;
    padding: 10px;
    font-size: 11.5px;
    overflow-x: auto;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 8px;
  }

  /* responsive */
  @media (max-width: 1080px) {
    .workspace { grid-template-columns: 1fr; }
    .lower-grid { grid-template-columns: 1fr; }
    .intro { grid-template-columns: 1fr; }
    .intro::before { display: none; }
  }

  @media (max-width: 720px) {
    .shell { padding: 20px 16px 44px; }
    .metric-grid { grid-template-columns: 1fr; }
    .brief-form { grid-template-columns: 1fr; }
  }
`;
