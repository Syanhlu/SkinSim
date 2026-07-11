import { runAgentConsistency } from "./agent-consistency";
import { decisionCases, scoreDecisionCase } from "./decisions";
import { runStatsValidation } from "./stats.test";

async function main() {
  const stats = runStatsValidation();
  const statPasses = stats.filter((result) => result.passed).length;
  const decisions = decisionCases.map(scoreDecisionCase);
  const decisionPasses = decisions.filter((result) => result.passed).length;
  const consistency = await runAgentConsistency();
  const consistencyPasses = consistency.filter((result) => result.passed).length;

  console.log("\nSTATS VALIDATION (vs scipy / statsmodels)");
  for (const result of stats) {
    const marker = result.passed ? "PASS" : "FAIL";
    console.log(
      `${marker} ${result.name}: actual=${result.actual} expected=${result.expected} tolerance=${result.tolerance}`,
    );
  }

  console.log("\nDECISION QUALITY");
  for (const result of decisions) {
    const marker = result.passed ? "PASS" : "FAIL";
    console.log(`${marker} ${result.id}: expected=${result.expected} actual=${result.actual}`);
  }

  console.log("\nAGENT ↔ ENGINE CONSISTENCY (LLM never computes stats)");
  for (const result of consistency) {
    const marker = result.passed ? "PASS" : "FAIL";
    console.log(`${marker} ${result.id}: ${result.detail}`);
  }

  const statPct = Math.round((100 * statPasses) / stats.length);
  const decisionPct = Math.round((100 * decisionPasses) / decisions.length);
  const consistencyPct = Math.round((100 * consistencyPasses) / consistency.length);

  console.log(
    `\nHEADLINE: stats-validation ${statPasses}/${stats.length} (${statPct}%) + ` +
      `decision-quality ${decisionPasses}/${decisions.length} (${decisionPct}%) + ` +
      `agent-consistency ${consistencyPasses}/${consistency.length} (${consistencyPct}%)\n`,
  );

  if (
    statPasses !== stats.length ||
    decisionPasses !== decisions.length ||
    consistencyPasses !== consistency.length
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
