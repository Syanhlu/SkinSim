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

/**
 * Meshy image-to-3D. Submits the concept art, polls the task to completion, and
 * returns the GLB URL — or null if the key is unset / the job fails or times out.
 */
export async function imageTo3dModel(imageUrl: string): Promise<string | null> {
  const key = process.env.MESHY_KEY;
  if (!key) return null;

  const base = "https://api.meshy.ai/openapi/v1/image-to-3d";
  const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };

  const createRes = await fetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({ image_url: imageUrl, enable_pbr: true }),
  });
  if (!createRes.ok) {
    throw new Error(`Meshy create ${createRes.status}: ${await createRes.text().catch(() => createRes.statusText)}`);
  }
  const { result: taskId } = (await createRes.json()) as { result?: string };
  if (!taskId) return null;

  // Poll (bounded) until the task succeeds or we give up.
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await sleep(3_000);
    const pollRes = await fetch(`${base}/${taskId}`, { headers });
    if (!pollRes.ok) continue;
    const task = (await pollRes.json()) as {
      status?: string;
      model_urls?: { glb?: string };
    };
    if (task.status === "SUCCEEDED" && task.model_urls?.glb) return task.model_urls.glb;
    if (task.status === "FAILED" || task.status === "CANCELED") return null;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
