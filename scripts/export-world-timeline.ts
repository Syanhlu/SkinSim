// ─── Export a completed MiroShark simulation as a world timeline (plan §4.1) ──
// Pulls a finished simulation from a running MiroShark backend and writes
// public/demo/timeline-<variant>.json — the bundled stage-fallback format the
// /world replay mode loads.
//
// Usage:
//   npx tsx scripts/export-world-timeline.ts --sim sim_abc123 --variant A \
//     [--injection "Gà Rán Giòn Cay — combo 89k ..."] [--out public/demo]
//
// Env: MIROSHARK_URL (default http://localhost:5001), MIROSHARK_INTERNAL_KEY.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorldTimeline } from "../lib/world/adapters";

interface CliArgs {
  sim?: string;
  variant?: string;
  injection?: string;
  out?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--sim") args.sim = value;
    else if (key === "--variant") args.variant = value;
    else if (key === "--injection") args.injection = value;
    else if (key === "--out") args.out = value;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sim) {
    console.error(
      "Usage: npx tsx scripts/export-world-timeline.ts --sim <simulation_id> --variant <A|B> " +
        '[--injection "<variant ad text>"] [--out public/demo]',
    );
    process.exit(1);
  }
  const variant = (args.variant ?? "A").toUpperCase();
  const baseUrl = process.env.MIROSHARK_URL?.trim() || "http://localhost:5001";
  const internalKey = process.env.MIROSHARK_INTERNAL_KEY?.trim() || undefined;

  console.log(`exporting ${args.sim} from ${baseUrl} as variant ${variant}…`);
  const timeline = await buildWorldTimeline({
    baseUrl,
    simulationId: args.sim,
    variantLabel: variant,
    injectionText: args.injection,
    internalKey,
  });

  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = args.out
    ? isAbsolute(args.out)
      ? args.out
      : join(here, "..", args.out)
    : join(here, "..", "public", "demo");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `timeline-${variant}.json`);
  writeFileSync(outPath, JSON.stringify(timeline), "utf-8");

  const last = timeline.frames[timeline.frames.length - 1];
  const bullish = last
    ? timeline.agents.filter((a) => last.states[a.id]?.stance === "bullish").length
    : 0;
  console.log(
    `wrote ${outPath} — ${timeline.agents.length} agents, ${timeline.frames.length} frames, ` +
      `final bullish ${bullish}/${timeline.agents.length}, market ${last?.marketYesProb ?? "n/a"}`,
  );
}

main().catch((error) => {
  console.error(`export failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
