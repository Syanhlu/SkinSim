import { MockSimClient, getSimClient, type SimVerdict } from "@/lib/sim-client";
import {
  generateSkinImage,
  imageTo3dModel,
  isNanoBananaEnabled,
  isMeshyEnabled,
} from "@/lib/gen-adapters";
import { buildScrapeContext } from "@/lib/scrape-context";

export interface SkinConcept {
  id: string;
  theme: string;
  title: string;
  blurb: string;
  imageUrl: string;
  palette: string[];
  prompt: string;
  /** Where the concept art came from: a live Nano Banana render or the bundled placeholder SVG. */
  imageSource: "nano-banana" | "bundled";
  /** Present when Nano Banana was configured but concept art fell back to bundled assets. */
  imageFallbackReason?: string;
}

export interface ScoredSkinConcept extends SkinConcept {
  reception: SimVerdict;
}

export interface GeneratedModel {
  src: string;
  poster: string;
  alt: string;
  /** Where the GLB came from: a live Meshy image-to-3D job or the bundled placeholder. */
  source: "meshy" | "bundled";
  /** Present when Meshy was configured but model generation fell back to the bundled GLB. */
  fallbackReason?: string;
}

export interface PipelineToolLogEntry {
  name: string;
  status: "ok" | "fallback";
  source: "live" | "mock";
  summary: string;
  fallbackReason?: string;
}

export interface PipelineServiceStatus {
  service: "nano-banana" | "miroshark" | "meshy";
  label: string;
  source: "live" | "mock";
  fallbackReason?: string;
}

export interface GenerationPipelineResult {
  theme: string;
  concepts: ScoredSkinConcept[];
  best: ScoredSkinConcept;
  model: GeneratedModel;
  services: PipelineServiceStatus[];
  toolLog: PipelineToolLogEntry[];
}

export interface GenerationPipelineOptions {
  publicOrigin?: string;
}

const MOCK_CONCEPTS: SkinConcept[] = [
  {
    id: "skin-neon-ronin-prime",
    theme: "cyberpunk-premium__neon-mecha__ronin",
    title: "Ronin Prime: Overclocked Crest",
    blurb: "A tournament-only armor line with lit blade vents, prestige shoulder plates, and a victory lobby stance.",
    imageUrl: "/skins/generated/neon-mecha.png",
    palette: ["ion green", "gunmetal", "hot coral"],
    prompt: "Premium cyberpunk ronin skin, neon mecha armor, readable first frame, status signal for ranked players.",
    imageSource: "bundled",
  },
  {
    id: "skin-neon-oni-aegis",
    theme: "cyberpunk-premium__neon-mecha__ronin",
    title: "Chrome Oni: Aegis Protocol",
    blurb: "A defensive-meets-aggressive variant with a chrome oni mask and animated squad banner hooks.",
    imageUrl: "/skins/generated/neon-mecha.png",
    palette: ["chrome", "signal red", "deep teal"],
    prompt: "Cyberpunk oni ronin, chrome mecha plating, high contrast mask, guild prestige skin concept.",
    imageSource: "bundled",
  },
  {
    id: "skin-starfall-oracle",
    theme: "mythic-luxury__celestial-dragon__oracle",
    title: "Starfall Oracle: Dragon Sigil",
    blurb: "An elegant mage line with constellation armor, dragon halo VFX, and a high-value bundle frame.",
    imageUrl: "/skins/generated/celestial-dragon.png",
    palette: ["midnight violet", "jade", "champagne"],
    prompt: "Mythic luxury oracle skin, celestial dragon motif, elegant premium bundle for late-game spenders.",
    imageSource: "bundled",
  },
  {
    id: "skin-jade-oracle",
    theme: "mythic-luxury__celestial-dragon__oracle",
    title: "Jade Oracle: Eclipse Mark",
    blurb: "A healer/support prestige concept designed for guild leaders who want visible status without loud comedy beats.",
    imageUrl: "/skins/generated/celestial-dragon.png",
    palette: ["black jade", "warm gold", "moonlit blue"],
    prompt: "Celestial dragon oracle, black jade armor, elite support player fantasy, premium mobile game skin.",
    imageSource: "bundled",
  },
];

export async function gen_skins(theme: string): Promise<SkinConcept[]> {
  const normalizedTheme = theme.toLowerCase();
  const matching = MOCK_CONCEPTS.filter((concept) => concept.theme === normalizedTheme);

  const base =
    matching.length > 0
      ? matching
      : MOCK_CONCEPTS.slice(0, 3).map((concept) => ({
          ...concept,
          theme: normalizedTheme,
          prompt: `${concept.prompt} Adapted to recommended theme: ${theme}.`,
        }));

  // Adapter: render on-theme concept art with Nano Banana when NANO_BANANA_KEY is
  // set. The bundled SVG stays as poster + fallback so the pipeline never fails.
  if (!isNanoBananaEnabled()) return base;

  return Promise.all(
    base.map(async (concept) => {
      let rendered: string | null = null;
      let fallbackReason: string | undefined;

      try {
        rendered = await generateSkinImage(concept.prompt);
        if (!rendered) fallbackReason = "Nano Banana returned no image data.";
      } catch (error) {
        fallbackReason = error instanceof Error ? error.message : String(error);
      }

      return rendered
        ? { ...concept, imageUrl: rendered, imageSource: "nano-banana" as const }
        : { ...concept, imageFallbackReason: fallbackReason };
    }),
  );
}

export async function simulate_reception(concept: SkinConcept): Promise<ScoredSkinConcept> {
  const client = getSimClient();
  const document = [
    `Skin concept: ${concept.title}`,
    `Theme: ${concept.theme}`,
    `Blurb: ${concept.blurb}`,
    `Prompt: ${concept.prompt}`,
    `Palette: ${concept.palette.join(", ")}`,
  ].join("\n");

  // Enrichment: pull in real web context (community reaction, news coverage) so the
  // simulation reacts against more than the concept's own description. Best-effort and
  // opt-in — isScrapeContextEnabled() is false unless MIROSHARK_SCRAPE_ENABLED is set, so
  // this never adds latency/cost to a run that doesn't ask for it.
  const urlDocs = isScrapeContextEnabled()
    ? await buildScrapeContext({
        searchQuery: `${concept.theme.replace(/__/g, " ")} ${concept.title} community reaction price`,
        maxDocs: 5,
      })
    : [];

  let reception: SimVerdict;
  try {
    reception = await client.simulate({
      document,
      urlDocs: urlDocs.length > 0 ? urlDocs : undefined,
      options: { horizon: "7d", personas: 240, market: true },
    });
  } catch (error) {
    const fallbackReason = error instanceof Error ? error.message : String(error);
    const mock = await new MockSimClient().simulate({ document });
    reception = {
      ...mock,
      fallbackReason,
      summary: `[MOCK fallback] ${mock.summary.replace(/^\[MOCK\]\s*/, "")}`,
    };
  }

  return { ...concept, reception };
}

function isScrapeContextEnabled(): boolean {
  return process.env.MIROSHARK_SCRAPE_ENABLED === "true";
}

export function pick_best(concepts: ScoredSkinConcept[]): ScoredSkinConcept {
  if (concepts.length === 0) {
    throw new Error("pick_best requires at least one scored concept");
  }

  return [...concepts].sort((a, b) => b.reception.score - a.reception.score)[0];
}

export async function to_3d(
  concept: ScoredSkinConcept,
  options: GenerationPipelineOptions = {},
): Promise<GeneratedModel> {
  const fallback: GeneratedModel = {
    src: "/models/sample-skin.glb",
    poster: concept.imageUrl,
    alt: `${concept.title} placeholder 3D model`,
    source: "bundled",
  };

  // Adapter: turn the winning concept art into a real GLB with Meshy when
  // MESHY_KEY is set; otherwise return the bundled placeholder model.
  if (!isMeshyEnabled()) return fallback;

  let glb: string | null = null;
  let fallbackReason: string | undefined;

  try {
    glb = await imageTo3dModel(toPublicAssetUrl(concept.imageUrl, options.publicOrigin));
    if (!glb) fallbackReason = "Meshy returned no GLB URL before the polling deadline.";
  } catch (error) {
    fallbackReason = error instanceof Error ? error.message : String(error);
  }

  if (!glb) return { ...fallback, fallbackReason };

  return {
    src: glb,
    poster: concept.imageUrl,
    alt: `${concept.title} 3D model (Meshy)`,
    source: "meshy",
  };
}

export async function runGenerationPipeline(
  theme: string,
  options: GenerationPipelineOptions = {},
): Promise<GenerationPipelineResult> {
  const concepts = await gen_skins(theme);
  const scored = await Promise.all(concepts.map(simulate_reception));
  const best = pick_best(scored);
  const model = await to_3d(best, options);
  const nanoFallback = concepts.find((concept) => concept.imageFallbackReason)?.imageFallbackReason;
  const simFallback = scored.find((concept) => concept.reception.fallbackReason)?.reception.fallbackReason;
  const nanoSource = concepts.every((concept) => concept.imageSource === "nano-banana") ? "live" : "mock";
  const simSource = scored.every((concept) => concept.reception.source === "miroshark") ? "live" : "mock";
  const modelSource = model.source === "meshy" ? "live" : "mock";

  return {
    theme,
    concepts: scored,
    best,
    model,
    services: [
      {
        service: "nano-banana",
        label: nanoSource === "live" ? "Nano Banana live" : "Bundled concept art",
        source: nanoSource,
        fallbackReason: nanoFallback,
      },
      {
        service: "miroshark",
        label: simSource === "live" ? "MiroShark live" : "MockSimClient",
        source: simSource,
        fallbackReason: simFallback,
      },
      {
        service: "meshy",
        label: modelSource === "live" ? "Meshy live" : "Bundled GLB",
        source: modelSource,
        fallbackReason: model.fallbackReason,
      },
    ],
    toolLog: [
      {
        name: "gen_skins",
        status: nanoFallback ? "fallback" : "ok",
        source: nanoSource,
        summary: `${concepts.length} concepts (${
          nanoSource === "live" ? "Nano Banana render" : "bundled placeholder art"
        }).`,
        fallbackReason: nanoFallback,
      },
      {
        name: "simulate_reception",
        status: simFallback ? "fallback" : "ok",
        source: simSource,
        summary: `${simSource === "live" ? "MiroShark" : "MockSimClient"} scored each concept.`,
        fallbackReason: simFallback,
      },
      {
        name: "pick_best",
        status: "ok",
        source: "mock",
        summary: `${best.title} ranked highest at ${best.reception.score}/100 from ${scored
          .map((concept) => `${concept.title}: ${concept.reception.score}`)
          .join(", ")}.`,
      },
      {
        name: "to_3d",
        status: model.fallbackReason ? "fallback" : "ok",
        source: modelSource,
        summary: model.source === "meshy" ? "Meshy generated a GLB from the winning art." : "Bundled GLB placeholder returned for model-viewer.",
        fallbackReason: model.fallbackReason,
      },
    ],
  };
}

function toPublicAssetUrl(imageUrl: string, publicOrigin: string | undefined): string {
  if (!imageUrl.startsWith("/")) return imageUrl;
  if (!publicOrigin) return imageUrl;
  return new URL(imageUrl, publicOrigin).toString();
}
