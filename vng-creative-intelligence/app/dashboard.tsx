"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalysisSnapshot, BacktestResult, ThemeCluster } from "@/lib/analysis";
import type { GenerationPipelineResult, PipelineServiceStatus } from "@/lib/gen";

interface DashboardProps {
  snapshot: AnalysisSnapshot;
  backtest: BacktestResult;
  agentEnabled: boolean;
  serviceConfig: {
    nanoBanana: boolean;
    miroshark: boolean;
    meshy: boolean;
  };
}

interface HistoryRun {
  id: string;
  generated_at: string;
  recommended_theme: string;
  pltv_weighted_roas: number | null;
  high_value_share: number | null;
  created_at: string;
}

const INK_MUTED = "oklch(0.49 0.022 72)";
const GRID = "oklch(0.885 0.012 85)";
const SIGNAL = "oklch(0.545 0.115 163)";
const WARN = "oklch(0.545 0.13 55)";
const NEUTRAL = "oklch(0.68 0.018 85)";

export default function Dashboard({
  snapshot: initialSnapshot,
  backtest: initialBacktest,
  agentEnabled,
  serviceConfig,
}: DashboardProps) {
  const [agentInput, setAgentInput] = useState("Explain which theme we should fund next.");
  const [analysis, setAnalysis] = useState({
    snapshot: initialSnapshot,
    backtest: initialBacktest,
    sourceLabel: "Synthetic sample CSV",
  });
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [historyRuns, setHistoryRuns] = useState<HistoryRun[] | null>(null);
  const [historyStatus, setHistoryStatus] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<GenerationPipelineResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/agent" }),
  });

  const { snapshot, backtest } = analysis;
  const taggingSource = snapshot.creatives[0]?.theme.source ?? "metadata";
  const taggingFallbackReason = snapshot.creatives.find((creative) => creative.theme.fallbackReason)?.theme.fallbackReason;
  const serviceBadges: PipelineServiceStatus[] =
    pipeline?.services ??
    [
      {
        service: "nano-banana",
        label: serviceConfig.nanoBanana ? "Nano Banana configured" : "Bundled concept art",
        source: serviceConfig.nanoBanana ? ("live" as const) : ("mock" as const),
      },
      {
        service: "miroshark",
        label: serviceConfig.miroshark ? "MiroShark configured" : "MockSimClient",
        source: serviceConfig.miroshark ? ("live" as const) : ("mock" as const),
      },
      {
        service: "meshy",
        label: serviceConfig.meshy ? "Meshy configured" : "Bundled GLB",
        source: serviceConfig.meshy ? ("live" as const) : ("mock" as const),
      },
    ];

  useEffect(() => {
    void import("@google/model-viewer");
  }, []);

  useEffect(() => {
    const elements = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-in"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const naivePickLabels = useMemo(
    () =>
      new Set(
        backtest.selectorComparisons
          .filter((comparison) => comparison.id !== "agent" && comparison.themeLabel !== snapshot.recommendation.themeLabel)
          .map((comparison) => comparison.themeLabel),
      ),
    [backtest.selectorComparisons, snapshot.recommendation.themeLabel],
  );

  function roleColor(themeLabel: string): string {
    if (themeLabel === snapshot.recommendation.themeLabel) return SIGNAL;
    if (naivePickLabels.has(themeLabel)) return WARN;
    return NEUTRAL;
  }

  const chartData = useMemo(
    () =>
      snapshot.clusters.map((item) => ({
        name: shortTheme(item),
        theme: item.themeLabel,
        pLtvRoas: round(item.pLtvWeightedRoas),
        d7Roas: round(item.d7Roas),
        hvShare: round(item.highValuePlayerShare * 100),
        spend: item.spend,
        installs: item.installs,
        color: roleColor(item.themeLabel),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot.clusters, snapshot.recommendation.themeLabel, naivePickLabels],
  );

  const pickName = shortThemeName(snapshot.recommendation.themeLabel);
  const headlinePick = punchyThemeName(snapshot.recommendation.themeLabel);
  const headlineAvoid = snapshot.recommendation.avoidTheme ? punchyThemeName(snapshot.recommendation.avoidTheme) : null;

  async function runGeneration() {
    setIsGenerating(true);
    setGenerationError(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: snapshot.recommendation.themeKey }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      setPipeline(await res.json());
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  async function uploadCsv(file: File | undefined) {
    if (!file) return;
    setUploadStatus("Analyzing uploaded CSV...");

    const form = new FormData();
    form.set("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Upload failed");
      setAnalysis({ snapshot: payload.snapshot, backtest: payload.backtest, sourceLabel: payload.fileName });
      setPipeline(null);
      setUploadStatus(`Loaded ${payload.fileName}`);
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : "Upload failed");
    }
  }

  async function loadHistory() {
    setHistoryStatus("Loading run history...");
    try {
      const res = await fetch("/api/history");
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not load history");
      setHistoryRuns(payload.runs);
      setHistoryStatus(payload.configured ? null : "Supabase is not configured, so run history is local-only for now.");
    } catch (error) {
      setHistoryStatus(error instanceof Error ? error.message : "Could not load history");
    }
  }

  return (
    <main>
      {/* ------------------------------- The Lab ------------------------------- */}
      <header className="masthead container">
        <div className="mastheadMeta">
          <p className="wordmark">
            <strong>VNG Games</strong> · Creative Performance Intelligence · AABW 2026
          </p>
          <div className="serviceBadges" aria-label="Service status">
            <ServiceBadge
              label={
                taggingSource === "llm-vision"
                  ? "Themes: LLM vision"
                  : agentEnabled
                    ? "Themes: metadata fallback"
                    : "Themes: metadata"
              }
              source={taggingSource === "llm-vision" ? "live" : "mock"}
              fallbackReason={
                agentEnabled && taggingSource !== "llm-vision"
                  ? taggingFallbackReason ?? "Vision tagging did not complete with llm-vision labels, so metadata tags are being used."
                  : undefined
              }
            />
            {serviceBadges.map((service) => (
              <ServiceBadge
                key={service.service}
                label={service.label}
                source={service.source}
                fallbackReason={service.fallbackReason}
              />
            ))}
          </div>
        </div>

        <h1 className="headline">
          <em>{headlinePick}</em> brings whales.
          {headlineAvoid ? (
            <>
              {" "}
              <span className="headlineWarn">{headlineAvoid}</span> brings tourists.
            </>
          ) : (
            " Fund what the whales watch."
          )}
        </h1>

        <div className="mastheadFoot">
          <p className="summary">
            The agent joins UA performance with pLTV, clusters creatives by high-value-player share, backs its
            recommendation on a holdout, then generates the next skin line and previews it in 3D below.
          </p>
          <div className="controls">
            <label className="uploadControl">
              <span>Upload CSV</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  void uploadCsv(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button type="button" className="secondaryButton" onClick={loadHistory}>
              Past runs
            </button>
            <button type="button" className="primaryButton" onClick={runGeneration} disabled={isGenerating}>
              {isGenerating ? "Generating..." : "Generate recommended skin"}
              <span className="buttonGlyph" aria-hidden>
                ↓
              </span>
            </button>
          </div>
        </div>
        <span className="dataSource">{uploadStatus ?? analysis.sourceLabel}</span>
      </header>

      {historyRuns ? (
        <section className="historyStrip" aria-label="Past analysis runs">
          <div className="container">
            <div className="panelHeader">
              <div>
                <p className="panelKicker">Past runs</p>
                <h2>Stored analysis snapshots</h2>
              </div>
              <button type="button" className="secondaryButton" onClick={() => setHistoryRuns(null)}>
                Close
              </button>
            </div>
            {historyStatus ? <p className="finePrint">{historyStatus}</p> : null}
            {historyRuns.length > 0 ? (
              <div className="historyGrid">
                {historyRuns.map((run) => (
                  <div key={run.id} className="historyItem">
                    <strong>{shortThemeName(run.recommended_theme)}</strong>
                    <span>{run.pltv_weighted_roas === null ? "ROAS n/a" : `${round(run.pltv_weighted_roas)}x pLTV ROAS`}</span>
                    <small>{new Date(run.created_at).toLocaleString()}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="emptyState">No stored runs yet.</p>
            )}
          </div>
        </section>
      ) : null}

      <section className="container reveal" aria-label="Portfolio summary">
        <div className="evidenceStrip">
          <div className="evidenceCell">
            <span>Portfolio pLTV ROAS</span>
            <strong className="figure">{round(snapshot.totals.pLtvWeightedRoas)}x</strong>
            <small>All sample creatives</small>
          </div>
          <div className="evidenceCell">
            <span>High-value share</span>
            <strong className="figure">{formatPercent(snapshot.totals.highValuePlayerShare)}</strong>
            <small>High-value players / installs</small>
          </div>
          <div className="evidenceCell emphasis">
            <span>Backtest lift</span>
            <strong className="figure">+{round(backtest.liftVsPortfolioPct)}%</strong>
            <small>
              Recommended vs holdout portfolio · 95% CI {signed(backtest.uncertainty.lowerPct)}% to{" "}
              {signed(backtest.uncertainty.upperPct)}% · p={backtest.uncertainty.permutationPValue.toFixed(3)}
            </small>
          </div>
          <div className="evidenceCell">
            <span>Recommended theme</span>
            <strong>{pickName}</strong>
            <small>{round(backtest.uncertainty.winProbabilityPct)}% bootstrap win probability</small>
          </div>
        </div>
      </section>

      <section className="labSection">
        <div className="container mainGrid">
          <div className="reveal">
            <div className="panelHeader">
              <div>
                <p className="panelKicker">
                  <span className="kickerIndex">01</span>Portfolio
                </p>
                <h2>pLTV-weighted ROAS by theme</h2>
              </div>
              <span className="smallPill">
                {taggingSource === "llm-vision" ? "Themes: LLM vision" : "Themes: metadata (set AI_GATEWAY_API_KEY for vision)"}
              </span>
            </div>
            <div className="chartFrame">
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 26 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    angle={-16}
                    textAnchor="end"
                    height={62}
                    tick={{ fill: INK_MUTED, fontSize: 11 }}
                  />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: INK_MUTED, fontSize: 11 }} />
                  <Tooltip content={<ClusterTooltip />} cursor={{ fill: "oklch(0.93 0.011 88 / 0.6)" }} />
                  <Bar dataKey="pLtvRoas" name="pLTV ROAS" radius={[4, 4, 0, 0]} maxBarSize={44}>
                    {chartData.map((entry) => (
                      <Cell key={entry.theme} fill={entry.color} />
                    ))}
                  </Bar>
                  <Line type="monotone" dataKey="d7Roas" name="D7 ROAS" stroke="oklch(0.36 0.03 70)" strokeWidth={2} dot={{ r: 3, fill: "oklch(0.36 0.03 70)" }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="roleKey" aria-hidden>
              <span>
                <i style={{ background: SIGNAL }} />
                agent pick
              </span>
              <span>
                <i style={{ background: WARN }} />
                naive-picker trap
              </span>
              <span>
                <i style={{ background: NEUTRAL }} />
                other themes
              </span>
              <span>
                <i style={{ background: "oklch(0.36 0.03 70)", borderRadius: 999, height: 3, marginTop: 4 }} />
                D7 ROAS line
              </span>
            </div>
          </div>

          <div className="verdictPanel reveal">
            <div className="panelHeader">
              <div>
                <p className="panelKicker">
                  <span className="kickerIndex">02</span>Verdict
                </p>
                <h2>{snapshot.recommendation.themeLabel}</h2>
              </div>
              <span className="scoreBadge">PICK #1</span>
            </div>
            <ol className="rationaleList">
              {snapshot.recommendation.rationale.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
            {snapshot.recommendation.avoidTheme ? (
              <div className="avoidBox">
                <strong>Avoid overfunding {snapshot.recommendation.avoidTheme}</strong>
                <p>{snapshot.recommendation.avoidReason}</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="labSection">
        <div className="container splitGrid">
          <div className="reveal">
            <div className="panelHeader">
              <div>
                <p className="panelKicker">
                  <span className="kickerIndex">03</span>Theme map
                </p>
                <h2>High-value share versus spend</h2>
              </div>
            </div>
            <div className="chartFrame compact">
              <ResponsiveContainer width="100%" height={280}>
                <ScatterChart margin={{ top: 12, right: 18, left: 4, bottom: 20 }}>
                  <CartesianGrid stroke={GRID} />
                  <XAxis
                    type="number"
                    dataKey="spend"
                    name="Spend"
                    tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: INK_MUTED, fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="hvShare"
                    name="HVP share"
                    tickFormatter={(value) => `${value}%`}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: INK_MUTED, fontSize: 11 }}
                  />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<ScatterTooltip />} />
                  <Scatter data={chartData} name="Theme clusters">
                    {chartData.map((entry) => (
                      <Cell key={entry.theme} fill={entry.color} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="reveal">
            <div className="panelHeader">
              <div>
                <p className="panelKicker">
                  <span className="kickerIndex">04</span>Evidence
                </p>
                <h2>Following the agent on holdout</h2>
              </div>
            </div>
            <div className="liftFigure">
              <strong>+{round(backtest.liftVsPortfolioPct)}%</strong>
              <span>
                95% CI {signed(backtest.uncertainty.lowerPct)}% to {signed(backtest.uncertainty.upperPct)}% · permutation
                p={backtest.uncertainty.permutationPValue.toFixed(3)}
              </span>
            </div>
            <div className="backtestBars" aria-label="Backtest ROAS comparison">
              <div>
                <span>Recommended theme{backtest.recommendedThemes.length > 1 ? "s" : ""}</span>
                <div className="barTrack selected">
                  <div style={{ width: `${Math.min(100, backtest.selectedRoas * 28)}%` }} />
                </div>
                <strong>{round(backtest.selectedRoas)}x</strong>
              </div>
              <div>
                <span>Portfolio holdout (avg)</span>
                <div className="barTrack">
                  <div style={{ width: `${Math.min(100, backtest.baselineRoas * 28)}%` }} />
                </div>
                <strong>{round(backtest.baselineRoas)}x</strong>
              </div>
              <div>
                <span>Rejected themes</span>
                <div className="barTrack">
                  <div style={{ width: `${Math.min(100, backtest.rejectedRoas * 28)}%` }} />
                </div>
                <strong>{round(backtest.rejectedRoas)}x</strong>
              </div>
            </div>
            <p className="finePrint">
              Recommended <strong>{shortThemeName(backtest.recommendedLabels[0] ?? "")}</strong> beats the portfolio by
              +{round(backtest.liftVsPortfolioPct)}% and the rejected themes by +{round(backtest.liftVsRejectedPct)}%.
              Selected holdout spend: {formatMoney(backtest.selectedSpend)} of {formatMoney(backtest.holdoutSpend)}.
            </p>
            <div className="baselineTable" aria-label="Baseline comparison">
              {backtest.selectorComparisons.map((comparison) => (
                <div
                  key={comparison.id}
                  className={
                    comparison.id === "agent"
                      ? "baselineRow selectedBaseline"
                      : comparison.holdoutRoas < backtest.baselineRoas
                        ? "baselineRow trapBaseline"
                        : "baselineRow"
                  }
                >
                  <span>{comparison.label}</span>
                  <strong>{shortThemeName(comparison.themeLabel)}</strong>
                  <em>{round(comparison.holdoutRoas)}x</em>
                </div>
              ))}
            </div>
            <p className="finePrint methodologyNote">{backtest.methodology}</p>
          </div>
        </div>
      </section>

      {/* ------------------------------ The Stage ------------------------------ */}
      <section className="stage" aria-label="Generation stage">
        <div className="container">
          <div className="stageHeader reveal">
            <div>
              <p className="stageKicker">
                <span className="kickerIndex">05</span>The Stage
              </p>
              <h2 className="stageTitle">
                From verdict to asset, <em>in one loop</em>.
              </h2>
              <p className="stageIntro">
                Skin concepts for the recommended theme, a reception simulation on each, the best pick, and a 3D
                preview. Every step reports whether it ran live or fell back, and why.
              </p>
            </div>
            <button type="button" className="primaryButton stageButton" onClick={runGeneration} disabled={isGenerating}>
              {isGenerating ? "Generating..." : "Run pipeline"}
              <span className="buttonGlyph" aria-hidden>
                ▸
              </span>
            </button>
          </div>

          <div className="stageGrid">
            <div className="reveal">
              {generationError ? <p className="errorText">{generationError}</p> : null}
              {pipeline ? (
                <>
                  <div className="toolLog">
                    {pipeline.toolLog.map((step) => (
                      <div key={step.name} className={step.status === "fallback" ? "toolFallback" : undefined}>
                        <code>{step.name}</code>
                        <span>
                          {step.summary}
                          {step.fallbackReason ? <em> Fell back: {step.fallbackReason}</em> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="conceptGrid">
                    {pipeline.concepts.map((concept, index) => (
                      <article
                        key={concept.id}
                        className={concept.id === pipeline.best.id ? "conceptTile selectedConcept" : "conceptTile"}
                        style={{ animationDelay: `${index * 70}ms` }}
                      >
                        <img src={concept.imageUrl} alt="" />
                        <div>
                          <strong>
                            {concept.title}
                            {concept.id === pipeline.best.id ? <span className="bestTag">BEST</span> : null}
                          </strong>
                          <span>
                            {concept.reception.source === "mock" ? "[MOCK] " : ""}
                            {concept.reception.score}/100 simulated reception, {concept.imageSource === "nano-banana" ? "live art" : "bundled art"}
                          </span>
                          {concept.imageFallbackReason ? <small>Image fallback: {concept.imageFallbackReason}</small> : null}
                          {concept.reception.fallbackReason ? <small>Sim fallback: {concept.reception.fallbackReason}</small> : null}
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <p className="emptyState">
                  Run the pipeline to produce skin concepts, reception verdicts, a best pick, and a 3D model. With no
                  keys it runs the labeled mock path end to end.
                </p>
              )}
            </div>

            <div className="reveal">
              <div className="panelHeader stagePanelHeader">
                <div>
                  <p className="panelKicker">
                    <span className="kickerIndex">06</span>3D preview
                  </p>
                  <h2>{pipeline?.best.title ?? "Awaiting generated concept"}</h2>
                </div>
              </div>
              <div className="modelStage">
                {pipeline ? (
                  createModelViewer(pipeline)
                ) : (
                  <div className="modelPlaceholder">
                    <span>GLB</span>
                  </div>
                )}
              </div>
              {pipeline ? (
                <p className="finePrint">
                  {pipeline.best.reception.summary}
                  {pipeline.model.fallbackReason ? ` Model fallback: ${pipeline.model.fallbackReason}` : ""}
                </p>
              ) : null}
            </div>
          </div>

          <div className="agentConsole reveal">
            <div className="panelHeader stagePanelHeader">
              <div>
                <p className="panelKicker">
                  <span className="kickerIndex">07</span>Agent console
                </p>
                <h2>Ask the analysis agent</h2>
              </div>
              <span className="smallPill">{agentEnabled ? status : "offline"}</span>
            </div>

            {!agentEnabled ? (
              <div className="agentDisabled">
                <p className="emptyState">
                  The live analysis agent is off. Set <code>AI_GATEWAY_API_KEY</code> (or Vercel OIDC) to enable the
                  tool-calling agent. It runs the same <code>join_perf_ltv → tag_themes → cluster → recommend_direction</code>{" "}
                  loop shown above, with LLM vision on the thumbnails.
                </p>
                <p className="finePrint">The dashboard, backtest, and mock generation pipeline all work without any key.</p>
              </div>
            ) : (
              <>
                <div className="messageList">
                  {messages.length === 0 ? (
                    <p className="emptyState">Ask for a recommendation or a cluster explanation to see tool calls surface here.</p>
                  ) : null}
                  {messages.map((message) => (
                    <article key={message.id} className={message.role === "user" ? "message userMessage" : "message"}>
                      <strong>{message.role}</strong>
                      {message.parts.map((part, index) => renderMessagePart(part, index))}
                    </article>
                  ))}
                </div>
                {error ? <p className="errorText">Agent error: {error.message}. Confirm AI_GATEWAY_API_KEY is set.</p> : null}
                <form
                  className="agentForm"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const text = agentInput.trim();
                    if (!text) return;
                    sendMessage({ text });
                    setAgentInput("");
                  }}
                >
                  <input value={agentInput} onChange={(event) => setAgentInput(event.target.value)} />
                  <button type="submit" className="primaryButton stageButton" disabled={status !== "ready"}>
                    Ask
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function ServiceBadge({
  label,
  source,
  fallbackReason,
}: {
  label: string;
  source: "live" | "mock";
  fallbackReason?: string;
}) {
  return (
    <span className={fallbackReason ? "serviceBadge fallbackBadge" : `serviceBadge ${source === "live" ? "liveBadge" : "mockBadge"}`}>
      {label}
      {fallbackReason ? <small title={fallbackReason}>fallback</small> : null}
    </span>
  );
}

function ClusterTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Record<string, unknown> }> }) {
  if (!active || !payload?.[0]) return null;
  const item = payload[0].payload;

  return (
    <div className="chartTooltip">
      <strong>{String(item.theme)}</strong>
      <span>pLTV ROAS: {String(item.pLtvRoas)}x</span>
      <span>D7 ROAS: {String(item.d7Roas)}x</span>
      <span>High-value share: {String(item.hvShare)}%</span>
    </div>
  );
}

function ScatterTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Record<string, unknown> }> }) {
  if (!active || !payload?.[0]) return null;
  const item = payload[0].payload;

  return (
    <div className="chartTooltip">
      <strong>{String(item.theme)}</strong>
      <span>Spend: {formatMoney(Number(item.spend))}</span>
      <span>High-value share: {String(item.hvShare)}%</span>
    </div>
  );
}

function createModelViewer(pipeline: GenerationPipelineResult) {
  return (
    <div className="modelViewerHost">
      <model-viewer
        src={pipeline.model.src}
        poster={pipeline.model.poster}
        alt={pipeline.model.alt}
        camera-controls
        auto-rotate
        shadow-intensity="0.8"
        exposure="0.9"
      />
    </div>
  );
}

function renderMessagePart(part: { type: string; text?: string; input?: unknown; output?: unknown }, index: number) {
  if (part.type === "text") {
    return <p key={index}>{part.text}</p>;
  }

  if (part.type.startsWith("tool-")) {
    return (
      <div key={index} className="agentToolStep">
        <code>{part.type.replace(/^tool-/, "")}</code>
        <span>{summarizeToolPart(part)}</span>
      </div>
    );
  }

  return null;
}

function shortTheme(cluster: ThemeCluster): string {
  return cluster.motif
    .split("-")
    .map((part) => part.slice(0, 4))
    .join(" ");
}

function shortThemeName(label: string): string {
  return label.split(" / ").slice(0, 2).join(" / ");
}

function punchyThemeName(label: string): string {
  const parts = label.split(" / ");
  return parts[1] ?? parts[0];
}

function formatPercent(value: number): string {
  return `${round(value * 100)}%`;
}

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${round(value)}`;
}

function summarizeToolPart(part: { type: string; input?: unknown; output?: unknown }): string {
  if (!part.output) return "Running...";
  const output = part.output as Record<string, unknown>;
  if (part.type === "tool-recommend_direction" && typeof output.recommendation === "object") {
    const recommendation = output.recommendation as { themeLabel?: string };
    return `Recommended ${recommendation.themeLabel ?? "a theme"} from current clusters.`;
  }
  if (part.type === "tool-run_backtest" && typeof output.liftVsPortfolioPct === "number") {
    return `Backtest lift ${signed(output.liftVsPortfolioPct)}% vs portfolio.`;
  }
  if (part.type === "tool-compare_baselines" && Array.isArray(part.output)) {
    return `Compared ${part.output.length} selectors against holdout pLTV ROAS.`;
  }
  if (part.type === "tool-run_generation_pipeline" && typeof output.best === "object") {
    const best = output.best as { title?: string };
    return `Generated and ranked concepts. Best pick: ${best.title ?? "selected concept"}.`;
  }
  if (Array.isArray(part.output)) return `Returned ${part.output.length} records.`;
  return "Tool completed.";
}
