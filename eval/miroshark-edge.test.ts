import assert from "node:assert/strict";

import { MiroSharkClient, getSimClient } from "../lib/miroshark/client";
import { buildScrapeContext, fetchUrls } from "../lib/miroshark/scrape-context";

type TestFn = () => Promise<void> | void;
type FlowStep =
  | "ontology"
  | "graphBuild"
  | "graphTask"
  | "create"
  | "prepare"
  | "prepareStatus"
  | "start"
  | "runStatus"
  | "publish"
  | "signal"
  | "posts";

interface FetchCall {
  method: string;
  url: string;
  path: string;
  init: RequestInit;
}

interface FlowState {
  graphTaskPolls: number;
  preparePolls: number;
  runPolls: number;
}

type FlowOverride =
  | Response
  | ((call: FetchCall, state: FlowState) => Response | Promise<Response>);

const tests: Array<{ name: string; fn: TestFn }> = [];
const ENV_KEYS = [
  "MIROSHARK_URL",
  "MIROSHARK_API_KEY",
  "MIROSHARK_ADMIN_TOKEN",
  "MIROSHARK_TIMEOUT_MS",
  "TINYFISH_API_KEY",
] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_DATE_NOW = Date.now;
const ORIGINAL_SET_TIMEOUT = globalThis.setTimeout;
const ORIGINAL_CLEAR_TIMEOUT = globalThis.clearTimeout;

const stepLabels: Record<FlowStep, string> = {
  ontology: "ontology generate",
  graphBuild: "graph build submit",
  graphTask: "graph build status",
  create: "simulation create",
  prepare: "simulation prepare submit",
  prepareStatus: "simulation prepare status",
  start: "simulation start",
  runStatus: "simulation run status",
  publish: "simulation publish",
  signal: "signal.json",
  posts: "simulation posts",
};

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

function resetState(): void {
  globalThis.fetch = ORIGINAL_FETCH;
  Date.now = ORIGINAL_DATE_NOW;
  globalThis.setTimeout = ORIGINAL_SET_TIMEOUT;
  globalThis.clearTimeout = ORIGINAL_CLEAR_TIMEOUT;
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key as (typeof ENV_KEYS)[number]];
    else process.env[key as (typeof ENV_KEYS)[number]] = value;
  }
}

function installFetch(
  fn: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
): void {
  globalThis.fetch = fn as typeof fetch;
}

function jsonResponse(body: unknown, status = 200, statusText = "OK"): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status = 200, statusText = "OK", contentType = "text/plain"): Response {
  return new Response(body, {
    status,
    statusText,
    headers: { "content-type": contentType },
  });
}

function toUrlString(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function headersOf(init: RequestInit): Headers {
  return new Headers(init.headers);
}

function jsonBody(init: RequestInit): unknown {
  assert.equal(typeof init.body, "string");
  return JSON.parse(init.body as string);
}

function resolveFlowStep(method: string, path: string): FlowStep {
  if (method === "POST" && path === "/api/graph/ontology/generate") return "ontology";
  if (method === "POST" && path === "/api/graph/build") return "graphBuild";
  if (method === "GET" && /^\/api\/graph\/task\/[^/]+$/.test(path)) return "graphTask";
  if (method === "POST" && path === "/api/simulation/create") return "create";
  if (method === "POST" && path === "/api/simulation/prepare") return "prepare";
  if (method === "POST" && path === "/api/simulation/prepare/status") return "prepareStatus";
  if (method === "POST" && path === "/api/simulation/start") return "start";
  if (method === "GET" && /^\/api\/simulation\/[^/]+\/run-status$/.test(path)) return "runStatus";
  if (method === "POST" && /^\/api\/simulation\/[^/]+\/publish$/.test(path)) return "publish";
  if (method === "GET" && /^\/api\/simulation\/[^/]+\/signal\.json$/.test(path)) return "signal";
  if (method === "GET" && /^\/api\/simulation\/[^/]+\/posts$/.test(path)) return "posts";
  throw new Error(`Unexpected MiroShark fetch: ${method} ${path}`);
}

function createMiroSharkFetch(overrides: Partial<Record<FlowStep, FlowOverride>> = {}) {
  const calls: FetchCall[] = [];
  const state: FlowState = { graphTaskPolls: 0, preparePolls: 0, runPolls: 0 };

  const fetchMock = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = toUrlString(input);
    const parsed = new URL(url);
    const method = (init.method ?? "GET").toUpperCase();
    const path = parsed.pathname;
    const step = resolveFlowStep(method, path);
    const call: FetchCall = { method, url, path, init };
    calls.push(call);

    const override = overrides[step];
    if (override) {
      return typeof override === "function" ? override(call, state) : override;
    }

    switch (step) {
      case "ontology": {
        assert.ok(init.body instanceof FormData, "ontology generate must use multipart FormData");
        assert.equal(headersOf(init).get("content-type"), null, "FormData must set its own multipart boundary");
        return jsonResponse({ success: true, data: { project_id: "project-1" } });
      }
      case "graphBuild":
        assert.deepEqual(jsonBody(init), { project_id: "project-1" });
        return jsonResponse({ success: true, data: { task_id: "graph-task-1" } });
      case "graphTask":
        state.graphTaskPolls += 1;
        return jsonResponse({
          success: true,
          data: { status: "completed", result: { graph_id: "graph-1" } },
        });
      case "create":
        assert.equal((jsonBody(init) as { project_id?: string }).project_id, "project-1");
        return jsonResponse({ success: true, data: { simulation_id: "simulation-1" } });
      case "prepare":
        assert.deepEqual(jsonBody(init), { simulation_id: "simulation-1" });
        return jsonResponse({ success: true, data: { task_id: "prepare-task-1" } });
      case "prepareStatus":
        state.preparePolls += 1;
        return jsonResponse({ success: true, data: { status: "ready" } });
      case "start":
        assert.equal((jsonBody(init) as { simulation_id?: string }).simulation_id, "simulation-1");
        return jsonResponse({ success: true, data: { started: true } });
      case "runStatus":
        state.runPolls += 1;
        return jsonResponse({ success: true, data: { runner_status: "completed" } });
      case "publish":
        assert.equal(headersOf(init).get("authorization"), "Bearer admin-token");
        return jsonResponse({ success: true, data: { published: true } });
      case "signal":
        return jsonResponse({
          direction: "Bullish",
          confidence_pct: 0.73,
          risk_tier: "low",
          bullish_pct: 61,
          neutral_pct: 30,
          bearish_pct: 9,
          quality_health: "ok",
        });
      case "posts":
        return jsonResponse({
          success: true,
          data: { posts: [{ user_id: 7, content: "This looks useful", created_at: "2026-07-11" }] },
        });
    }
  };

  return { fetchMock, calls, state };
}

async function simulateWith(
  fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
  opts: ConstructorParameters<typeof MiroSharkClient>[1] = {},
) {
  installFetch(fetchMock);
  const client = new MiroSharkClient("https://miro.test/", {
    adminToken: "admin-token",
    requestTimeoutMs: 500,
    ...opts,
  });
  return client.simulate({
    document: "A compact Arena of Valor skin concept aimed at Vietnam players.",
    options: { projectName: "edge-test", maxRounds: 1 },
  });
}

async function assertRejectsIncludes(fn: () => Promise<unknown>, includes: string[]): Promise<void> {
  let thrown: unknown;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, "expected promise to reject");
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  for (const part of includes) {
    assert.ok(message.includes(part), `expected "${message}" to include "${part}"`);
  }
}

function statusFailure(status: number): Response {
  return jsonResponse({ success: false, error: `forced ${status}` }, status, `forced-${status}`);
}

test("getSimClient returns deterministic mock when MIROSHARK_URL is unset or empty", async () => {
  installFetch(() => {
    throw new Error("fetch should not be called by MockSimClient");
  });

  setEnv({ MIROSHARK_URL: undefined });
  const unsetA = await getSimClient().simulate({ document: "same document" });
  const unsetB = await getSimClient().simulate({ document: "same document" });
  assert.equal(unsetA.source, "mock");
  assert.equal(unsetA.score, unsetB.score);

  setEnv({ MIROSHARK_URL: "" });
  const empty = await getSimClient().simulate({ document: "same document" });
  assert.equal(empty.source, "mock");
  assert.equal(empty.score, unsetA.score);
});

test("happy path uses multipart ontology, raw signal.json, publish auth, and trimmed trailing slash", async () => {
  const { fetchMock, calls } = createMiroSharkFetch();
  installFetch(fetchMock);
  setEnv({
    MIROSHARK_URL: "https://miro.test/",
    MIROSHARK_API_KEY: "api-token",
    MIROSHARK_ADMIN_TOKEN: "admin-token",
  });

  const verdict = await getSimClient().simulate({
    document: "Launch a limited skin bundle for Vietnam players.",
    options: { projectName: "edge-test", maxRounds: 1 },
  });

  assert.equal(verdict.source, "miroshark");
  assert.equal(verdict.score, 73);
  assert.equal(verdict.citations.length, 1);
  assert.ok(calls.every((call) => call.url.startsWith("https://miro.test/api/")));
  assert.ok(calls.every((call) => !call.url.startsWith("https://miro.test//api/")));
  assert.ok(calls.some((call) => call.path.endsWith("/signal.json")), "signal.json should be fetched raw");
});

test("envelope success:false errors identify the failing ontology step", async () => {
  for (const body of [
    { success: false, error: "ontology broke" },
    { success: false },
  ]) {
    const { fetchMock } = createMiroSharkFetch({ ontology: () => jsonResponse(body) });
    await assertRejectsIncludes(() => simulateWith(fetchMock), [
      "ontology generate",
      body.error ?? "success:false",
    ]);
  }
});

test("missing or null envelope data fails before property access with the step label", async () => {
  for (const body of [{ success: true }, { success: true, data: null }]) {
    const { fetchMock } = createMiroSharkFetch({ ontology: () => jsonResponse(body) });
    await assertRejectsIncludes(() => simulateWith(fetchMock), ["ontology generate", "data"]);
  }
});

test("non-JSON, HTML, and empty 200 envelope bodies fail with useful step errors", async () => {
  for (const response of [
    () => textResponse("not-json"),
    () => textResponse("<html>bad gateway</html>", 200, "OK", "text/html"),
    () => textResponse(""),
  ]) {
    const { fetchMock } = createMiroSharkFetch({ graphBuild: response });
    await assertRejectsIncludes(() => simulateWith(fetchMock), ["graph build submit"]);
  }
});

test("HTTP 500/502/429 failures identify every hard MiroShark flow step", async () => {
  const hardSteps: FlowStep[] = [
    "ontology",
    "graphBuild",
    "graphTask",
    "create",
    "prepare",
    "prepareStatus",
    "start",
    "runStatus",
    "publish",
  ];

  for (const step of hardSteps) {
    for (const status of [500, 502, 429]) {
      const { fetchMock } = createMiroSharkFetch({ [step]: () => statusFailure(status) });
      await assertRejectsIncludes(() => simulateWith(fetchMock), [stepLabels[step], String(status)]);
    }
  }
});

test("optional signal.json and posts readback HTTP failures do not fail the completed simulation", async () => {
  for (const step of ["signal", "posts"] as const) {
    const { fetchMock } = createMiroSharkFetch({ [step]: () => statusFailure(502) });
    const verdict = await simulateWith(fetchMock);
    assert.equal(verdict.source, "miroshark");
  }
});

test("run polling timeout fires quickly with the last observed status", async () => {
  let sawRunPoll = false;
  Date.now = () => (sawRunPoll ? 600_001 : 0);
  const { fetchMock } = createMiroSharkFetch({
    runStatus: () => {
      sawRunPoll = true;
      return jsonResponse({ success: true, data: { runner_status: "running" } });
    },
  });

  await assertRejectsIncludes(() => simulateWith(fetchMock), ["simulation run", "timed out", "running"]);
});

test("run polling failed status reports the failed terminal state", async () => {
  const { fetchMock } = createMiroSharkFetch({
    runStatus: () => jsonResponse({ success: true, data: { runner_status: "failed" } }),
  });

  await assertRejectsIncludes(() => simulateWith(fetchMock), ["simulation run", "failed"]);
});

test("run polling rejects an unexpected state instead of waiting for the full timeout", async () => {
  let polls = 0;
  Date.now = () => (polls >= 2 ? 600_001 : 0);
  globalThis.setTimeout = ((handler: TimerHandler, _timeout?: number, ...args: unknown[]) => {
    if (typeof handler === "function") queueMicrotask(() => handler(...args));
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;

  const { fetchMock } = createMiroSharkFetch({
    runStatus: () => {
      polls += 1;
      return jsonResponse({
        success: true,
        data: { runner_status: polls === 1 ? "running" : "sideways" },
      });
    },
  });

  await assertRejectsIncludes(() => simulateWith(fetchMock), [
    "simulation run",
    "unexpected",
    "sideways",
  ]);
});

test("scrape context returns [] without TinyFish key or MiroShark URL", async () => {
  installFetch(() => {
    throw new Error("fetch should not be called when no scraper is configured");
  });
  setEnv({ TINYFISH_API_KEY: undefined, MIROSHARK_URL: undefined });

  const docs = await buildScrapeContext({
    searchQuery: "arena of valor vietnam",
    referenceUrls: ["https://example.com/a"],
  });
  assert.deepEqual(docs, []);
});

test("scrape search HTTP failure returns [] and never throws", async () => {
  setEnv({ TINYFISH_API_KEY: "tiny-key", MIROSHARK_URL: undefined });
  installFetch((input) => {
    assert.ok(toUrlString(input).startsWith("https://api.search.tinyfish.ai"));
    return textResponse("down", 500, "Internal Server Error");
  });

  const docs = await buildScrapeContext({ searchQuery: "arena of valor vietnam" });
  assert.deepEqual(docs, []);
});

test("TinyFish all-URL errors return [] without failing the batch", async () => {
  setEnv({ TINYFISH_API_KEY: "tiny-key", MIROSHARK_URL: undefined });
  installFetch((input) => {
    assert.equal(toUrlString(input), "https://api.fetch.tinyfish.ai");
    return jsonResponse({
      results: [],
      errors: [
        { url: "https://example.com/a", error: "blocked" },
        { url: "https://example.com/b", error: "timeout" },
      ],
    });
  });

  const docs = await buildScrapeContext({
    referenceUrls: ["https://example.com/a", "https://example.com/b"],
  });
  assert.deepEqual(docs, []);
});

test("TinyFish partial URL errors keep successful results", async () => {
  setEnv({ TINYFISH_API_KEY: "tiny-key", MIROSHARK_URL: undefined });
  installFetch(() =>
    jsonResponse({
      results: [{ url: "https://example.com/a", title: "A", text: "kept" }],
      errors: [{ url: "https://example.com/b", error: "blocked" }],
    }),
  );

  const docs = await buildScrapeContext({
    referenceUrls: ["https://example.com/a", "https://example.com/b"],
  });
  assert.deepEqual(docs, [{ title: "A", url: "https://example.com/a", text: "kept" }]);
});

test("scrape context truncates oversized TinyFish text", async () => {
  setEnv({ TINYFISH_API_KEY: "tiny-key", MIROSHARK_URL: undefined });
  installFetch(() =>
    jsonResponse({
      results: [{ url: "https://example.com/a", title: "A", text: "abcdefghijklmnopqrstuvwxyz" }],
    }),
  );

  const docs = await buildScrapeContext({
    referenceUrls: ["https://example.com/a"],
    maxCharsPerDoc: 7,
  });
  assert.equal(docs[0]?.text, "abcdefg");
});

test("duplicate URLs are deduped before TinyFish fetch", async () => {
  const batches: string[][] = [];
  setEnv({ TINYFISH_API_KEY: "tiny-key", MIROSHARK_URL: undefined });
  installFetch((_input, init = {}) => {
    const body = jsonBody(init) as { urls: string[] };
    batches.push(body.urls);
    return jsonResponse({ results: [] });
  });

  await buildScrapeContext({
    referenceUrls: ["https://example.com/a", "https://example.com/a", "https://example.com/b"],
    maxDocs: 5,
  });
  assert.deepEqual(batches, [["https://example.com/a", "https://example.com/b"]]);
});

test("more than 10 URLs are split into TinyFish batches", async () => {
  const batches: string[][] = [];
  const urls = Array.from({ length: 12 }, (_, index) => `https://example.com/${index}`);
  setEnv({ TINYFISH_API_KEY: "tiny-key", MIROSHARK_URL: undefined });
  installFetch((_input, init = {}) => {
    const body = jsonBody(init) as { urls: string[] };
    batches.push(body.urls);
    return jsonResponse({
      results: body.urls.map((url) => ({ url, title: url, text: `text for ${url}` })),
    });
  });

  const docs = await buildScrapeContext({ referenceUrls: urls, maxDocs: 12 });
  assert.equal(docs.length, 12);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [10, 2],
  );
});

test("malformed TinyFish result text never escapes buildScrapeContext", async () => {
  setEnv({ TINYFISH_API_KEY: "tiny-key", MIROSHARK_URL: undefined });
  installFetch(() =>
    jsonResponse({
      results: [{ url: "https://example.com/a", title: "A", text: { nested: true } }],
    }),
  );

  const docs = await buildScrapeContext({ referenceUrls: ["https://example.com/a"] });
  assert.deepEqual(docs, []);
});

test("MiroShark fetch-url fallback treats empty URL env as not configured", async () => {
  installFetch(() => {
    throw new Error("fetch should not be called for empty MIROSHARK_URL");
  });
  setEnv({ TINYFISH_API_KEY: undefined, MIROSHARK_URL: "" });
  assert.deepEqual(await fetchUrls(["https://example.com/a"]), []);

  setEnv({ MIROSHARK_URL: undefined });
  assert.deepEqual(await fetchUrls(["https://example.com/a"]), []);
});

test("MiroShark fetch-url fallback trims a trailing slash", async () => {
  let calledUrl = "";
  setEnv({ TINYFISH_API_KEY: undefined, MIROSHARK_URL: "https://miro.test/" });
  installFetch((input) => {
    calledUrl = toUrlString(input);
    return jsonResponse({
      success: true,
      data: { title: "Fetched", url: "https://example.com/a", text: "body" },
    });
  });

  const docs = await fetchUrls(["https://example.com/a"]);
  assert.equal(calledUrl, "https://miro.test/api/graph/fetch-url");
  assert.deepEqual(docs, [{ title: "Fetched", url: "https://example.com/a", text: "body" }]);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    resetState();
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  } finally {
    resetState();
  }
}

if (failed > 0) {
  console.error(`${failed}/${tests.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`${tests.length}/${tests.length} passed`);
}
