// ─── Generative-pipeline adapters (Nano Banana + Meshy) ──────────────────────
// These wrap the two external gen APIs behind key checks so the app runs fully
// on bundled placeholder assets by default and only reaches out when the keys
// are present. Every call is best-effort: on any failure the caller falls back
// to the bundled SVG / GLB, so the demo pipeline never hard-fails.
//
// Server-only.

export function isNanoBananaEnabled(): boolean {
  return Boolean(process.env.NANO_BANANA_KEY);
}

export function isMeshyEnabled(): boolean {
  return Boolean(process.env.MESHY_KEY);
}

/**
 * Nano Banana (Gemini image model) text-to-image. Returns a base64 data URL of
 * the rendered concept art, or null if the key is unset / the call fails.
 */
export async function generateSkinImage(prompt: string): Promise<string | null> {
  const key = process.env.NANO_BANANA_KEY;
  if (!key) return null;

  const model = process.env.NANO_BANANA_MODEL ?? "gemini-2.5-flash-image";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `Mobile-game skin concept art. ${prompt}` }] }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Nano Banana ${res.status}: ${await res.text().catch(() => res.statusText)}`);

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
    };
    const inline = json.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData;
    if (!inline?.data) return null;
    return `data:${inline.mimeType ?? "image/png"};base64,${inline.data}`;
  } finally {
    clearTimeout(timeout);
  }
}

const MESHY_IMAGE_TO_3D_URL = "https://api.meshy.ai/openapi/v1/image-to-3d";

export interface MeshyTask {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";
  /** 0–100 */
  progress: number;
  glbUrl: string | null;
  thumbnailUrl: string | null;
  error: string | null;
}

function meshyHeaders(): Record<string, string> {
  const key = process.env.MESHY_KEY;
  if (!key) throw new Error("MESHY_KEY is not set");
  return { authorization: `Bearer ${key}`, "content-type": "application/json" };
}

/**
 * Submit an image (https URL or data URI) to Meshy image-to-3D. Returns the task
 * id; generation runs async on Meshy's side (typically 1–5 minutes), so callers
 * poll with getMeshyImageTo3dTask rather than blocking a request on it.
 */
export async function createMeshyImageTo3dTask(imageUrl: string): Promise<string> {
  const res = await fetch(MESHY_IMAGE_TO_3D_URL, {
    method: "POST",
    headers: meshyHeaders(),
    body: JSON.stringify({ image_url: imageUrl, enable_pbr: true, should_texture: true }),
  });
  if (!res.ok) {
    throw new Error(`Meshy create ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  const { result } = (await res.json()) as { result?: string };
  if (!result) throw new Error("Meshy create returned no task id");
  return result;
}

/** One status poll for an image-to-3D task. */
export async function getMeshyImageTo3dTask(taskId: string): Promise<MeshyTask> {
  const res = await fetch(`${MESHY_IMAGE_TO_3D_URL}/${encodeURIComponent(taskId)}`, {
    headers: meshyHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Meshy status ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  const task = (await res.json()) as {
    id?: string;
    status?: MeshyTask["status"];
    progress?: number;
    model_urls?: { glb?: string };
    thumbnail_url?: string;
    task_error?: { message?: string };
  };
  return {
    id: task.id ?? taskId,
    status: task.status ?? "PENDING",
    progress: task.progress ?? 0,
    glbUrl: task.model_urls?.glb ?? null,
    thumbnailUrl: task.thumbnail_url ?? null,
    error: task.task_error?.message ?? null,
  };
}

/**
 * Meshy image-to-3D. Submits the concept art, polls the task to completion, and
 * returns the GLB URL — or null if the key is unset / the job fails or times out.
 */
export async function imageTo3dModel(imageUrl: string): Promise<string | null> {
  if (!isMeshyEnabled()) return null;

  const taskId = await createMeshyImageTo3dTask(imageUrl);

  // Poll (bounded) until the task succeeds or we give up.
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await sleep(3_000);
    let task: MeshyTask;
    try {
      task = await getMeshyImageTo3dTask(taskId);
    } catch {
      continue;
    }
    if (task.status === "SUCCEEDED" && task.glbUrl) return task.glbUrl;
    if (task.status === "FAILED" || task.status === "CANCELED") return null;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
