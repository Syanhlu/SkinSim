#!/usr/bin/env node
// Starts Neo4j (docker) + the MiroShark backend, waits for it to be healthy,
// then starts this app's Next dev server pointed at it via MIROSHARK_URL.
// MiroShark itself still needs its own configured .env (LLM key + NEO4J_PASSWORD) —
// this script won't fill those in for you, it just orchestrates the processes.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, copyFileSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");
const MIROSHARK_DIR = process.env.MIROSHARK_DIR
  ? path.resolve(process.env.MIROSHARK_DIR)
  : path.resolve(APP_DIR, "..", "MiroShark");
const BACKEND_DIR = path.join(MIROSHARK_DIR, "backend");
const BACKEND_PORT = 5001;
const NEO4J_BOLT_PORT = 7687;
const MIROSHARK_URL = `http://localhost:${BACKEND_PORT}`;
const isWin = process.platform === "win32";

const log = (msg) => console.log(`[dev:miroshark] ${msg}`);
const warn = (msg) => console.warn(`[dev:miroshark] WARN: ${msg}`);
const fail = (msg) => {
  console.error(`[dev:miroshark] ERROR: ${msg}`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: isWin, ...opts });
  return res.status === 0;
}

function waitForPort(port, host = "127.0.0.1", timeoutMs = 45000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    (function attempt() {
      const socket = createConnection({ port, host });
      socket.once("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) return resolve(false);
        setTimeout(attempt, 1000);
      });
    })();
  });
}

function waitForHealth(url, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    (function attempt() {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry();
      });
      req.on("error", retry);
      function retry() {
        if (Date.now() > deadline) return resolve(false);
        setTimeout(attempt, 1500);
      }
    })();
  });
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf8");
}

function envHasValue(text, key) {
  return new RegExp(`^${key}=.+\\S`, "m").test(text);
}

// ── 1. Locate MiroShark ──────────────────────────────────────────────────
if (!existsSync(MIROSHARK_DIR)) {
  fail(`MiroShark not found at ${MIROSHARK_DIR}. Set MIROSHARK_DIR to override.`);
}

// ── 2. MiroShark must already have a filled-in .env — this script starts
//      processes, it doesn't choose API keys for you. ──────────────────────
const mirosharkEnvPath = path.join(MIROSHARK_DIR, ".env");
let mirosharkEnvText = readEnvFile(mirosharkEnvPath);
if (mirosharkEnvText === null) {
  const examplePath = path.join(MIROSHARK_DIR, ".env.example");
  if (!existsSync(examplePath)) fail(`No .env or .env.example in ${MIROSHARK_DIR}`);
  copyFileSync(examplePath, mirosharkEnvPath);
  fail(
    `Created ${mirosharkEnvPath} from .env.example — paste your LLM key into the ` +
      `blank *_API_KEY slots and set NEO4J_PASSWORD, then re-run this command.`
  );
}
const usesClaudeCode = /^LLM_PROVIDER=claude-code/m.test(mirosharkEnvText);
if (!usesClaudeCode && !envHasValue(mirosharkEnvText, "LLM_API_KEY")) {
  fail(`${mirosharkEnvPath} is missing LLM_API_KEY. Paste your key in, then re-run.`);
}
if (
  !envHasValue(mirosharkEnvText, "NEO4J_PASSWORD") ||
  /^NEO4J_PASSWORD=CHANGE_ME/m.test(mirosharkEnvText)
) {
  fail(`${mirosharkEnvPath} needs a real NEO4J_PASSWORD (not the placeholder). Set one, then re-run.`);
}

// ── 3. Neo4j via docker compose ──────────────────────────────────────────
log("Starting Neo4j (docker compose)...");
if (!run("docker", ["compose", "up", "-d", "neo4j"], { cwd: MIROSHARK_DIR })) {
  fail("`docker compose up -d neo4j` failed — is Docker running?");
}
log(`Waiting for Neo4j on port ${NEO4J_BOLT_PORT}...`);
if (!(await waitForPort(NEO4J_BOLT_PORT, "127.0.0.1", 45000))) {
  fail(`Neo4j did not come up on port ${NEO4J_BOLT_PORT} within 45s. Check: docker compose logs neo4j`);
}
log("Neo4j is up.");

// ── 4. Backend deps ──────────────────────────────────────────────────────
if (!existsSync(path.join(BACKEND_DIR, ".venv"))) {
  log("Installing MiroShark backend deps (uv sync)...");
  if (!run("uv", ["sync"], { cwd: BACKEND_DIR })) fail("`uv sync` failed.");
}

// ── 5. Start the MiroShark backend (never its Vue frontend — unused here) ──
log("Starting MiroShark backend (uv run python run.py)...");
const backend = spawn("uv", ["run", "python", "run.py"], {
  cwd: BACKEND_DIR,
  stdio: "inherit",
  shell: isWin,
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("Shutting down MiroShark backend...");
  if (isWin) {
    spawnSync("taskkill", ["/pid", String(backend.pid), "/t", "/f"]);
  } else {
    backend.kill("SIGTERM");
  }
}
process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
backend.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(`[dev:miroshark] MiroShark backend exited unexpectedly (code ${code})`);
    process.exit(code ?? 1);
  }
});

// ── 6. Wait for it to actually be healthy, not just listening ──────────────
log("Waiting for MiroShark backend health check...");
const healthy = await waitForHealth(`${MIROSHARK_URL}/health`, 60000);
if (!healthy) {
  fail(`MiroShark backend didn't become healthy at ${MIROSHARK_URL}/health within 60s. See log output above.`);
}
log(`MiroShark backend is healthy at ${MIROSHARK_URL}`);

// ── 7. Sanity-check this app's own env for the admin token, which gates
//      real (non-zero) reception scores — warn, don't block. ──────────────
const appEnvText = readEnvFile(path.join(APP_DIR, ".env.local")) ?? readEnvFile(path.join(APP_DIR, ".env")) ?? "";
if (!envHasValue(appEnvText, "MIROSHARK_ADMIN_TOKEN")) {
  warn(
    "MIROSHARK_ADMIN_TOKEN isn't set in this app's .env.local. simulate_reception() will " +
      "still run, but reception scores will come back 0 (signal.json is publish-gated). " +
      "Set the same MIROSHARK_ADMIN_TOKEN value in both MiroShark/.env and this app's .env.local."
  );
}

// ── 8. Start Next, pointed at the backend we just started ──────────────────
// `npm run dev` (not `npx next dev`) so resolution always prefers this app's own
// node_modules/.bin instead of npx's walk-up-the-tree behavior finding something else.
if (!existsSync(path.join(APP_DIR, "node_modules"))) {
  log("node_modules missing — running npm install...");
  if (!run("npm", ["install"], { cwd: APP_DIR })) fail("npm install failed.");
}
log("Starting Next.js dev server...");
const next = spawn("npm", ["run", "dev"], {
  cwd: APP_DIR,
  stdio: "inherit",
  shell: isWin,
  env: { ...process.env, MIROSHARK_URL: process.env.MIROSHARK_URL || MIROSHARK_URL },
});
next.on("exit", (code) => {
  shutdown();
  process.exit(code ?? 0);
});
