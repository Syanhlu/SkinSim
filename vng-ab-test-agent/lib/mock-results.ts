import type { ExperimentResults, GuardrailObservation, MetricType, VariantObservation } from "./stats";

export type DemoScenario = "ship" | "underpowered" | "peeking" | "novelty" | "guardrail" | "flat";

export interface MockExperimentInput {
  scenario: DemoScenario;
  metric: string;
  metricType: MetricType;
  unit: string;
  alpha: number;
  requiredSampleSizePerVariant: number;
  plannedDays: number;
}

export const demoScenarios: Array<{ id: DemoScenario; label: string; summary: string }> = [
  {
    id: "ship",
    label: "Clean lift",
    summary: "Enough sample, significant lift, guardrails clean.",
  },
  {
    id: "underpowered",
    label: "Underpowered",
    summary: "Directionally positive but far below the planned sample.",
  },
  {
    id: "peeking",
    label: "Peeking",
    summary: "Looks significant early, but the team checked before the stop rule.",
  },
  {
    id: "novelty",
    label: "Novelty spike",
    summary: "Early lift is large, but the effect decays by day seven.",
  },
  {
    id: "guardrail",
    label: "Guardrail fail",
    summary: "Primary metric wins while crash-rate guardrail regresses.",
  },
  {
    id: "flat",
    label: "Flat result",
    summary: "Properly powered readout with no convincing treatment effect.",
  },
];

export function createMockExperimentResults(input: MockExperimentInput): ExperimentResults {
  const common = {
    metric: input.metric,
    metricType: input.metricType,
    primaryUnit: input.unit,
    alpha: input.alpha,
    requiredSampleSizePerVariant: input.requiredSampleSizePerVariant,
    plannedDays: input.plannedDays,
  };

  if (input.metricType === "continuous") {
    return createContinuousResults(input);
  }

  if (input.metricType === "count") {
    return createCountResults(input);
  }

  if (input.scenario === "underpowered") {
    return {
      ...common,
      id: "mock-underpowered",
      observedDays: 1,
      variants: [
        { name: "control", visitors: 600, conversions: 36 },
        { name: "treatment", visitors: 600, conversions: 45 },
      ],
      guardrails: cleanGuardrails(),
      notes: ["MiroShark mock: early cohort reacted positively, but sample is too small for a decision."],
    };
  }

  if (input.scenario === "peeking") {
    return {
      ...common,
      id: "mock-peeking",
      observedDays: 2,
      peeking: true,
      variants: [
        { name: "control", visitors: 9000, conversions: 540 },
        { name: "treatment", visitors: 9000, conversions: 615 },
      ],
      guardrails: cleanGuardrails(),
      notes: ["MiroShark mock: day-two lift is tempting, but the planned stop rule has not been reached."],
    };
  }

  if (input.scenario === "novelty") {
    return {
      ...common,
      id: "mock-novelty",
      observedDays: input.plannedDays,
      noveltyRisk: true,
      variants: [
        { name: "control", visitors: 12000, conversions: 720 },
        { name: "treatment", visitors: 12000, conversions: 860 },
      ],
      guardrails: cleanGuardrails(),
      notes: [
        "MiroShark mock: day-one lift was +28%, but the last three days stabilized near +3%.",
        "The recommendation should demand another cycle instead of shipping on launch novelty.",
      ],
    };
  }

  if (input.scenario === "guardrail") {
    return {
      ...common,
      id: "mock-guardrail",
      observedDays: input.plannedDays,
      variants: [
        { name: "control", visitors: 12000, conversions: 720 },
        { name: "treatment", visitors: 12000, conversions: 870 },
      ],
      guardrails: [
        ...cleanGuardrails().slice(0, 2),
        {
          name: "Crash rate",
          unit: "sessions",
          direction: "increase",
          control: 0.007,
          treatment: 0.013,
          threshold: 0.003,
          severity: "critical",
        },
      ],
      notes: ["MiroShark mock: monetization UI increased conversion but triggered client instability."],
    };
  }

  if (input.scenario === "flat") {
    return {
      ...common,
      id: "mock-flat",
      observedDays: input.plannedDays,
      variants: [
        { name: "control", visitors: 12000, conversions: 720 },
        { name: "treatment", visitors: 12000, conversions: 735 },
      ],
      guardrails: cleanGuardrails(),
      notes: ["MiroShark mock: players noticed the change, but behavior did not materially move."],
    };
  }

  return {
    ...common,
    id: "mock-ship",
    observedDays: input.plannedDays,
    variants: [
      { name: "control", visitors: 15000, conversions: 900 },
      { name: "treatment", visitors: 15000, conversions: 1050 },
    ],
    guardrails: cleanGuardrails(),
    notes: ["MiroShark mock: response is broadly positive, and late-cohort behavior holds steady."],
  };
}

function createContinuousResults(input: MockExperimentInput): ExperimentResults {
  const common = {
    metric: input.metric,
    metricType: input.metricType,
    primaryUnit: input.unit,
    alpha: input.alpha,
    requiredSampleSizePerVariant: input.requiredSampleSizePerVariant,
    plannedDays: input.plannedDays,
  };

  if (input.scenario === "underpowered") {
    return {
      ...common,
      id: "mock-continuous-underpowered",
      observedDays: 1,
      variants: [
        { name: "control", visitors: 400, mean: 1.2, standardDeviation: 2.1 },
        { name: "treatment", visitors: 400, mean: 1.27, standardDeviation: 2.15 },
      ],
      guardrails: cleanGuardrails(),
      notes: ["MiroShark mock: revenue moved directionally, but sample is too small for a decision."],
    };
  }

  if (input.scenario === "guardrail") {
    return {
      ...common,
      id: "mock-continuous-guardrail",
      observedDays: input.plannedDays,
      variants: [
        { name: "control", visitors: 12000, mean: 1.2, standardDeviation: 2.1 },
        { name: "treatment", visitors: 12000, mean: 1.34, standardDeviation: 2.2 },
      ],
      guardrails: [
        ...cleanGuardrails().slice(0, 2),
        {
          name: "Crash rate",
          unit: "sessions",
          direction: "increase",
          control: 0.007,
          treatment: 0.013,
          threshold: 0.003,
          severity: "critical",
        },
      ],
      notes: ["MiroShark mock: payer response improved while the client became less stable."],
    };
  }

  if (input.scenario === "flat") {
    return {
      ...common,
      id: "mock-continuous-flat",
      observedDays: input.plannedDays,
      variants: [
        { name: "control", visitors: 12000, mean: 1.2, standardDeviation: 2.1 },
        { name: "treatment", visitors: 12000, mean: 1.21, standardDeviation: 2.12 },
      ],
      guardrails: cleanGuardrails(),
      notes: ["MiroShark mock: ARPU is effectively unchanged after the full readout."],
    };
  }

  return {
    ...common,
    id: `mock-continuous-${input.scenario}`,
    observedDays: input.scenario === "peeking" ? 2 : input.plannedDays,
    peeking: input.scenario === "peeking" ? true : undefined,
    noveltyRisk: input.scenario === "novelty" ? true : undefined,
    variants: [
      { name: "control", visitors: 15000, mean: 1.2, standardDeviation: 2.1 },
      { name: "treatment", visitors: 15000, mean: 1.34, standardDeviation: 2.16 },
    ],
    guardrails: cleanGuardrails(),
    notes:
      input.scenario === "novelty"
        ? ["MiroShark mock: ARPU lift is front-loaded and decays across later cohorts."]
        : ["MiroShark mock: payer behavior improves and remains stable."],
  };
}

// Count/rate metrics (crash rate) carry real per-variant event + exposure data so the
// chi-square readout runs on genuine crash counts, not recycled conversion numbers.
function createCountResults(input: MockExperimentInput): ExperimentResults {
  const common = {
    metric: input.metric,
    metricType: input.metricType,
    primaryUnit: input.unit,
    alpha: input.alpha,
    requiredSampleSizePerVariant: input.requiredSampleSizePerVariant,
    plannedDays: input.plannedDays,
  };

  // events = crashes, exposure = sessions, visitors mirrors exposure for sample-size traps.
  const countVariant = (name: string, sessions: number, crashes: number): VariantObservation => ({
    name,
    visitors: sessions,
    exposure: sessions,
    events: crashes,
  });

  if (input.scenario === "underpowered") {
    return {
      ...common,
      id: "mock-count-underpowered",
      observedDays: 1,
      variants: [countVariant("control", 3000, 27), countVariant("treatment", 3000, 21)],
      guardrails: cleanGuardrails(),
      notes: ["MiroShark mock: crash rate trended down, but exposure is far below the planned sample."],
    };
  }

  if (input.scenario === "peeking") {
    return {
      ...common,
      id: "mock-count-peeking",
      observedDays: 2,
      peeking: true,
      variants: [countVariant("control", 50000, 450), countVariant("treatment", 50000, 360)],
      guardrails: cleanGuardrails(),
      notes: ["MiroShark mock: crash rate looks better on day two, but the stop rule has not been reached."],
    };
  }

  if (input.scenario === "novelty") {
    return {
      ...common,
      id: "mock-count-novelty",
      observedDays: input.plannedDays,
      noveltyRisk: true,
      variants: [countVariant("control", 50000, 450), countVariant("treatment", 50000, 372)],
      guardrails: cleanGuardrails(),
      notes: ["MiroShark mock: early crash reduction fades as later cohorts hit the same code paths."],
    };
  }

  if (input.scenario === "guardrail") {
    return {
      ...common,
      id: "mock-count-guardrail",
      observedDays: input.plannedDays,
      variants: [countVariant("control", 50000, 450), countVariant("treatment", 50000, 360)],
      guardrails: [
        {
          name: "D7 retention",
          unit: "players",
          direction: "decrease",
          control: 0.381,
          treatment: 0.36,
          threshold: 0.015,
          severity: "critical",
        },
        ...cleanGuardrails().slice(1),
      ],
      notes: ["MiroShark mock: the reliability fix cut crashes but a heavier client hurt D7 retention."],
    };
  }

  if (input.scenario === "flat") {
    return {
      ...common,
      id: "mock-count-flat",
      observedDays: input.plannedDays,
      variants: [countVariant("control", 50000, 450), countVariant("treatment", 50000, 445)],
      guardrails: cleanGuardrails(),
      notes: ["MiroShark mock: crash rate is effectively unchanged after the full readout."],
    };
  }

  return {
    ...common,
    id: "mock-count-ship",
    observedDays: input.plannedDays,
    variants: [countVariant("control", 50000, 450), countVariant("treatment", 50000, 360)],
    guardrails: cleanGuardrails(),
    notes: ["MiroShark mock: crash rate drops from 0.90% to 0.72% and holds across later cohorts."],
  };
}

function cleanGuardrails(): GuardrailObservation[] {
  return [
    {
      name: "D7 retention",
      unit: "players",
      direction: "decrease",
      control: 0.381,
      treatment: 0.379,
      threshold: 0.015,
      severity: "critical",
    },
    {
      name: "ARPPU",
      unit: "USD/player",
      direction: "decrease",
      control: 3.42,
      treatment: 3.46,
      threshold: 0.08,
      severity: "watch",
    },
    {
      name: "Crash rate",
      unit: "sessions",
      direction: "increase",
      control: 0.007,
      treatment: 0.0076,
      threshold: 0.003,
      severity: "critical",
    },
  ];
}
