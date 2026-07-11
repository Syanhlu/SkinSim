import { runGenerationPipeline } from "@/lib/gen";
import { z } from "zod";

export const maxDuration = 300;

const BodySchema = z.object({
  theme: z.string().min(1),
});

export async function POST(req: Request) {
  const body = BodySchema.parse(await req.json());
  const result = await runGenerationPipeline(body.theme, { publicOrigin: new URL(req.url).origin });

  return Response.json(result);
}
