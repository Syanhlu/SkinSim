// ─── POST /api/interview — proxy to MiroShark's agent interview (plan §4.2) ──
// Body: { simulationId, agentName, question, agentId? }
// → MiroShark POST /api/simulation/interview with the x-miroshark-internal-key
//   guard header (server-side env only, never exposed to the browser).
//
// Errors are structured JSON. When the engine is unreachable/unconfigured the
// route answers 503 with { fallback: true } so the InterviewPanel switches to
// the canned Q&As bundled in the replay timeline JSON.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface InterviewRequestBody {
  simulationId?: string;
  agentName?: string;
  agentId?: number | string;
  question?: string;
}

interface MiroEnvelope {
  success?: boolean;
  data?: unknown;
  error?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: InterviewRequestBody;
  try {
    body = (await request.json()) as InterviewRequestBody;
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const simulationId = typeof body.simulationId === "string" ? body.simulationId.trim() : "";
  const agentName = typeof body.agentName === "string" ? body.agentName.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!simulationId || !question || (!agentName && body.agentId === undefined)) {
    return NextResponse.json(
      {
        error: "missing_fields",
        message: "simulationId, question, and agentName (or agentId) are required.",
      },
      { status: 400 },
    );
  }

  const baseUrl = process.env.MIROSHARK_URL?.trim();
  const internalKey = process.env.MIROSHARK_INTERNAL_KEY?.trim();
  if (!baseUrl) {
    return NextResponse.json(
      {
        fallback: true,
        error: "engine_offline",
        message: "MIROSHARK_URL is not configured — use canned interview answers.",
      },
      { status: 503 },
    );
  }

  // The live handler keys on numeric agent_id; the documented contract names
  // agent_name. Send both so either backend revision accepts the call.
  const payload: Record<string, unknown> = {
    simulation_id: simulationId,
    prompt: question,
  };
  if (agentName) payload.agent_name = agentName;
  const numericAgentId =
    typeof body.agentId === "number"
      ? body.agentId
      : typeof body.agentId === "string" && /^\d+$/.test(body.agentId)
        ? Number(body.agentId)
        : undefined;
  if (numericAgentId !== undefined) payload.agent_id = numericAgentId;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/simulation/interview`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(internalKey ? { "x-miroshark-internal-key": internalKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });

    let envelope: MiroEnvelope | null = null;
    try {
      envelope = (await res.json()) as MiroEnvelope;
    } catch {
      envelope = null;
    }

    if (!res.ok || !envelope || envelope.success !== true) {
      const message =
        (envelope && typeof envelope.error === "string" && envelope.error) ||
        `MiroShark interview failed (HTTP ${res.status}).`;
      // 5xx from the engine = effectively unreachable for the demo → fallback.
      const engineDown = res.status >= 500;
      return NextResponse.json(
        { fallback: engineDown, error: "interview_failed", message },
        { status: engineDown ? 503 : 502 },
      );
    }

    const answer = extractAnswer(envelope.data);
    if (!answer) {
      return NextResponse.json(
        { fallback: true, error: "empty_answer", message: "Engine returned no answer text." },
        { status: 503 },
      );
    }
    return NextResponse.json({ answer, raw: envelope.data });
  } catch {
    return NextResponse.json(
      {
        fallback: true,
        error: "engine_unreachable",
        message: "Could not reach the simulation engine — use canned interview answers.",
      },
      { status: 503 },
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Dig the reply text out of MiroShark's interview payload — handles both the
 *  single-platform shape ({result:{response}}) and the dual-platform shape
 *  ({result:{platforms:{threads:{response}, facebook:{response}}}}). */
function extractAnswer(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  const result = (record.result ?? record) as Record<string, unknown>;
  if (typeof result.response === "string" && result.response.trim()) {
    return result.response.trim();
  }
  const platforms = result.platforms;
  if (platforms && typeof platforms === "object") {
    for (const value of Object.values(platforms as Record<string, unknown>)) {
      if (value && typeof value === "object") {
        const response = (value as Record<string, unknown>).response;
        if (typeof response === "string" && response.trim()) return response.trim();
      }
    }
  }
  return undefined;
}
