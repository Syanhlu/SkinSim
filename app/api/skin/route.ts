import { z } from "zod";
import { isMeshyEnabled } from "@/lib/creative/gen-adapters";
import {
  checkSkinModel,
  readManifest,
  saveSkinImage,
  startSkinModel,
} from "@/lib/creative/skin-models";

/**
 * Skin-model stage of the pipeline (image → Meshy → GLB). The Meshy key stays
 * server-side; generation is async because Meshy takes minutes per model.
 *
 *   POST /api/skin  multipart {image: File, name?}   → upload + start task, 202
 *   POST /api/skin  json {image: "beach.png"}        → start task for a bundled image, 202
 *   GET  /api/skin?skin=beach                        → poll; downloads the GLB on success
 *   GET  /api/skin                                   → full manifest (all skins/models)
 */

export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const startSchema = z.object({
  image: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  if (!isMeshyEnabled()) {
    return jsonError(503, "meshy_disabled", "MESHY_KEY is not configured on the server.");
  }

  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("image");
      if (!(file instanceof File)) {
        return jsonError(400, "missing_image", "Send the image as a multipart field named \"image\".");
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return jsonError(413, "image_too_large", `Image must be at most ${MAX_UPLOAD_BYTES} bytes.`);
      }
      const name = typeof form.get("name") === "string" && (form.get("name") as string).trim()
        ? (form.get("name") as string)
        : file.name;
      const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".png").toLowerCase();
      const imagePath = await saveSkinImage(name, ext, new Uint8Array(await file.arrayBuffer()));
      const entry = await startSkinModel(imagePath);
      return jsonOk(entry, 202);
    }

    if (contentType.includes("application/json")) {
      const parsed = startSchema.safeParse(await req.json());
      if (!parsed.success) {
        return jsonError(400, "invalid_body", "Body must be {image: \"<name under public/skin/>\"}.");
      }
      const entry = await startSkinModel(parsed.data.image);
      return jsonOk(entry, 202);
    }

    return jsonError(415, "unsupported_media_type", "Use multipart/form-data (upload) or application/json.");
  } catch (error) {
    return jsonError(500, "skin_model_failed", publicErrorMessage(error));
  }
}

export async function GET(req: Request) {
  const skin = new URL(req.url).searchParams.get("skin");
  try {
    if (!skin) return jsonOk({ manifest: await readManifest() });
    const entry = await checkSkinModel(skin);
    return jsonOk(entry);
  } catch (error) {
    return jsonError(404, "skin_model_not_found", publicErrorMessage(error));
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function jsonOk(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function jsonError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

function publicErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unexpected skin-model API error.";
}
