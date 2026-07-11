// ─── /world — the Agent World demo surface (plan §4) ────────────────────────
// ?mode=replay&demo=kfc  → bundled demo timelines (stage default)
// ?mode=live&experiment=<id> → LiveDriver against the /api/experiment proxy

import "./world.css";
import WorldApp from "./components/WorldApp";

export const metadata = {
  title: "Agent World — Same 100 people. Two realities.",
};

export default async function WorldPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const experimentId = first(params.experiment);
  const mode = first(params.mode) === "live" && experimentId ? "live" : "replay";
  const demo = first(params.demo) ?? "kfc";

  return <WorldApp mode={mode} demo={demo} experimentId={experimentId} />;
}

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
