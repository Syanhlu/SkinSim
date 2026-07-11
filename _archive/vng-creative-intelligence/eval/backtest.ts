import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateBacktest, parseAdsCsv } from "../lib/analysis";

const here = dirname(fileURLToPath(import.meta.url));
const csv = readFileSync(join(here, "..", "data", "ads.sample.csv"), "utf8");
const rows = parseAdsCsv(csv);
const result = calculateBacktest(rows);

console.log("");
console.log(
  `HEADLINE: Following the agent's top recommendation lifts pLTV-weighted ROAS by ${result.liftVsPortfolioPct.toFixed(
    1,
  )}% vs the holdout portfolio.`,
);
console.log(
  `          95% CI ${signed(result.uncertainty.lowerPct)}% to ${signed(
    result.uncertainty.upperPct,
  )}%, permutation p=${result.uncertainty.permutationPValue.toFixed(3)}.`,
);
console.log(`          (and by ${result.liftVsRejectedPct.toFixed(1)}% vs the themes the agent rejected).`);
console.log("");
console.log(`Recommended theme(s): ${result.recommendedLabels.join(" | ")}`);
console.log(`Recommended-theme holdout pLTV ROAS: ${result.selectedRoas.toFixed(2)}x`);
console.log(`Portfolio holdout pLTV ROAS:         ${result.baselineRoas.toFixed(2)}x`);
console.log(`Rejected-theme holdout pLTV ROAS:    ${result.rejectedRoas.toFixed(2)}x`);
console.log(`Selected holdout spend: $${Math.round(result.selectedSpend).toLocaleString("en-US")} of $${Math.round(result.holdoutSpend).toLocaleString("en-US")}`);
console.log(`Selected creatives: ${result.selectedCreatives.join(", ")}`);
console.log("");
console.log("Baseline comparison:");
for (const comparison of result.selectorComparisons) {
  console.log(
    `- ${comparison.label}: ${comparison.themeLabel} -> ${comparison.holdoutRoas.toFixed(2)}x holdout pLTV ROAS (${signed(
      comparison.liftVsPortfolioPct,
    )}% vs portfolio)`,
  );
}
console.log("");
console.log(`Methodology: ${result.methodology}`);
console.log("");

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
