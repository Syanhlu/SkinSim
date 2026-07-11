#!/usr/bin/env -S npx tsx
// Smoke test for the gen_skins -> simulate_reception -> pick_best -> to_3d pipeline
// (lib/gen.ts), with a focus on the MiroShark leg (lib/sim-client.ts).
//
// Zero-config mode (no MIROSHARK_URL): runs the whole pipeline against MockSimClient
// and just proves it completes with a well-formed result — this is what CI runs.
// Live mode (MIROSHARK_URL set): also asserts the miroshark service actually reported
// "live", not a silent fallback to the mock, so a misconfigured/unreachable MiroShark
// deployment fails the smoke test instead of quietly degrading.
//
// Usage:
//   npm run smoke:miroshark
//   npm run smoke:miroshark -- --theme="mythic-luxury__celestial-dragon__oracle"
//   npm run smoke:miroshark -- --platforms=threads,tiktok --country=vn --max-rounds=5
//   MIROSHARK_URL=http://localhost:5001 npm run smoke:miroshark -- --market=false
//   npm run smoke:miroshark -- --help

import { runGenerationPipeline, type GenerationPipelineResult } from "../lib/gen";
import type { SimOptions } from "../lib/sim-client";

const DEFAULT_THEME = "smoke-test__theme__ping";
const VALID_PLATFORMS = ["threads", "facebook", "tiktok"];

interface CliOptions {
  theme: string;
  simOptions: SimOptions;
}

function printHelp() {
  console.log(`Usage: npm run smoke:miroshark -- [flags]

Flags:
  --theme=<string>          Theme fed into gen_skins. Default: "${DEFAULT_THEME}"
  --platforms=<list>        Comma-separated subset of ${VALID_PLATFORMS.join("|")}. Default: threads,facebook
  --country=<code>          Locale MiroShark's persona grounding understands. Default: vn
  --max-rounds=<n>          Simulated rounds to run (cost scales with this). Default: 3
  --market=<true|false>     Also run the prediction-market simulation. Default: true
  --requirement=<string>    Free-text steer for what MiroShark's ontology/agents should focus on.
  --project-name=<string>   Overrides the auto-generated MiroShark project name.
  --help                    Show this message.

Env (unchanged, control which backend is hit — see .env.example):
  MIROSHARK_URL, MIROSHARK_API_KEY, MIROSHARK_ADMIN_TOKEN, MIROSHARK_TIMEOUT_MS,
  MIROSHARK_SCRAPE_ENABLED, TINYFISH_API_KEY`);
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { theme: DEFAULT_THEME, simOptions: {} };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) {
      console.error(`✗ Unrecognized argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
    const [, rawKey, rawValue] = match;
    const value = rawValue ?? "true";

    switch (rawKey) {
      case "theme":
        opts.theme = value;
        break;
      case "platforms": {
        const platforms = value.split(",").map((p) => p.trim()).filter(Boolean);
        const invalid = platforms.filter((p) => !VALID_PLATFORMS.includes(p));
        if (invalid.length > 0) {
          console.error(`✗ Unknown platform(s): ${invalid.join(", ")} (valid: ${VALID_PLATFORMS.join(", ")})`);
          process.exit(1);
        }
        opts.simOptions.platforms = platforms as SimOptions["platforms"];
        break;
      }
      case "country":
        opts.simOptions.country = value;
        break;
      case "max-rounds": {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) {
          console.error(`✗ --max-rounds must be a positive number, got: ${value}`);
          process.exit(1);
        }
        opts.simOptions.maxRounds = n;
        break;
      }
      case "market":
        opts.simOptions.market = value !== "false";
        break;
      case "requirement":
        opts.simOptions.simulationRequirement = value;
        break;
      case "project-name":
        opts.simOptions.projectName = value;
        break;
      default:
        console.error(`✗ Unknown flag: --${rawKey}`);
        printHelp();
        process.exit(1);
    }
  }

  return opts;
}

type Check = { name: string; pass: boolean; detail: string };

function check(name: string, pass: boolean, detail: string): Check {
  return { name, pass, detail };
}

async function main() {
  const { theme, simOptions } = parseArgs(process.argv.slice(2));
  const liveExpected = Boolean(process.env.MIROSHARK_URL);

  console.log(`Running MiroShark pipeline smoke test (${liveExpected ? "live" : "mock"} mode)...`);
  console.log(`  theme: ${theme}`);
  console.log(`  simOptions: ${JSON.stringify(simOptions)}`);
  if (liveExpected) console.log(`  MIROSHARK_URL: ${process.env.MIROSHARK_URL}`);
  console.log("");

  const started = Date.now();
  let result: GenerationPipelineResult;
  try {
    result = await runGenerationPipeline(theme, { simOptions });
  } catch (error) {
    console.error("✗ runGenerationPipeline threw:", error instanceof Error ? error.message : error);
    process.exit(1);
    return;
  }
  const elapsedMs = Date.now() - started;

  const mirosharkService = result.services.find((s) => s.service === "miroshark");
  const simulateStep = result.toolLog.find((t) => t.name === "simulate_reception");

  const checks: Check[] = [
    check("pipeline completes", true, `${elapsedMs}ms`),
    check("theme echoed back", result.theme === theme, result.theme),
    check("gen_skins produced concepts", result.concepts.length > 0, `${result.concepts.length} concept(s)`),
    check(
      "every concept was scored",
      result.concepts.every((c) => typeof c.reception?.score === "number"),
      result.concepts.map((c) => `${c.title}: ${c.reception?.score}`).join(", "),
    ),
    check(
      "pick_best chose a concept present in the scored set",
      result.concepts.some((c) => c.id === result.best.id),
      result.best.title,
    ),
    check("to_3d returned a model", Boolean(result.model?.src), result.model?.src ?? "(none)"),
    check("services report includes miroshark", Boolean(mirosharkService), mirosharkService?.label ?? "(missing)"),
    check(
      "toolLog includes simulate_reception",
      Boolean(simulateStep),
      simulateStep ? `${simulateStep.status}/${simulateStep.source}` : "(missing)",
    ),
  ];

  if (liveExpected) {
    checks.push(
      check(
        "miroshark service ran live (no fallback to mock)",
        mirosharkService?.source === "live",
        mirosharkService?.fallbackReason
          ? `fell back: ${mirosharkService.fallbackReason}`
          : mirosharkService?.source ?? "(unknown)",
      ),
    );
  } else {
    checks.push(
      check(
        "miroshark service used the mock (as expected with no MIROSHARK_URL)",
        mirosharkService?.source === "mock",
        mirosharkService?.source ?? "(unknown)",
      ),
    );
  }

  for (const c of checks) {
    console.log(`${c.pass ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }

  console.log("");
  const failed = checks.filter((c) => !c.pass);
  if (failed.length > 0) {
    console.error(`✗ ${failed.length}/${checks.length} check(s) failed`);
    process.exit(1);
  }
  console.log(`✓ All ${checks.length} checks passed`);
}

main();
