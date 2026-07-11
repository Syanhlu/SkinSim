#!/usr/bin/env -S npx tsx
// Smoke test for the ported MiroShark client.
//
// Zero-config mode (no MIROSHARK_URL): calls MockSimClient and proves the
// client contract returns a well-formed verdict. Live mode (MIROSHARK_URL set):
// calls the real MiroShark HTTP flow and asserts it did not silently fall back
// to the mock.
//
// Usage:
//   npm run smoke:miroshark
//   npm run smoke:miroshark -- --platforms=threads,tiktok --country=vn --max-rounds=5
//   MIROSHARK_URL=http://localhost:5001 npm run smoke:miroshark -- --market=false
//   npm run smoke:miroshark -- --help

import { getSimClient, type SimOptions, type SimVerdict } from "../lib/miroshark/client";

const VALID_PLATFORMS = ["threads", "facebook", "tiktok"] as const;
type Platform = NonNullable<SimOptions["platforms"]>[number];
const SMOKE_DOCUMENT = [
  "A/B test smoke document for a mobile game live-ops offer.",
  "Variant A keeps the current starter pack pricing.",
  "Variant B adds a time-limited cosmetic bonus and a clearer first-purchase value message.",
  "Audience: Vietnamese casual and mid-core players evaluating perceived fairness, urgency, and value.",
].join("\n");

interface CliOptions {
  simOptions: SimOptions;
}

function printHelp() {
  console.log(`Usage: npm run smoke:miroshark -- [flags]

Flags:
  --platforms=<list>        Comma-separated subset of ${VALID_PLATFORMS.join("|")}. Default: threads,facebook
  --country=<code>          Locale MiroShark's persona grounding understands. Default: vn
  --max-rounds=<n>          Simulated rounds to run (cost scales with this). Default: 3
  --market=<true|false>     Also run the prediction-market simulation. Default: false
  --requirement=<string>    Free-text steer for what MiroShark's ontology/agents should focus on.
  --project-name=<string>   Overrides the auto-generated MiroShark project name.
  --help                    Show this message.

Env (control which backend is hit; see .env.example):
  MIROSHARK_URL, MIROSHARK_API_KEY, MIROSHARK_ADMIN_TOKEN, MIROSHARK_TIMEOUT_MS,
  MIROSHARK_SCRAPE_ENABLED, TINYFISH_API_KEY`);
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { simOptions: {} };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) {
      console.error(`FAIL Unrecognized argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
    const [, rawKey, rawValue] = match;
    const value = rawValue ?? "true";

    switch (rawKey) {
      case "platforms": {
        const platforms = value
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        const invalid = platforms.filter((p) => !isPlatform(p));
        if (invalid.length > 0) {
          console.error(`FAIL Unknown platform(s): ${invalid.join(", ")} (valid: ${VALID_PLATFORMS.join(", ")})`);
          process.exit(1);
        }
        opts.simOptions.platforms = platforms as Platform[];
        break;
      }
      case "country":
        opts.simOptions.country = value;
        break;
      case "max-rounds": {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) {
          console.error(`FAIL --max-rounds must be a positive number, got: ${value}`);
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
        console.error(`FAIL Unknown flag: --${rawKey}`);
        printHelp();
        process.exit(1);
    }
  }

  return opts;
}

function isPlatform(value: string): value is Platform {
  return VALID_PLATFORMS.includes(value as Platform);
}

type Check = { name: string; pass: boolean; detail: string };

function check(name: string, pass: boolean, detail: string): Check {
  return { name, pass, detail };
}

function verdictChecks(verdict: SimVerdict, liveExpected: boolean, elapsedMs: number): Check[] {
  const scoreIsValid = Number.isFinite(verdict.score) && verdict.score >= 0 && verdict.score <= 100;

  const checks: Check[] = [
    check("simulate completes", true, `${elapsedMs}ms`),
    check("summary is present", verdict.summary.trim().length > 0, verdict.summary),
    check("score is 0-100", scoreIsValid, String(verdict.score)),
    check("scenarios is an array", Array.isArray(verdict.scenarios), `${verdict.scenarios.length} scenario(s)`),
    check("citations is an array", Array.isArray(verdict.citations), `${verdict.citations.length} citation(s)`),
  ];

  if (liveExpected) {
    checks.push(check("source is miroshark", verdict.source === "miroshark", verdict.source));
  } else {
    checks.push(check("source is mock", verdict.source === "mock", verdict.source));
  }

  return checks;
}

async function main() {
  const { simOptions } = parseArgs(process.argv.slice(2));
  const liveExpected = Boolean(process.env.MIROSHARK_URL);
  const client = getSimClient();

  console.log(`Running MiroShark client smoke test (${liveExpected ? "live" : "mock"} mode)...`);
  console.log(`  simOptions: ${JSON.stringify(simOptions)}`);
  if (liveExpected) console.log(`  MIROSHARK_URL: ${process.env.MIROSHARK_URL}`);
  console.log("");

  const started = Date.now();
  let verdict: SimVerdict;
  try {
    verdict = await client.simulate({ document: SMOKE_DOCUMENT, options: simOptions });
  } catch (error) {
    console.error("FAIL simulate threw:", error instanceof Error ? error.message : error);
    process.exit(1);
    return;
  }
  const elapsedMs = Date.now() - started;

  const checks = verdictChecks(verdict, liveExpected, elapsedMs);
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` - ${c.detail}` : ""}`);
  }

  console.log("");
  const failed = checks.filter((c) => !c.pass);
  if (failed.length > 0) {
    console.error(`FAIL ${failed.length}/${checks.length} check(s) failed`);
    process.exit(1);
  }
  console.log(`PASS All ${checks.length} checks passed`);
}

main();
