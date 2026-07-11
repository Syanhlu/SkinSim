import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { calculateBacktest, parseAdsCsv } from "@/lib/analysis";
import { persistAnalysisSnapshot } from "@/lib/supabase";
import { buildAnalysisSnapshotWithVision } from "@/lib/vision";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const csv = await readFile(join(process.cwd(), "data", "ads.sample.csv"), "utf8");
  const snapshot = await buildAnalysisSnapshotWithVision(csv);
  const backtest = calculateBacktest(parseAdsCsv(csv));

  // Fire-and-forget persistence; no-op unless Supabase env vars are set.
  void persistAnalysisSnapshot(snapshot);

  const agentEnabled = Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);

  return (
    <Dashboard
      snapshot={snapshot}
      backtest={backtest}
      agentEnabled={agentEnabled}
      serviceConfig={{
        nanoBanana: Boolean(process.env.NANO_BANANA_KEY),
        miroshark: Boolean(process.env.MIROSHARK_URL),
        meshy: Boolean(process.env.MESHY_KEY),
      }}
    />
  );
}
