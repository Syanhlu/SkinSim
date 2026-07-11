import { createMockExperimentResults, type DemoScenario, type MockExperimentInput } from "./mock-results";
import type { ExperimentResults } from "./stats";

export interface SimInput extends MockExperimentInput {
  hypothesis: string;
}

export interface SimClient {
  generateExperimentResults(input: SimInput): Promise<ExperimentResults>;
}

export class MockSimClient implements SimClient {
  async generateExperimentResults(input: SimInput): Promise<ExperimentResults> {
    return createMockExperimentResults(input);
  }
}

export class MiroSharkClient implements SimClient {
  constructor(private baseUrl: string) {}

  async generateExperimentResults(input: SimInput): Promise<ExperimentResults> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/experiments/ab-test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`MiroShark ${res.status}: ${await res.text()}`);
    return (await res.json()) as ExperimentResults;
  }
}

export function getSimClient(): SimClient {
  const url = process.env.MIROSHARK_URL;
  return url ? new MiroSharkClient(url) : new MockSimClient();
}

export function normalizeScenario(value: unknown): DemoScenario {
  if (
    value === "ship" ||
    value === "underpowered" ||
    value === "peeking" ||
    value === "novelty" ||
    value === "guardrail" ||
    value === "flat"
  ) {
    return value;
  }
  return "ship";
}
