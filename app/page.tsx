"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useMemo, useState } from "react";
import { demoScenarios, type DemoScenario } from "@/lib/mock-results";
import { evaluateExperiment, type Decision } from "@/lib/experiment";
import type { MetricType } from "@/lib/stats";

const defaultHypothesis = "A red Buy button will lift purchase conversion for new players.";

export default function Home() {
  const [hypothesis, setHypothesis] = useState(defaultHypothesis);
  const [scenario, setScenario] = useState<DemoScenario>("ship");
  const evaluation = useMemo(() => evaluateExperiment(hypothesis, scenario), [hypothesis, scenario]);
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/agent" }),
  });

  const sendToAgent = () => {
    sendMessage({
      text: `Design and read out this experiment using scenario "${scenario}": ${hypothesis}`,
    });
  };

  return (
    <main className="shell">
      <section className="intro">
        <div>
          <p className="eyebrow">VNG P11 AB-Test Agent</p>
          <h1>Statistically sound LiveOps decisions, not LLM math.</h1>
        </div>
        <p className="brief-note">
          Type a hypothesis, get a powered test brief, run deterministic MiroShark mock data through real stats tools,
          then make a ship, iterate, or kill call with traps for underpowered tests, peeking, and novelty.
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
                onClick={() => setScenario(item.id)}
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
            <p className="eyebrow">Test Brief</p>
            <strong>{evaluation.parsed.metric}</strong>
          </div>
          <p className="rationale">{evaluation.parsed.rationale}</p>
          <div className="metric-grid">
            <Metric label="Baseline" value={formatLevel(evaluation.parsed.baseline, evaluation.parsed.metricType)} />
            <Metric label="MDE" value={formatSignedLevel(evaluation.parsed.mdeGuess, evaluation.parsed.metricType)} />
            <Metric label="n / variant" value={evaluation.design.power.sampleSizePerVariant.toLocaleString()} />
            <Metric label="Duration" value={`${evaluation.design.power.durationDays} days`} />
          </div>
          <div className="row-list">
            <Row label="Variants" value="Control vs treatment, 50/50 player-level randomization" />
            <Row label="Stop rule" value={evaluation.design.stopConditions.join("; ")} />
            <Row label="Guardrails" value={evaluation.design.guardrails.join("; ")} />
          </div>
        </section>

        <section className="card readout-card">
          <div className="card-heading">
            <p className="eyebrow">Readout Report · deterministic stats engine (source of truth)</p>
            <DecisionBadge decision={evaluation.recommendation.decision} />
          </div>
          <p className="rationale">{evaluation.recommendation.rationale}</p>
          <div className="metric-grid">
            <Metric label="Test picked" value={evaluation.significance.test.replaceAll("_", " ")} />
            <Metric label="p-value" value={formatPValue(evaluation.significance.pValue)} />
            <Metric label="Effect" value={formatSignedLevel(evaluation.significance.effect, evaluation.parsed.metricType)} />
            <Metric label="95% CI" value={formatCi(evaluation.significance.ci95, evaluation.parsed.metricType)} />
          </div>
          <div className="row-list">
            <Row label="Sample" value={`${evaluation.results.variants[0].visitors.toLocaleString()} control / ${evaluation.results.variants[1].visitors.toLocaleString()} treatment`} />
            <Row label="Guardrail state" value={evaluation.guardrails.passed ? "Clean" : "Needs action"} />
            <Row
              label="Caveats"
              value={
                evaluation.recommendation.caveats.length > 0
                  ? evaluation.recommendation.caveats.join("; ")
                  : "None"
              }
            />
          </div>
        </section>
      </section>

      <section className="lower-grid">
        <section className="card">
          <div className="card-heading">
            <p className="eyebrow">Tool Trace</p>
            <strong>Visible orchestration</strong>
          </div>
          <div className="trace-list">
            {evaluation.toolTrace.map((item) => (
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

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}pp`;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatSignedCurrency(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

// Continuous metrics (ARPU) are dollar amounts; binary/count metrics are rates.
function formatLevel(value: number, metricType: MetricType): string {
  return metricType === "continuous" ? formatCurrency(value) : formatPct(value);
}

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
  textarea {
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

    .metric-grid {
      grid-template-columns: 1fr;
    }
  }
`;
