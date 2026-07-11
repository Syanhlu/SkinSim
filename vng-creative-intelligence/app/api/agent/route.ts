import { streamText, tool, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AGENT_MODEL } from "@/lib/ai";
import {
  calculateBacktest,
  cluster,
  compareBaselineSelectors,
  join_perf_ltv,
  parseAdsCsv,
  recommend_direction,
} from "@/lib/analysis";
import { runGenerationPipeline } from "@/lib/gen";
import { buildAnalysisSnapshotWithVision, tagThemesWithVision } from "@/lib/vision";

export const maxDuration = 300;

const SYSTEM = `You are the VNG Creative Performance Intelligence agent.
Use the tools on the ad-platform export to decide the next creative direction, defend it against naive baselines, and optionally run the mockable generation pipeline.
Never optimize for spend alone. Cite tool results, distinguish live services from mocks, and end with a concise decision memo.`;

const PeriodSchema = z.object({
  period: z.enum(["history", "holdout", "all"]).default("all"),
});

export async function POST(req: Request) {
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return Response.json(
      { error: "Set AI_GATEWAY_API_KEY to enable the analysis agent." },
      { status: 503 },
    );
  }

  const { messages }: { messages: UIMessage[] } = await req.json();
  const csv = await readFile(join(process.cwd(), "data", "ads.sample.csv"), "utf8");

  const result = streamText({
    model: AGENT_MODEL,
    system: SYSTEM,
    messages: convertToModelMessages(messages),
    tools: {
      join_perf_ltv: tool({
        description: "Join ad-platform creative rows with pLTV cohort fields and compute pLTV-weighted ROAS.",
        inputSchema: PeriodSchema,
        execute: async ({ period }) => {
          const rows = parseAdsCsv(csv).filter((row) => period === "all" || row.period === period);
          return join_perf_ltv(rows);
        },
      }),
      tag_themes: tool({
        description:
          "Tag creatives with art style, motif, and hero labels. Runs a real LLM vision pass over each creative thumbnail when AI_GATEWAY_API_KEY is set; otherwise falls back to the exported metadata columns. Each tag reports its source.",
        inputSchema: PeriodSchema,
        execute: async ({ period }) => {
          const rows = parseAdsCsv(csv).filter((row) => period === "all" || row.period === period);
          const tagged = await tagThemesWithVision(join_perf_ltv(rows));
          return {
            taggingSource: tagged.every((row) => row.theme.source === "llm-vision") ? "llm-vision" : "metadata",
            creatives: tagged.map((row) => ({
              creativeId: row.creativeId,
              creativeName: row.creativeName,
              theme: row.theme,
              highValuePlayerShare: row.highValuePlayerShare,
              pLtvWeightedRoas: row.pLtvWeightedRoas,
            })),
          };
        },
      }),
      cluster: tool({
        description: "Cluster tagged themes by high-value-player share first, not spend.",
        inputSchema: PeriodSchema,
        execute: async ({ period }) => {
          const rows = parseAdsCsv(csv).filter((row) => period === "all" || row.period === period);
          const tagged = await tagThemesWithVision(join_perf_ltv(rows));
          return cluster(tagged);
        },
      }),
      recommend_direction: tool({
        description: "Recommend the next creative direction from clusters and identify tourist-magnet themes to avoid.",
        inputSchema: PeriodSchema,
        execute: async ({ period }) => {
          const snapshot = await buildAnalysisSnapshotWithVision(csv, period);
          return {
            totals: snapshot.totals,
            recommendation: recommend_direction(snapshot.clusters),
            clusters: snapshot.clusters.slice(0, 4),
          };
        },
      }),
      run_backtest: tool({
        description: "Run the holdout pLTV-weighted ROAS backtest for the agent's top recommendation.",
        inputSchema: z.object({}),
        execute: async () => calculateBacktest(parseAdsCsv(csv)),
      }),
      compare_baselines: tool({
        description: "Compare the agent pick against D7 ROAS, installs, and spend baseline pickers.",
        inputSchema: z.object({}),
        execute: async () => {
          const rows = parseAdsCsv(csv);
          return compareBaselineSelectors(
            rows.filter((row) => row.period === "history"),
            rows.filter((row) => row.period === "holdout"),
          );
        },
      }),
      run_generation_pipeline: tool({
        description:
          "Run gen_skins -> simulate_reception -> pick_best -> to_3d for a recommended theme. Returns service sources and fallback reasons.",
        inputSchema: z.object({ themeKey: z.string().optional() }),
        execute: async ({ themeKey }) => {
          const snapshot = await buildAnalysisSnapshotWithVision(csv, "history");
          return runGenerationPipeline(themeKey ?? snapshot.recommendation.themeKey, {
            publicOrigin: new URL(req.url).origin,
          });
        },
      }),
    },
    stopWhen: stepCountIs(12),
  });

  return result.toUIMessageStreamResponse();
}
