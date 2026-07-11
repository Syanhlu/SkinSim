import { buildAnalysisSnapshot, calculateBacktest, parseAdsCsv } from "@/lib/analysis";

export const maxDuration = 30;

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "Upload a CSV file in the `file` field." }, { status: 400 });
  }

  const csv = await file.text();

  try {
    const rows = parseAdsCsv(csv);
    return Response.json({
      snapshot: buildAnalysisSnapshot(csv),
      backtest: calculateBacktest(rows),
      fileName: file.name,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not parse CSV." },
      { status: 400 },
    );
  }
}
