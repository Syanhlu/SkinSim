#!/usr/bin/env -S npx tsx
// Run the skin-model stage for one image: submit to Meshy image-to-3D, poll
// with progress, and download the finished GLB to public/models/<skin>.glb.
//
// Usage:
//   npm run skin:model -- beach.png
//   npm run skin:model -- public/skin/camp.png
//
// Reads MESHY_KEY from the environment or .env.local (scripts don't get
// Next.js's automatic env loading).

import { promises as fs } from "node:fs";
import path from "node:path";

async function loadEnvLocal(): Promise<void> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, value] = match;
      if (process.env[key] === undefined) {
        process.env[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // no .env.local — rely on the ambient environment
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const imageRef = process.argv[2];
  if (!imageRef || imageRef === "--help") {
    console.log("Usage: npm run skin:model -- <image under public/skin/, e.g. beach.png>");
    process.exit(imageRef ? 0 : 1);
  }

  await loadEnvLocal();
  if (!process.env.MESHY_KEY) {
    console.error("MESHY_KEY is not set (env or .env.local).");
    process.exit(1);
  }

  // Import after env is loaded so the adapters see MESHY_KEY.
  const { startSkinModel, checkSkinModel } = await import("../lib/creative/skin-models");

  console.log(`Submitting ${imageRef} to Meshy image-to-3D…`);
  const started = await startSkinModel(imageRef);
  console.log(`Task ${started.taskId} created for skin "${started.skin}" (${started.image})`);

  const deadline = Date.now() + 15 * 60_000;
  let lastProgress = -1;
  while (Date.now() < deadline) {
    await sleep(5_000);
    const entry = await checkSkinModel(started.skin);
    if (entry.progress !== lastProgress || entry.status === "succeeded" || entry.status === "failed") {
      console.log(`  ${entry.status} — ${entry.progress}%`);
      lastProgress = entry.progress;
    }
    if (entry.status === "succeeded") {
      console.log(`\nModel ready: public${entry.model}`);
      if (entry.thumbnail) console.log(`Meshy thumbnail: ${entry.thumbnail}`);
      console.log(`Manifest updated: public/models/manifest.json`);
      console.log(`View it at http://localhost:3000/skin-lab`);
      return;
    }
    if (entry.status === "failed") {
      console.error(`\nGeneration failed: ${entry.error ?? "unknown Meshy error"}`);
      process.exit(1);
    }
  }
  console.error("\nTimed out after 15 minutes; re-run GET /api/skin?skin=… to keep polling.");
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
