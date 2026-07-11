import { createClient } from "@supabase/supabase-js";
import type { AnalysisSnapshot } from "@/lib/analysis";

export interface AnalysisHistoryItem {
  id: string;
  generated_at: string;
  recommended_theme: string;
  pltv_weighted_roas: number | null;
  high_value_share: number | null;
  created_at: string;
}

/**
 * Server-side Supabase client (service role — bypasses RLS). Import ONLY from
 * server code (route handlers, server components, scripts). Never ship the
 * service-role key to the browser.
 */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Persist an analysis snapshot to the `vng_ci_analyses` table for later review.
 * No-op (returns false) when Supabase env vars are absent, so the app stays fully
 * functional with zero infra. Best-effort: swallows errors and never throws into
 * the render path.
 *
 * Expected table (create in Supabase before enabling):
 *   create table vng_ci_analyses (
 *     id uuid primary key default gen_random_uuid(),
 *     generated_at timestamptz not null,
 *     recommended_theme text not null,
 *     pltv_weighted_roas numeric,
 *     high_value_share numeric,
 *     clusters jsonb not null,
 *     recommendation jsonb not null,
 *     created_at timestamptz not null default now()
 *   );
 */
export async function persistAnalysisSnapshot(snapshot: AnalysisSnapshot): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const { error } = await supabaseAdmin()
      .from("vng_ci_analyses")
      .insert({
        generated_at: snapshot.generatedAt,
        recommended_theme: snapshot.recommendation.themeLabel,
        pltv_weighted_roas: snapshot.totals.pLtvWeightedRoas,
        high_value_share: snapshot.totals.highValuePlayerShare,
        clusters: snapshot.clusters,
        recommendation: snapshot.recommendation,
      });
    if (error) throw error;
    return true;
  } catch (error) {
    console.warn(
      `[supabase] skipped persisting analysis snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

export async function listAnalysisSnapshots(limit = 8): Promise<AnalysisHistoryItem[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await supabaseAdmin()
      .from("vng_ci_analyses")
      .select("id, generated_at, recommended_theme, pltv_weighted_roas, high_value_share, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as AnalysisHistoryItem[];
  } catch (error) {
    console.warn(
      `[supabase] skipped reading analysis snapshots: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}
