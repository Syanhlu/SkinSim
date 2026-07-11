// ─── Swarm-simulation adapter (MiroShark) ────────────────────────────────────
// Used by the 3 VNG projects to "simulate reception" of a skin, a balance
// change, or an A/B variant. MiroShark is a standalone Python + Neo4j service
// (https://github.com/aaronjmars/MiroShark) that does NOT run on Vercel.
//
// The whole point of this interface: the app codes against SimClient and gets
// MockSimClient by default, so it DEPLOYS GREEN with zero infra. Swap in the
// real MiroSharkClient (set MIROSHARK_URL) during build week — nothing else
// in the app changes.

export interface SimScenario {
  name: "bull" | "bear" | "neutral" | string;
  outcome: string;
}

export interface SimVerdict {
  /** One-line human-readable verdict. */
  summary: string;
  /** 0–100 plausibility/reception score. Treat as a RANKER, not ground truth. */
  score: number;
  /** Whether the verdict came from the real MiroShark service or the deterministic local mock. */
  source: "miroshark" | "mock";
  /** Present when a live service was configured but the pipeline fell back to mock output. */
  fallbackReason?: string;
  /** MiroShark auto-generates Bull/Bear/Neutral scenarios. */
  scenarios: SimScenario[];
  /** Quotes from simulated posts/trades, for the demo's "evidence" panel. */
  citations: string[];
  /** Raw engine payload (verdict.json), if you need more. */
  raw?: unknown;
}

/** A pre-fetched web source — e.g. output of a scraping/research agent — merged into
 *  MiroShark's ingestion corpus alongside `document`. MiroShark does not re-fetch `url`;
 *  `text` is what actually gets ingested. */
export interface SimUrlDoc {
  title: string;
  url: string;
  text: string;
}

export interface SimOptions {
  /** Free-text steer for what MiroShark's ontology/agents should focus on. Defaults to a
   *  truncated summary of `document` when omitted. */
  simulationRequirement?: string;
  projectName?: string;
  /** Country/locale MiroShark's persona grounding understands (e.g. "vn"). Default "vn". */
  country?: string;
  /** Social platforms to run. Default ["threads", "facebook"]. */
  platforms?: Array<"threads" | "facebook" | "tiktok">;
  /** Also run the prediction-market simulation alongside the social platforms. */
  market?: boolean;
  /** Simulated rounds to run — cost scales with this. Default 3. */
  maxRounds?: number;
  [key: string]: unknown;
}

export interface SimInput {
  /** The document to simulate: skin concept, patch note, experiment design, etc. */
  document: string;
  /** Optional extra grounding docs (e.g. scraped community/news context) ingested into the
   *  same MiroShark corpus as `document`. */
  urlDocs?: SimUrlDoc[];
  /** Optional knobs (agent count, horizon) once the real engine is wired. */
  options?: SimOptions;
}

export interface SimClient {
  simulate(input: SimInput): Promise<SimVerdict>;
}

/** Canned, deterministic verdict so the app runs with no external services. */
export class MockSimClient implements SimClient {
  async simulate({ document }: SimInput): Promise<SimVerdict> {
    const score = 40 + (hash(document) % 55); // stable pseudo-score per input
    return {
      summary: `[MOCK] Simulated reception is moderately positive (score ${score}).`,
      score,
      source: "mock",
      scenarios: [
        { name: "bull", outcome: "Enthusiastic early adopters amplify it; sentiment trends up." },
        { name: "bear", outcome: "A vocal minority pushes back on price/balance; churn risk." },
        { name: "neutral", outcome: "Mild interest, no strong reaction either way." },
      ],
      citations: [
        "[MOCK post] \"honestly kinda into this\"",
        "[MOCK trade] prediction-market odds settle ~62% positive",
      ],
    };
  }
}

/** Shape of MiroShark's machine-readable signal.json (GET /api/simulation/<id>/signal.json). */
interface MiroSharkSignal {
  direction?: "Bullish" | "Neutral" | "Bearish" | string;
  confidence_pct?: number;
  risk_tier?: string;
  bullish_pct?: number;
  neutral_pct?: number;
  bearish_pct?: number;
  quality_health?: string;
}

/** Shape of GET /api/simulation/<id>/posts — raw `post` SQLite rows, no envelope beyond `data`. */
interface MiroSharkPostsResponse {
  success?: boolean;
  data?: { posts?: Array<{ content?: string; user_id?: number; created_at?: string }> };
}

type MiroSharkEnvelope<T = unknown> = { success: boolean; data?: T; error?: string };

/**
 * Real client — hits a running MiroShark HTTP API (Swagger at /api/docs).
 *
 * MiroShark is a standalone Python + Neo4j swarm-sim service; it does NOT run on
 * Vercel. This client is only constructed when MIROSHARK_URL is set (see
 * getSimClient) — the app defaults to MockSimClient so it deploys green with no
 * infra.
 *
 * There is no single-shot `/api/simulate` endpoint. The real flow is ~10
 * sequential/polling calls: build a project + ontology from `document` (plus any
 * `urlDocs`) → build the Neo4j graph → create the simulation → generate agent
 * profiles ("prepare") → run it → publish → read back signal.json + posts.
 */
export class MiroSharkClient implements SimClient {
  constructor(
    private baseUrl: string,
    private opts: {
      apiKey?: string;
      /** Bearer token for the admin-gated /publish step. Without it, signal.json can't be
       *  read (publish-gated) — simulate() still returns citations from /posts. */
      adminToken?: string;
      /** Per-HTTP-call abort timeout. Polling loops have their own overall timeouts below. */
      requestTimeoutMs?: number;
      graphBuildTimeoutMs?: number;
      prepareTimeoutMs?: number;
      runTimeoutMs?: number;
    } = {},
  ) {}

  private async request<T = unknown>(
    method: string,
    path: string,
    init: { json?: unknown; form?: FormData; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.requestTimeoutMs ?? 30_000);

    try {
      const headers: Record<string, string> = {
        ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
        ...init.headers,
      };
      const fetchInit: RequestInit = { method, headers, signal: controller.signal };
      if (init.form) {
        fetchInit.body = init.form; // FormData sets its own multipart Content-Type/boundary
      } else if (init.json !== undefined) {
        headers["content-type"] = "application/json";
        fetchInit.body = JSON.stringify(init.json);
      }

      const res = await fetch(url, fetchInit);
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }

      const envelope = body as MiroSharkEnvelope;
      if (!res.ok || envelope?.success === false) {
        const message = typeof body === "string" ? body : envelope?.error ?? res.statusText;
        throw new Error(`MiroShark ${method} ${path} failed (${res.status}): ${message}`);
      }
      return body as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async poll<T>(
    fn: () => Promise<T>,
    isDone: (result: T) => boolean,
    { intervalMs, timeoutMs, label }: { intervalMs: number; timeoutMs: number; label: string },
  ): Promise<T> {
    const start = Date.now();
    while (true) {
      const result = await fn();
      if (isDone(result)) return result;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`MiroShark ${label} timed out after ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  async simulate({ document, urlDocs, options = {} }: SimInput): Promise<SimVerdict> {
    const platforms = options.platforms ?? ["threads", "facebook"];
    const enableThreads = platforms.includes("threads");
    const enableFacebook = platforms.includes("facebook");
    const enableTiktok = platforms.includes("tiktok");
    const enablePolymarket = options.market ?? false;
    const country = options.country ?? "vn";
    const maxRounds = options.maxRounds ?? 3;
    const simulationRequirement =
      options.simulationRequirement ?? `Simulate social media reaction to: ${document.slice(0, 300)}`;
    const projectName = options.projectName ?? `sim-${Date.now()}`;

    // 1. Build a project + ontology from `document` (and any pre-scraped `urlDocs`).
    const form = new FormData();
    form.append("files", new Blob([document], { type: "text/plain" }), "document.txt");
    if (urlDocs?.length) {
      form.append("url_docs", JSON.stringify(urlDocs));
    }
    form.append("simulation_requirement", simulationRequirement);
    form.append("project_name", projectName);

    const ontology = await this.request<MiroSharkEnvelope<{ project_id: string }>>(
      "POST",
      "/api/graph/ontology/generate",
      { form },
    );
    const projectId = ontology.data!.project_id;

    // 2–3. Ingest the corpus into Neo4j, polling the background task to completion.
    const build = await this.request<MiroSharkEnvelope<{ task_id: string }>>("POST", "/api/graph/build", {
      json: { project_id: projectId },
    });
    const buildTask = await this.poll(
      () =>
        this.request<MiroSharkEnvelope<{ status: string; result?: { graph_id?: string } }>>(
          "GET",
          `/api/graph/task/${build.data!.task_id}`,
        ),
      (result) => result.data?.status === "completed" || result.data?.status === "failed",
      { intervalMs: 3000, timeoutMs: this.opts.graphBuildTimeoutMs ?? 5 * 60_000, label: "graph build" },
    );
    if (buildTask.data?.status !== "completed") {
      throw new Error("MiroShark graph build did not complete");
    }
    const graphId = buildTask.data.result?.graph_id;
    if (!graphId) throw new Error("MiroShark graph build completed with no graph_id");

    // 4. Create the simulation against that graph.
    const created = await this.request<MiroSharkEnvelope<{ simulation_id: string }>>(
      "POST",
      "/api/simulation/create",
      {
        json: {
          project_id: projectId,
          graph_id: graphId,
          enable_threads: enableThreads,
          enable_facebook: enableFacebook,
          enable_polymarket: enablePolymarket,
          enable_tiktok: enableTiktok,
          country,
        },
      },
    );
    const simulationId = created.data!.simulation_id;

    // 5–6. Generate agent profiles, polling until ready.
    const prepared = await this.request<MiroSharkEnvelope<{ task_id: string }>>("POST", "/api/simulation/prepare", {
      json: { simulation_id: simulationId },
    });
    const prepareStatus = await this.poll(
      () =>
        this.request<MiroSharkEnvelope<{ status: string }>>("POST", "/api/simulation/prepare/status", {
          json: { simulation_id: simulationId, task_id: prepared.data!.task_id },
        }),
      (result) => result.data?.status === "ready" || result.data?.status === "failed",
      { intervalMs: 3000, timeoutMs: this.opts.prepareTimeoutMs ?? 10 * 60_000, label: "prepare" },
    );
    if (prepareStatus.data?.status !== "ready") {
      throw new Error("MiroShark simulation prepare did not become ready");
    }

    // 7–8. Run the simulation, polling until it finishes.
    const activePlatforms = [enableThreads && "threads", enableFacebook && "facebook", enableTiktok && "tiktok"]
      .filter((v): v is string => Boolean(v));
    const platformArg = activePlatforms.length === 1 ? activePlatforms[0] : "parallel";
    await this.request("POST", "/api/simulation/start", {
      json: { simulation_id: simulationId, platform: platformArg, max_rounds: maxRounds },
    });
    const runStatus = await this.poll(
      () =>
        this.request<MiroSharkEnvelope<{ runner_status: string }>>(
          "GET",
          `/api/simulation/${simulationId}/run-status`,
        ),
      (result) => ["completed", "failed"].includes(result.data?.runner_status ?? ""),
      { intervalMs: 2000, timeoutMs: this.opts.runTimeoutMs ?? 10 * 60_000, label: "run" },
    );
    if (runStatus.data?.runner_status !== "completed") {
      throw new Error("MiroShark simulation run did not complete");
    }

    // 9–10. Publish (admin-gated — required for signal.json) and read back the verdict + citations.
    if (this.opts.adminToken) {
      await this.request("POST", `/api/simulation/${simulationId}/publish`, {
        json: { public: true },
        headers: { authorization: `Bearer ${this.opts.adminToken}` },
      });
    }

    const [signal, posts] = await Promise.all([
      this.opts.adminToken
        ? this.request<MiroSharkSignal>("GET", `/api/simulation/${simulationId}/signal.json`).catch(() => null)
        : Promise.resolve(null),
      this.request<MiroSharkPostsResponse>("GET", `/api/simulation/${simulationId}/posts`).catch(() => null),
    ]);

    return mapVerdict(signal, posts);
  }
}

/** Map MiroShark's signal.json + /posts onto our SimVerdict. `signal` is null when
 *  MIROSHARK_ADMIN_TOKEN isn't configured (publish-gated) — citations still come through. */
function mapVerdict(signal: MiroSharkSignal | null, posts: MiroSharkPostsResponse | null): SimVerdict {
  const bullish = signal?.bullish_pct ?? 0;
  const neutral = signal?.neutral_pct ?? 0;
  const bearish = signal?.bearish_pct ?? 0;
  const score = clampScore(signal?.confidence_pct ?? bullish);

  const scenarios: SimScenario[] = signal
    ? [
        { name: "bull", outcome: `Bullish: ${bullish.toFixed(1)}% of final-round belief.` },
        { name: "neutral", outcome: `Neutral: ${neutral.toFixed(1)}% of final-round belief.` },
        { name: "bear", outcome: `Bearish: ${bearish.toFixed(1)}% of final-round belief.` },
      ]
    : [];

  const citations: string[] = (posts?.data?.posts ?? [])
    .slice(0, 10)
    .map((post) => (post.content ? `user#${post.user_id ?? "?"}: ${post.content}` : ""))
    .filter(Boolean);

  const summary = signal
    ? `${signal.direction ?? "Neutral"} (${score}% confidence, ${signal.risk_tier ?? "unknown"} risk).`
    : `Simulation completed; ${citations.length} post(s) captured (set MIROSHARK_ADMIN_TOKEN to also publish a signal.json verdict).`;

  return { summary, score, source: "miroshark", scenarios, citations, raw: { signal, posts } };
}

function clampScore(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return 50;
  // Accept both 0–1 and 0–100 conventions.
  const scaled = num > 0 && num <= 1 ? num * 100 : num;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

/**
 * Returns the real MiroShark client only when MIROSHARK_URL is set; otherwise the
 * deterministic mock. The mock stays the default so the app runs with zero infra.
 */
export function getSimClient(): SimClient {
  const url = process.env.MIROSHARK_URL;
  if (!url) return new MockSimClient();
  return new MiroSharkClient(url, {
    apiKey: process.env.MIROSHARK_API_KEY,
    adminToken: process.env.MIROSHARK_ADMIN_TOKEN,
    requestTimeoutMs: process.env.MIROSHARK_TIMEOUT_MS ? Number(process.env.MIROSHARK_TIMEOUT_MS) : undefined,
  });
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
