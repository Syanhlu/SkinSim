// ─── Skin-model pipeline stage (image → Meshy image-to-3D → local GLB) ───────
// Sits between variant creation and the reaction run: each A/B variant gets a
// source image (uploaded or bundled under public/skin/), Meshy turns it into a
// 3D model, and the finished GLB is downloaded to public/models/<skin>.glb so
// the reaction stage and viewer can reference a stable local URL.
//
// Generation takes minutes, so the stage is split into start (create the Meshy
// task, record it in the manifest) and check (poll once; on success, download
// the GLB and finalize the manifest entry). public/models/manifest.json is the
// stage's durable output — it maps skin name → image, task, status, model path.
//
// Server-only.

import { promises as fs } from "node:fs";
import path from "node:path";
import { createMeshyImageTo3dTask, getMeshyImageTo3dTask } from "./gen-adapters";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const SKIN_DIR = path.join(PUBLIC_DIR, "skin");
const MODELS_DIR = path.join(PUBLIC_DIR, "models");
const MANIFEST_PATH = path.join(MODELS_DIR, "manifest.json");

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export interface SkinModelEntry {
  /** Sanitized skin name, e.g. "beach". Manifest key and GLB filename. */
  skin: string;
  /** Public path of the source image, e.g. "/skin/beach.png". */
  image: string;
  taskId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  /** 0–100, from Meshy. */
  progress: number;
  /** Public path of the downloaded model, e.g. "/models/beach.glb". Set on success. */
  model?: string;
  /** Meshy-hosted preview thumbnail (expiring URL). */
  thumbnail?: string;
  error?: string;
  updatedAt: string;
}

export type SkinModelManifest = Record<string, SkinModelEntry>;

/** Lowercase, drop the extension, keep filesystem/URL-safe characters only. */
export function sanitizeSkinName(name: string): string {
  const base = path.basename(name).replace(/\.[a-z0-9]+$/i, "");
  const clean = base.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!clean) throw new Error(`Invalid skin name: ${JSON.stringify(name)}`);
  return clean;
}

/** Persist an uploaded variant image under public/skin/. Returns its public path. */
export async function saveSkinImage(name: string, ext: string, bytes: Uint8Array): Promise<string> {
  const extension = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  if (!IMAGE_MIME[extension]) {
    throw new Error(`Unsupported image type ${extension}; use ${Object.keys(IMAGE_MIME).join(", ")}`);
  }
  const skin = sanitizeSkinName(name);
  await fs.mkdir(SKIN_DIR, { recursive: true });
  await fs.writeFile(path.join(SKIN_DIR, `${skin}${extension}`), bytes);
  return `/skin/${skin}${extension}`;
}

/**
 * Kick off Meshy generation for an image under public/skin/. Accepts "beach",
 * "beach.png", "/skin/beach.png", or "public/skin/beach.png". The image is sent
 * as a data URI so local dev works without a public URL.
 */
export async function startSkinModel(imageRef: string): Promise<SkinModelEntry> {
  const file = await resolveSkinImage(imageRef);
  const skin = sanitizeSkinName(file);

  const bytes = await fs.readFile(path.join(SKIN_DIR, file));
  const mime = IMAGE_MIME[path.extname(file).toLowerCase()];
  const dataUri = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

  const taskId = await createMeshyImageTo3dTask(dataUri);
  const entry: SkinModelEntry = {
    skin,
    image: `/skin/${file}`,
    taskId,
    status: "pending",
    progress: 0,
    updatedAt: new Date().toISOString(),
  };
  await updateManifest(entry);
  return entry;
}

/**
 * Poll one manifest entry. On SUCCEEDED, downloads the GLB (Meshy model URLs
 * expire) to public/models/<skin>.glb and finalizes the entry.
 */
export async function checkSkinModel(skin: string): Promise<SkinModelEntry> {
  const name = sanitizeSkinName(skin);
  const manifest = await readManifest();
  const entry = manifest[name];
  if (!entry) throw new Error(`No skin-model task found for ${JSON.stringify(name)}`);
  if (entry.status === "succeeded" || entry.status === "failed") return entry;

  const task = await getMeshyImageTo3dTask(entry.taskId);
  const next: SkinModelEntry = {
    ...entry,
    progress: task.progress,
    thumbnail: task.thumbnailUrl ?? entry.thumbnail,
    status: task.status === "SUCCEEDED" ? "succeeded"
      : task.status === "FAILED" || task.status === "CANCELED" ? "failed"
      : task.status === "IN_PROGRESS" ? "running"
      : "pending",
    error: task.error ?? undefined,
    updatedAt: new Date().toISOString(),
  };

  if (next.status === "succeeded") {
    if (!task.glbUrl) {
      next.status = "failed";
      next.error = "Meshy reported success but returned no GLB URL";
    } else {
      next.model = await downloadModel(task.glbUrl, name);
      next.progress = 100;
    }
  }

  await updateManifest(next);
  return next;
}

export async function readManifest(): Promise<SkinModelManifest> {
  try {
    return JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8")) as SkinModelManifest;
  } catch {
    return {};
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Map a user-supplied reference to a real filename inside public/skin/ only. */
async function resolveSkinImage(imageRef: string): Promise<string> {
  const base = path.basename(imageRef.trim());
  const candidates = path.extname(base)
    ? [base]
    : Object.keys(IMAGE_MIME).map((ext) => `${base}${ext}`);
  for (const candidate of candidates) {
    if (!IMAGE_MIME[path.extname(candidate).toLowerCase()]) continue;
    try {
      await fs.access(path.join(SKIN_DIR, candidate));
      return candidate;
    } catch {
      // try the next extension
    }
  }
  throw new Error(`Image not found under public/skin/: ${JSON.stringify(imageRef)}`);
}

async function downloadModel(glbUrl: string, skin: string): Promise<string> {
  const res = await fetch(glbUrl);
  if (!res.ok) throw new Error(`GLB download failed (${res.status})`);
  await fs.mkdir(MODELS_DIR, { recursive: true });
  const filePath = path.join(MODELS_DIR, `${skin}.glb`);
  await fs.writeFile(filePath, Buffer.from(await res.arrayBuffer()));
  return `/models/${skin}.glb`;
}

async function updateManifest(entry: SkinModelEntry): Promise<void> {
  await fs.mkdir(MODELS_DIR, { recursive: true });
  const manifest = await readManifest();
  manifest[entry.skin] = entry;
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}
