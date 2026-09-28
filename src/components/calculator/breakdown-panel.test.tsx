import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RoutedSelfHostBreakdownPanel } from "@/components/calculator/breakdown-panel";
import type { OpenSourceModel, RoutedSelfHostCostBreakdown, SelfHostCostBreakdown, SelfHostTierResult } from "@/lib/types";

function tierBreakdown(overrides: Partial<SelfHostCostBreakdown>): SelfHostCostBreakdown {
  return {
    modelId: "test-model",
    hostingKind: "cloud",
    requiredThroughputTokPerSec: 10,
    gpuThroughputTokPerSec: 100,
    replicas: 1,
    gpusNeeded: 1,
    limitingFactor: "minimum-footprint",
    servingPattern: "batch",
    peakConcurrentUsers: 0,
    activeHoursPerMonth: 217.26,
    billedHoursPerMonth: 730,
    vramHeadroomWarning: false,
    utilizationPct: 50,
    computeCostMonthly: 0,
    electricityCostMonthly: 0,
    overheadCostMonthly: 0,
    totalMonthlyCost: 0,
    hardwareCostOneTimeUsd: 0,
    recurringMonthlyCostExclHardware: 0,
    costPerDocument: 0,
    annualCost: 0,
    ...overrides,
  };
}

const highModel: OpenSourceModel = {
  id: "high-model",
  name: "High Model",
  family: "Test",
  paramsB: 70,
  vramFp16GB: 140,
  vramInt4GB: 40,
  recommendedGpuLabel: "1x A100 80GB",
  minGpuType: "A100-80GB",
  minGpuCount: 1,
  intelligenceScore: 60,
  throughputTokPerSecOnBaseline: 1000,
  tier: "balanced",
  license: "Test",
  goodFor: [],
  blurb: "",
};

const lowModel: OpenSourceModel = { ...highModel, id: "low-model", name: "Low Model", minGpuType: "L4" };

// Two regions, each contributing one "high" and one "low" tier entry - the
// same shape aggregateRoutedSelfHostBreakdowns produces via flatMap, which
// repeats each tier once per region rather than merging them.
const regionAHigh: SelfHostTierResult = {
  tier: "high",
  modelId: highModel.id,
  docsPerMonth: 100,
  breakdown: tierBreakdown({
    computeCostMonthly: 800,
    overheadCostMonthly: 200,
    totalMonthlyCost: 1000,
    recurringMonthlyCostExclHardware: 1000,
    limitingFactor: "minimum-footprint",
    gpusNeeded: 1,
    replicas: 1,
  }),
};
const regionBHigh: SelfHostTierResult = {
  tier: "high",
  modelId: highModel.id,
  docsPerMonth: 150,
  breakdown: tierBreakdown({
    computeCostMonthly: 1200,
    overheadCostMonthly: 300,
    totalMonthlyCost: 1500,
    recurringMonthlyCostExclHardware: 1500,
    limitingFactor: "volume",
    gpusNeeded: 2,
    replicas: 2,
  }),
};
const regionALow: SelfHostTierResult = {
  tier: "low",
  modelId: lowModel.id,
  docsPerMonth: 300,
  breakdown: tierBreakdown({
    computeCostMonthly: 250,
    overheadCostMonthly: 50,
    totalMonthlyCost: 300,
    recurringMonthlyCostExclHardware: 300,
  }),
};
const regionBLow: SelfHostTierResult = {
  tier: "low",
  modelId: lowModel.id,
  docsPerMonth: 450,
  breakdown: tierBreakdown({
    computeCostMonthly: 375,
    overheadCostMonthly: 75,
    totalMonthlyCost: 450,
    recurringMonthlyCostExclHardware: 450,
  }),
};

const routedBreakdown: RoutedSelfHostCostBreakdown = {
  tiers: [regionAHigh, regionBHigh, regionALow, regionBLow],
  routerCost: 50,
  totalMonthlyCost: 1000 + 1500 + 300 + 450 + 50,
  costPerDocument: (1000 + 1500 + 300 + 450 + 50) / 1000,
  annualCost: (1000 + 1500 + 300 + 450 + 50) * 12,
  baselineCost: 5000,
  savingsAmount: 5000 - (1000 + 1500 + 300 + 450 + 50),
  savingsPct: ((5000 - (1000 + 1500 + 300 + 450 + 50)) / 5000) * 100,
  totalGpusNeeded: 1 + 2 + 1 + 1,
};

describe("RoutedSelfHostBreakdownPanel - multi-region tier aggregation (regression)", () => {
  it("combines every region's copy of a tier instead of showing only the first region's", () => {
    render(
      <RoutedSelfHostBreakdownPanel
        highModel={highModel}
        mediumModel={null}
        lowModel={lowModel}
        isOwned={false}
        depreciationYears={3}
        breakdown={routedBreakdown}
      />,
    );

    // High: two regions (100 + 150 docs, $1,000 + $1,500) must be summed, not
    // just region A's 100 docs / $1,000 shown alone.
    expect(screen.getByText(/250 of 1,000 docs\/mo/)).toBeInTheDocument();
    expect(screen.getByText("High Model (High)").parentElement!.nextElementSibling!.textContent).toBe(
      "$2,500",
    );

    // Low: two regions (300 + 450 docs, $300 + $450) must be summed too.
    expect(screen.getByText(/750 of 1,000 docs\/mo/)).toBeInTheDocument();
    expect(screen.getByText("Low Model (Low)").parentElement!.nextElementSibling!.textContent).toBe(
      "$750",
    );

    // The grand total was already computed independently and stays correct
    // either way (shown twice: the big total and the "Total" line item) -
    // this alone would NOT have caught the bug.
    expect(screen.getAllByText("$3,300").length).toBeGreaterThanOrEqual(2);
  });
});
