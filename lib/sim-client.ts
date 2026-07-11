import { designTest, parseHypothesis } from "./experiment";
import { createMockExperimentResults, type DemoScenario, type MockExperimentInput } from "./mock-results";
import type { ExperimentResults, MetricType } from "./stats";

// ─── Async experiment-job contract (VNG_GRAND_PLAN §3.1, mirrors MiroShark §2.2) ──

export type ExperimentStatus = "preparing" | "running" | "complete" | "failed";

export interface ExperimentProgress {
  runsTotal: number;
  runsDone: number;
  runsActive: number;
  currentRoundMax?: number;
  roundsPerRun?: number;
}

export interface ExperimentJob {
  experimentId: string;
  status: ExperimentStatus;
  progress?: ExperimentProgress;
  error?: string | null;
}

export interface ExperimentVariantInput {
  name: string;
  text: string;
}

export interface CreateExperimentInput {
  /** Free-text hypothesis, stored for the report. */
  hypothesis: string;
  /** ≥2 ad/feature variants broadcast to the simulated audience. */
  variants: ExperimentVariantInput[];
  /** Parent scenario text for MiroShark (or reuse parentSimulationId). */
  scenario?: string;
  parentSimulationId?: string;
  replicates?: number;
  parallel?: number;
  /** Which canned dataset the mock serves (demo preset buttons). Ignored by MiroShark. */
  demoScenario?: DemoScenario;
  // Optional metric config threaded into the mock dataset. When omitted the mock
  // derives it deterministically from the hypothesis via parseHypothesis/designTest.
  metric?: string;
  metricType?: MetricType;
  unit?: string;
  alpha?: number;
  requiredSampleSizePerVariant?: number;
  plannedDays?: number;
}

export interface SimClient {
  createExperiment(input: CreateExperimentInput): Promise<ExperimentJob>;
  getStatus(experimentId: string): Promise<ExperimentJob>;
  getResults(experimentId: string): Promise<ExperimentResults>;
}

/** Structured client error so routes can map failures to clean 4xx responses. */
export class SimClientError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
    this.name = "SimClientError";
  }
}

// ─── MockSimClient ────────────────────────────────────────────────────────────
// Deterministic in-memory job registry: a job progresses preparing → running →
// complete across getStatus polls (complete on the 8th poll), then getResults
// serves the scenario-appropriate canned dataset from lib/mock-results.ts.

const PREPARING_POLLS = 2; // polls 1..2 → preparing
const COMPLETE_POLL = 8; //   polls 3..7 → running, poll 8+ → complete (≈8 polls total)

interface MockJobRecord {
  input: MockExperimentInput & { hypothesis: string; runsTotal: number };
  polls: number;
}

// Module-level so every MockSimClient instance (one per request in Next.js route
// handlers) shares the same registry within a server process.
const mockJobs = new Map<string, MockJobRecord>();
let mockJobSeq = 0;

export class MockSimClient implements SimClient {
  async createExperiment(input: CreateExperimentInput): Promise<ExperimentJob> {
    if (!input.hypothesis || input.variants.length < 2) {
      throw new SimClientError("createExperiment requires a hypothesis and ≥2 variants.", "invalid_input", 400);
    }

    const scenario = normalizeScenario(input.demoScenario);
    // Fill any missing metric config deterministically from the hypothesis so the
    // canned dataset always matches the metric type the brief would produce.
    const parsed = parseHypothesis(input.hypothesis);
    const design = designTest(parsed);
    const runsTotal = input.variants.length * (input.replicates ?? 3);

    mockJobSeq += 1;
    const experimentId = `mock_exp_${mockJobSeq}_${scenario}`;
    mockJobs.set(experimentId, {
      polls: 0,
      input: {
        hypothesis: input.hypothesis,
        scenario,
        metric: input.metric ?? parsed.metric,
        metricType: input.metricType ?? parsed.metricType,
        unit: input.unit ?? parsed.unit,
        alpha: input.alpha ?? design.power.alpha,
        requiredSampleSizePerVariant: input.requiredSampleSizePerVariant ?? design.power.sampleSizePerVariant,
        plannedDays: input.plannedDays ?? design.power.durationDays,
        runsTotal,
      },
    });

    return { experimentId, status: "preparing", progress: mockProgress(0, runsTotal), error: null };
  }

  async getStatus(experimentId: string): Promise<ExperimentJob> {
    const record = mockJobs.get(experimentId);
    if (!record) {
      throw new SimClientError(`Unknown experiment "${experimentId}".`, "experiment_not_found", 404);
    }
    record.polls += 1;
    return {
      experimentId,
      status: mockStatus(record.polls),
      progress: mockProgress(record.polls, record.input.runsTotal),
      error: null,
    };
  }

  async getResults(experimentId: string): Promise<ExperimentResults> {
    const record = mockJobs.get(experimentId);
    if (!record) {
      throw new SimClientError(`Unknown experiment "${experimentId}".`, "experiment_not_found", 404);
    }
    if (mockStatus(record.polls) !== "complete") {
      throw new SimClientError(
        `Experiment "${experimentId}" is still ${mockStatus(record.polls)}; poll status until complete.`,
        "results_not_ready",
        409,
      );
    }
    return createMockExperimentResults(record.input);
  }
}

function mockStatus(polls: number): ExperimentStatus {
  if (polls <= PREPARING_POLLS) return "preparing";
  if (polls < COMPLETE_POLL) return "running";
  return "complete";
}

function mockProgress(polls: number, runsTotal: number): ExperimentProgress {
  const done = Math.min(runsTotal, Math.max(0, Math.round(((polls - PREPARING_POLLS) / (COMPLETE_POLL - PREPARING_POLLS)) * runsTotal)));
  return {
    runsTotal,
    runsDone: polls >= COMPLETE_POLL ? runsTotal : done,
    runsActive: polls >= COMPLETE_POLL || polls <= PREPARING_POLLS ? 0 : Math.min(2, runsTotal - done),
    currentRoundMax: Math.min(48, polls * 6),
    roundsPerRun: 48,
  };
}

// ─── MiroSharkClient ──────────────────────────────────────────────────────────
// Talks to the Phase-2 experiments blueprint. All routes are behind MiroShark's
// internal-key guard; the key stays server-side (never exposed to the browser).

export class MiroSharkClient implements SimClient {
  constructor(
    private baseUrl: string,
    private internalKey: string = process.env.MIROSHARK_INTERNAL_KEY ?? "",
  ) {}

  async createExperiment(input: CreateExperimentInput): Promise<ExperimentJob> {
    const body = await this.request("POST", "/api/experiments/ab-test", {
      hypothesis: input.hypothesis,
      scenario: input.scenario,
      parent_simulation_id: input.parentSimulationId,
      variants: input.variants,
      replicates: input.replicates ?? 3,
      parallel: input.parallel ?? 2,
      trigger_round: 0,
    });
    return {
      experimentId: asString(body.experiment_id),
      status: asStatus(body.status, "preparing"),
      error: null,
    };
  }

  async getStatus(experimentId: string): Promise<ExperimentJob> {
    const body = await this.request("GET", `/api/experiments/${encodeURIComponent(experimentId)}/status`);
    const progress = isRecord(body.progress) ? body.progress : undefined;
    return {
      experimentId: asString(body.experiment_id, experimentId),
      status: asStatus(body.status, "running"),
      progress: progress
        ? {
            runsTotal: asNumber(progress.runs_total),
            runsDone: asNumber(progress.runs_done),
            runsActive: asNumber(progress.runs_active),
            currentRoundMax: asNumber(progress.current_round_max) || undefined,
            roundsPerRun: asNumber(progress.rounds_per_run) || undefined,
          }
        : undefined,
      error: typeof body.error === "string" ? body.error : null,
    };
  }

  async getResults(experimentId: string): Promise<ExperimentResults> {
    // MiroShark returns exactly the TS ExperimentResults contract (plus a `raw`
    // extension we pass through untouched); requiredSampleSizePerVariant arrives
    // as 0 and is filled by the Next.js side from its own power analysis.
    const body = await this.request("GET", `/api/experiments/${encodeURIComponent(experimentId)}/results`);
    return body as unknown as ExperimentResults;
  }

  private async request(method: "GET" | "POST", path: string, payload?: unknown): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "x-miroshark-internal-key": this.internalKey,
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        cache: "no-store",
      });
    } catch (error) {
      throw new SimClientError(
        `MiroShark is unreachable at ${this.baseUrl}: ${error instanceof Error ? error.message : "fetch failed"}`,
        "miroshark_unreachable",
        502,
      );
    }

    const text = await res.text();
    if (!res.ok) {
      const status = res.status === 409 ? 409 : res.status >= 500 ? 502 : res.status;
      throw new SimClientError(
        `MiroShark ${res.status} on ${method} ${path}: ${text.slice(0, 300)}`,
        res.status === 409 ? "results_not_ready" : "miroshark_error",
        status,
      );
    }

    try {
      const parsed = JSON.parse(text) as unknown;
      if (!isRecord(parsed)) throw new Error("not an object");
      return parsed;
    } catch {
      throw new SimClientError(`MiroShark returned non-JSON on ${method} ${path}.`, "miroshark_bad_response", 502);
    }
  }
}

// ─── Selection ────────────────────────────────────────────────────────────────

export interface GetSimClientOptions {
  /** "mock" forces the MockSimClient regardless of MIROSHARK_URL (stage safety: ?sim=mock). */
  sim?: string | null;
}

export function getSimClient(options?: GetSimClientOptions): SimClient {
  if (options?.sim === "mock") return new MockSimClient();
  const url = process.env.MIROSHARK_URL;
  return url ? new MiroSharkClient(url) : new MockSimClient();
}

// ─── Back-compat: old synchronous mock interface ──────────────────────────────

export interface SimInput extends MockExperimentInput {
  hypothesis: string;
}

/**
 * Thin back-compat shim over the mock path. Returns the scenario-appropriate
 * canned dataset immediately (no job lifecycle). Deterministic and offline —
 * used by the agent route's significance-test fallback and the consistency eval.
 */
export async function generateExperimentResults(input: SimInput): Promise<ExperimentResults> {
  return createMockExperimentResults(input);
}

export function normalizeScenario(value: unknown): DemoScenario {
  if (
    value === "ship" ||
    value === "underpowered" ||
    value === "peeking" ||
    value === "novelty" ||
    value === "guardrail" ||
    value === "flat"
  ) {
    return value;
  }
  return "ship";
}

// ─── small coercion helpers ───────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asStatus(value: unknown, fallback: ExperimentStatus): ExperimentStatus {
  return value === "preparing" || value === "running" || value === "complete" || value === "failed"
    ? value
    : fallback;
}
