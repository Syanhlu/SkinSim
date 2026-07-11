import { isSupabaseConfigured, listAnalysisSnapshots } from "@/lib/supabase";

export async function GET() {
  return Response.json({
    configured: isSupabaseConfigured(),
    runs: await listAnalysisSnapshots(),
  });
}
