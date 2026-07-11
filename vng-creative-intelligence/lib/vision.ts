// ─── Real theme tagging via LLM vision ───────────────────────────────────────
// tag_themes() in lib/analysis.ts reads theme labels straight off the ad export's
// metadata columns — deterministic and offline, but a passthrough. This module
// upgrades that to an actual CHEAP_MODEL vision call over the creative thumbnail
// when AI_GATEWAY_API_KEY is set, and cleanly falls back to the metadata path
// otherwise. The `source` on each ThemeTag is labeled honestly ("llm-vision" vs
// "metadata") so the dashboard never over-claims.
//
// Server-only: imports node:fs and the AI SDK. Never import from client code.

import { generateObject } from "ai";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CHEAP_MODEL } from "./ai";
import {
  buildThemeTag,
  buildTotals,
  cluster,
  join_perf_ltv,
  parseAdsCsv,
  recommend_direction,
  tag_themes,
  type AnalysisSnapshot,
  type CreativePerformance,
  type RawAdRow,
  type TaggedCreative,
} from "./analysis";

const VisionSchema = z.object({
  artStyle: z
    .string()
    .describe("Overall art style, kebab-case, e.g. cyberpunk-premium, pop-cute, dark-fantasy"),
  motif: z.string().describe("Dominant visual motif, kebab-case, e.g. neon-mecha, chibi-festival"),
  hero: z.string().describe("Hero/character archetype, kebab-case, e.g. ronin, oracle, mascot"),
  confidence: z.number().min(0).max(1).describe("Confidence in these labels, 0-1"),
});

export function isVisionEnabled(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

/**
 * Tag creatives by running a vision model over each unique thumbnail. Falls back
 * to the metadata path (tag_themes) when no key is set OR any thumbnail fails, so
 * the whole set stays in a single, coherent label space (no fragmented clusters).
 */
export async function tagThemesWithVision(records: CreativePerformance[]): Promise<TaggedCreative[]> {
  if (!isVisionEnabled() || records.length === 0) {
    return tag_themes(records);
  }

  const uniqueThumbnails = [...new Set(records.map((record) => record.thumbnail))];

  try {
    const entries = await Promise.all(
      uniqueThumbnails.map(async (thumbnail) => {
        const hint = records.find((record) => record.thumbnail === thumbnail);
        const labels = await tagSingleThumbnail(thumbnail, hint);
        return [thumbnail, labels] as const;
      }),
    );

    const byThumbnail = new Map(entries);
    return records.map((record) => {
      const labels = byThumbnail.get(record.thumbnail)!;
      return {
        ...record,
        theme: buildThemeTag(labels.artStyle, labels.motif, labels.hero, "llm-vision", labels.confidence),
      };
    });
  } catch (error) {
    const fallbackReason = error instanceof Error ? error.message : String(error);
    console.warn(`[vision] falling back to metadata tagging: ${fallbackReason}`);
    return tag_themes(records, fallbackReason);
  }
}

/**
 * Vision-backed equivalent of buildAnalysisSnapshot(). Tags via the vision model
 * when a key is present, otherwise identical to the deterministic metadata path.
 */
export async function buildAnalysisSnapshotWithVision(
  csv: string,
  period: "all" | RawAdRow["period"] = "all",
): Promise<AnalysisSnapshot> {
  const parsed = parseAdsCsv(csv);
  const scoped = period === "all" ? parsed : parsed.filter((row) => row.period === period);
  const creatives = await tagThemesWithVision(join_perf_ltv(scoped));
  const clusters = cluster(creatives);

  return {
    generatedAt: new Date().toISOString(),
    totals: buildTotals(creatives),
    creatives,
    clusters,
    recommendation: recommend_direction(clusters),
  };
}

async function tagSingleThumbnail(
  thumbnail: string,
  hint: CreativePerformance | undefined,
): Promise<z.infer<typeof VisionSchema>> {
  const image = await loadThumbnail(thumbnail);
  const { object } = await generateObject({
    model: CHEAP_MODEL,
    schema: VisionSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "You are labeling a mobile-game ad creative for a marketing-analytics pipeline.",
              "Look at the thumbnail and assign concise kebab-case labels for its art style, dominant",
              "visual motif, and hero/character archetype. Reuse conventional taxonomy terms where they fit.",
              hint
                ? `Ad copy for context (do not just echo it — verify against the image): "${hint.textHook}".`
                : "",
            ]
              .filter(Boolean)
              .join(" "),
          },
          { type: "image", image },
        ],
      },
    ],
  });
  return object;
}

async function loadThumbnail(thumbnail: string): Promise<string> {
  // Thumbnails are generated PNGs under public/. Embed as a data URL so the model
  // receives model-supported image data without needing a public host.
  const relative = thumbnail.replace(/^\//, "");
  const bytes = await readFile(join(process.cwd(), "public", relative));
  const mime = thumbnail.endsWith(".svg") ? "image/svg+xml" : "image/png";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
