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
//   MIROSHARK_URL=http://localhost:5001 npm run smoke:miroshark

import { runGenerationPipeline, type GenerationPipelineResult } from "../lib/gen";

const THEME = "smoke-test__theme__ping";
const liveExpected = Boolean(process.env.MIROSHARK_URL);

type Check = { name: string; pass: boolean; detail: string };

function check(name: string, pass: boolean, detail: string): Check {
  return { name, pass, detail };
}

async function main() {
  console.log(`Running MiroShark pipeline smoke test (${liveExpected ? "live" : "mock"} mode)...`);
  console.log(`  theme: ${THEME}`);
  if (liveExpected) console.log(`  MIROSHARK_URL: ${process.env.MIROSHARK_URL}`);
  console.log("");

  const started = Date.now();
  let result: GenerationPipelineResult;
  try {
    result = await runGenerationPipeline(THEME);
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
    check("theme echoed back", result.theme === THEME, result.theme),
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
