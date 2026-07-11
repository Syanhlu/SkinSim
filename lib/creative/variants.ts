// ─── Variant Studio (Phase 5) ─────────────────────────────────────────────────
// proposeVariants(hypothesis, brief?) — the agent proposes 2–3 Vietnamese ad-copy
// variants (≤140 chars, distinct angles: price / social / novelty) with one-line
// strategy notes, via AI SDK v5 generateObject. When no AI key is configured, or
// on ANY model/validation error, it returns a deterministic hand-written fallback
// derived from simple keyword inspection of the hypothesis — labeled
// `source: "fallback"`. This function NEVER throws.
//
// generateVariantImage(prompt) wraps the Nano Banana adapter (lib/creative/
// gen-adapters.ts, unmodified) and always supplies a deterministic bundled
// fallback asset from /public/creative so the UI never renders an empty TV.
//
// Server-only.

import { generateObject } from "ai";
import { z } from "zod";
import { AGENT_MODEL } from "../ai";
import { generateSkinImage, isNanoBananaEnabled } from "./gen-adapters";

// ─── Types ────────────────────────────────────────────────────────────────────

export type VariantAngle = "price" | "social" | "novelty";

export interface ProposedVariant {
  /** Short label used in the experiment ("A", "B", "C"). */
  name: string;
  /** Vietnamese ad copy, ≤140 chars. */
  text: string;
  /** The creative angle this variant attacks. Angles are distinct across a proposal. */
  angle: VariantAngle;
  /** One-line operator-facing note on why this angle might win. */
  strategyNote: string;
  /** Optional English prompt for image generation (generateVariantImage). */
  imagePrompt?: string;
}

export interface VariantProposal {
  variants: ProposedVariant[];
  /** "agent" = LLM-generated via generateObject; "fallback" = deterministic hand-written. */
  source: "agent" | "fallback";
}

export interface VariantBrief {
  metric?: string;
  direction?: string;
}

// ─── LLM path ─────────────────────────────────────────────────────────────────

const MAX_COPY_CHARS = 140;

const proposalSchema = z.object({
  variants: z
    .array(
      z.object({
        name: z.string().min(1).describe('Short variant label: "A", "B", or "C"'),
        text: z
          .string()
          .min(1)
          .describe("Vietnamese ad copy, maximum 140 characters, concrete offer or hook"),
        angle: z.enum(["price", "social", "novelty"]),
        strategyNote: z
          .string()
          .min(1)
          .describe("One line, in English: which audience segment this angle targets and why it could win"),
        imagePrompt: z
          .string()
          .optional()
          .describe("Optional short English prompt for an ad-creative image matching the copy"),
      })
    )
    .min(2)
    .max(3),
});

function hasAiKey(): boolean {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN ||
      process.env.ANTHROPIC_API_KEY
  );
}

/**
 * Propose 2–3 Vietnamese ad-copy variants for the hypothesis. Never throws:
 * with no AI key, or on any generation/validation failure, returns the
 * deterministic fallback proposal (source: "fallback").
 */
export async function proposeVariants(
  hypothesis: string,
  brief?: VariantBrief
): Promise<VariantProposal> {
  const text = (hypothesis ?? "").trim();
  if (!text || !hasAiKey()) return fallbackProposal(text);

  try {
    const briefLine = [
      brief?.metric ? `Primary metric: ${brief.metric}.` : "",
      brief?.direction ? `Desired direction: ${brief.direction}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const { object } = await generateObject({
      model: AGENT_MODEL,
      schema: proposalSchema,
      abortSignal: AbortSignal.timeout(45_000),
      system: [
        "You are a senior Vietnamese performance-marketing copywriter for fast-food / consumer campaigns",
        "(think KFC Vietnam vs Lotteria/Jollibee, ShopeeFood/GrabFood price wars, Gen Z Threads discourse).",
        "Given an experiment hypothesis, propose 2-3 ad variants for a synthetic A/B test.",
        "Rules:",
        "- `text` is the ad copy shown to consumers: natural, punchy VIETNAMESE, max 140 characters,",
        "  with a concrete offer, price point, or hook (e.g. 'combo 89k', 'mua 1 tặng 1 thứ Ba').",
        "- Each variant takes a DIFFERENT angle: price (value/discount), social (friends/sharing/community),",
        "  novelty (new flavor/limited drop/trend). Never repeat an angle.",
        "- `strategyNote` is ONE line in English for the operator: target segment + why this angle could win.",
        "- `imagePrompt` (optional) is a short English prompt for an ad image matching the copy.",
        "- Name variants A, B, C in order.",
      ].join("\n"),
      prompt: `Hypothesis: ${text}${briefLine ? `\n${briefLine}` : ""}`,
    });

    const cleaned = sanitizeVariants(object.variants);
    if (!cleaned) return fallbackProposal(text);
    return { variants: cleaned, source: "agent" };
  } catch {
    return fallbackProposal(text);
  }
}

/** Enforce the contract on model output: 2–3 variants, distinct angles, ≤140-char copy, one-line notes. */
function sanitizeVariants(raw: ProposedVariant[]): ProposedVariant[] | null {
  const seen = new Set<VariantAngle>();
  const out: ProposedVariant[] = [];
  const labels = ["A", "B", "C"];
  for (const v of raw) {
    if (seen.has(v.angle)) continue; // drop duplicate angles rather than fail
    seen.add(v.angle);
    out.push({
      name: labels[out.length] ?? v.name,
      text: clampCopy(v.text),
      angle: v.angle,
      strategyNote: oneLine(v.strategyNote),
      ...(v.imagePrompt ? { imagePrompt: oneLine(v.imagePrompt) } : {}),
    });
    if (out.length === 3) break;
  }
  return out.length >= 2 ? out : null;
}

function clampCopy(text: string): string {
  const t = oneLine(text);
  return t.length <= MAX_COPY_CHARS ? t : `${t.slice(0, MAX_COPY_CHARS - 1).trimEnd()}…`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ─── Deterministic fallback ───────────────────────────────────────────────────
// Hand-written KFC-Vietnam-style variants, lightly adapted by keyword inspection
// of the hypothesis so the copy stays on-topic without any model call.

function fallbackProposal(hypothesis: string): VariantProposal {
  const h = hypothesis.toLowerCase();
  const mentionsApp = /\bapp\b|giao hàng|delivery|shopeefood|grabfood|đặt hàng|online/.test(h);
  const mentionsSpicy = /cay|spicy/.test(h);
  const mentionsStudent = /sinh viên|student|học sinh|gen z/.test(h);
  const mentionsCombo = /combo|bữa|meal|gia đình|family/.test(h);

  const price: ProposedVariant = {
    name: "A",
    angle: "price",
    text: mentionsApp
      ? "Gà Rán Giòn Cay — combo 89k, giảm thêm 30% cho đơn đầu tiên đặt trên app. Nhanh tay kẻo hết!"
      : "Combo Gà Rán 89k — no bụng cả nhóm, rẻ hơn cơm trưa văn phòng. Chỉ tuần này!",
    strategyNote: mentionsStudent
      ? "Hard price anchor for price-sensitive students; a concrete 89k beats vague % discounts in inflation-wary 2026."
      : "Value anchor for price-sensitive segments (students, families); concrete price + first-order hook drives trial.",
    imagePrompt:
      "Crispy fried chicken combo meal on a bright red promo banner, large 89K price tag, Vietnamese fast-food ad style",
  };

  const social: ProposedVariant = {
    name: "B",
    angle: "social",
    text: mentionsCombo
      ? "KFC x Bạn Thân — mua 1 combo tặng 1 mỗi thứ Ba. Rủ cả hội, chia đôi vui gấp đôi!"
      : "KFC x Bạn Thân — mua 1 tặng 1 thứ Ba hàng tuần, chỉ tại cửa hàng. Rủ bạn đi liền!",
    strategyNote:
      "Buy-one-get-one leans on group dining culture and friend referrals; wins if sharing beats solo value on this audience.",
    imagePrompt:
      "Two young Vietnamese friends laughing and sharing a fried chicken bucket in a fast-food restaurant, warm ad photography",
  };

  const novelty: ProposedVariant = {
    name: "C",
    angle: "novelty",
    text: mentionsSpicy
      ? "Vị mới cực cháy: Gà Giòn Cay Sốt Ớt Sữa — chỉ bán 2 tuần. Dám thử độ cay này không?"
      : "Ra mắt Gà Giòn Sốt Trứng Muối — vị mới chỉ có 2 tuần. Thử ngay kẻo lỡ trend!",
    strategyNote:
      "Limited-time new flavor targets Gen Z trend-chasers on Threads/TikTok; scarcity framing drives fast trial and talk.",
    imagePrompt: mentionsSpicy
      ? "Extra-spicy fried chicken with chili sauce, fiery red background, bold 'limited 2 weeks' badge, Vietnamese ad style"
      : "Salted-egg-sauce fried chicken glistening close-up, golden tones, 'new flavor' burst sticker, Vietnamese ad style",
  };

  return { variants: [price, social, novelty], source: "fallback" };
}

// ─── Image generation helper ──────────────────────────────────────────────────

/** Bundled placeholder creatives; the UI shows one of these whenever live gen is off/fails. */
export const FALLBACK_CREATIVE_ASSETS = [
  "/creative/celestial-dragon.png",
  "/creative/chibi-festival.png",
  "/creative/cozy-pets.png",
  "/creative/gilded-vault.png",
  "/creative/gothic-vampire.png",
  "/creative/hypercasual-candy.png",
  "/creative/neon-mecha.png",
  "/creative/ocean-guardian.png",
  "/creative/retro-arcade.png",
  "/creative/street-racing.png",
] as const;

export interface VariantImage {
  /** Live-generated data URL (Nano Banana), or null when the key is unset / the call failed. */
  url: string | null;
  /** Always present: a bundled /creative/*.png chosen deterministically from the prompt. */
  fallbackAsset: string;
}

export { isNanoBananaEnabled };

/**
 * Generate an ad image for a variant. Wraps generateSkinImage (Nano Banana when
 * NANO_BANANA_KEY is set) and never throws — on any failure `url` is null and
 * the caller uses `fallbackAsset` (labeled fallback in the UI).
 */
export async function generateVariantImage(prompt: string): Promise<VariantImage> {
  const fallbackAsset = pickFallbackAsset(prompt);
  try {
    const url = await generateSkinImage(prompt);
    return { url, fallbackAsset };
  } catch {
    return { url: null, fallbackAsset };
  }
}

/** Deterministic FNV-1a hash of the prompt → stable fallback asset choice. */
function pickFallbackAsset(prompt: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < prompt.length; i++) {
    hash ^= prompt.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const idx = (hash >>> 0) % FALLBACK_CREATIVE_ASSETS.length;
  return FALLBACK_CREATIVE_ASSETS[idx];
}
