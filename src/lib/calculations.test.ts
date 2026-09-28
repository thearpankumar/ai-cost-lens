import { describe, expect, it } from "vitest";
import {
  aggregateApiBreakdowns,
  aggregateRoutedApiBreakdowns,
  aggregateRoutedSelfHostBreakdowns,
  aggregateSelfHostBreakdowns,
  calculateApiCost,
  calculateRoutedApiCost,
  calculateRoutedSelfHostCost,
  calculateSelfHostCost,
  checkContextWindowFit,
  estimateSelfHostMonthlyCost,
  getActiveHoursPerMonth,
  getCloudBilledHoursPerMonth,
  getDocTokens,
  getModelsCheaperThan,
  getOpenSourceModelsCheaperThan,
  getMonthlyTokenVolume,
  hasVramHeadroomWarning,
  maxConcurrentSequencesFromVram,
  scaleRoutedSelfHostBreakdown,
  scaleSelfHostBreakdown,
  splitDocsAcrossRegions,
  splitTierCounts,
  withDataResidencyPremium,
  withWorkloadShare,
  type HostParams,
  type SelfHostRoutingTier,
} from "@/lib/calculations";
import {
  ASSUMED_AVG_CONTEXT_TOKENS_PER_CONCURRENT_USER,
  DEFAULT_CAPACITY_PROFILE,
  HOURS_PER_MONTH,
  INPUT_TOKEN_COMPUTE_WEIGHT,
  KV_CACHE_MB_PER_TOKEN_PER_B_PARAMS,
  KV_CACHE_USABLE_VRAM_FRACTION,
  TOKENS_PER_PAGE,
  UTILIZATION_TARGET,
  WEEKS_PER_MONTH,
} from "@/lib/data/constants";
import { GPU_INSTANCES, OWN_SERVER_DEFAULTS, OWNED_GPU_SPECS } from "@/lib/data/gpu-instances";
import { COMMERCIAL_MODELS } from "@/lib/data/commercial-models";
import { OPEN_SOURCE_MODELS } from "@/lib/data/opensource-models";
import { ROUTER_TOKENS_PER_DECISION } from "@/lib/data/routing";
import { REGIONS } from "@/lib/data/regions";
import type {
  CommercialModel,
  GpuInstance,
  GpuType,
  OpenSourceModel,
  OwnedGpuSpec,
  RegionAllocation,
  RouterOption,
  WorkloadInputs,
} from "@/lib/types";

const baseWorkload: WorkloadInputs = {
  docsPerMonth: 1000,
  docSizePresetId: "medium", // 8 pages
  customPages: 8,
  taskType: "extraction", // outputRatio 0.12, overhead 350, floor 80
  callsPerDoc: 1,
  useCaching: false,
  useBatchApi: false,
  // Default usage pattern: batch pipeline, 10h/day x 5 days/week.
  capacity: DEFAULT_CAPACITY_PROFILE,
};

// 10h x 5 days x (365/7/12 = 4.345238 weeks/month) = 217.2619 active hours/month
// = 782,142.86 active seconds/month.
const DEFAULT_ACTIVE_SECONDS = 10 * 5 * (365 / 7 / 12) * 3600;
// 24h x 7 days x 4.345238 = 730.0 hours/month = 2,628,000 seconds (the old 24/7 assumption).
const ALWAYS_ON_CAPACITY = { ...DEFAULT_CAPACITY_PROFILE, activeHoursPerDay: 24, activeDaysPerWeek: 7 };

describe("getDocTokens", () => {
  it("converts a preset page count into tokens", () => {
    expect(getDocTokens(baseWorkload)).toBe(8 * TOKENS_PER_PAGE);
  });

  it("uses the custom page count when the custom preset is selected", () => {
    const workload = { ...baseWorkload, docSizePresetId: "custom", customPages: 15 };
    expect(getDocTokens(workload)).toBe(15 * TOKENS_PER_PAGE);
  });

  it("never returns zero, even for a tiny page count", () => {
    const workload = { ...baseWorkload, docSizePresetId: "custom", customPages: 0 };
    expect(getDocTokens(workload)).toBeGreaterThanOrEqual(1);
  });
});

describe("getMonthlyTokenVolume", () => {
  it("scales linearly with document volume", () => {
    const oneX = getMonthlyTokenVolume(baseWorkload);
    const twoX = getMonthlyTokenVolume({ ...baseWorkload, docsPerMonth: 2000 });
    expect(twoX.monthlyInputTokens).toBe(oneX.monthlyInputTokens * 2);
    expect(twoX.monthlyOutputTokens).toBe(oneX.monthlyOutputTokens * 2);
  });

  it("scales linearly with calls per document", () => {
    const oneCall = getMonthlyTokenVolume(baseWorkload);
    const threeCalls = getMonthlyTokenVolume({ ...baseWorkload, callsPerDoc: 3 });
    expect(threeCalls.monthlyInputTokens).toBe(oneCall.monthlyInputTokens * 3);
  });

  it("computes exact token counts for a known extraction workload", () => {
    // docTokens = 8 pages * 700 tokens/page = 5600
    // extraction: promptOverheadTokens=350, outputRatio=0.12, minOutputTokens=80
    const result = getMonthlyTokenVolume(baseWorkload);
    expect(result.inputTokensPerCall).toBe(5600 + 350);
    expect(result.outputTokensPerCall).toBe(Math.round(5600 * 0.12)); // 672, above the 80 floor
    expect(result.monthlyInputTokens).toBe(1000 * (5600 + 350));
    expect(result.monthlyOutputTokens).toBe(1000 * 672);
  });

  it("applies the output token floor for very short documents", () => {
    // classification has a small outputRatio (0.03) and a 40-token floor
    const workload: WorkloadInputs = {
      ...baseWorkload,
      taskType: "classification",
      docSizePresetId: "custom",
      customPages: 1, // 700 tokens -> 0.03 * 700 = 21, below the 40 floor
    };
    const result = getMonthlyTokenVolume(workload);
    expect(result.outputTokensPerCall).toBe(40);
  });
});

const syntheticCommercialModel: CommercialModel = {
  id: "test/model",
  name: "Test Model",
  provider: "Anthropic",
  inputPricePerM: 2,
  outputPricePerM: 10,
  cachedInputPricePerM: 0.2,
  contextWindow: 100_000,
  intelligenceScore: 60,
  speedTier: "medium",
  tier: "flagship",
  goodFor: ["extraction"],
  blurb: "test",
};

describe("calculateApiCost", () => {
  it("computes input + output cost with no caching", () => {
    const result = calculateApiCost(baseWorkload, syntheticCommercialModel);

    // monthlyInputTokens = 1000 * 5950 = 5,950,000 ; monthlyOutputTokens = 1000 * 672 = 672,000
    expect(result.monthlyInputTokens).toBe(5_950_000);
    expect(result.monthlyOutputTokens).toBe(672_000);
    expect(result.inputCost).toBeCloseTo(11.9, 5);
    expect(result.outputCost).toBeCloseTo(6.72, 5);
    expect(result.cachedInputCost).toBe(0);
    expect(result.totalMonthlyCost).toBeCloseTo(18.62, 5);
    expect(result.costPerDocument).toBeCloseTo(18.62 / 1000, 6);
    expect(result.annualCost).toBeCloseTo(18.62 * 12, 5);
  });

  it("shifts part of the input cost to the cached rate when caching is enabled", () => {
    const cachedWorkload = { ...baseWorkload, useCaching: true };
    const result = calculateApiCost(cachedWorkload, syntheticCommercialModel);

    // 30% of 5,950,000 input tokens are cached (per ASSUMED_CACHEABLE_INPUT_FRACTION)
    expect(result.cachedInputTokens).toBe(Math.round(5_950_000 * 0.3));
    expect(result.uncachedInputTokens).toBe(5_950_000 - result.cachedInputTokens);
    expect(result.cachedInputCost).toBeGreaterThan(0);
    // Caching should always reduce (or at worst match) total cost vs. no caching
    const uncached = calculateApiCost(baseWorkload, syntheticCommercialModel);
    expect(result.totalMonthlyCost).toBeLessThan(uncached.totalMonthlyCost);
  });

  it("ignores the caching flag when the model has no cached price", () => {
    const modelWithoutCaching = { ...syntheticCommercialModel, cachedInputPricePerM: undefined };
    const result = calculateApiCost({ ...baseWorkload, useCaching: true }, modelWithoutCaching);
    expect(result.cachedInputTokens).toBe(0);
    expect(result.cachedInputCost).toBe(0);
  });

  it("returns zero cost-per-document when there are no documents", () => {
    const result = calculateApiCost({ ...baseWorkload, docsPerMonth: 0 }, syntheticCommercialModel);
    expect(result.costPerDocument).toBe(0);
  });
});

const syntheticOpenSourceModel: OpenSourceModel = {
  id: "test/oss-model",
  name: "Test OSS Model",
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
  license: "test",
  goodFor: ["extraction"],
  blurb: "test",
};

const syntheticGpuInstance: GpuInstance = {
  id: "test-instance",
  cloud: "AWS",
  gpuType: "A100-80GB",
  gpuCountPerInstance: 1,
  instanceName: "test.instance",
  vcpu: 8,
  ramGB: 64,
  onDemandPerHour: 3,
  perGpuOnDemandPerHour: 3,
  reservedDiscountPct: 0.5,
};

const syntheticOwnedGpu: OwnedGpuSpec = {
  gpuType: "A100-80GB",
  approxUnitCostUsd: 10_000,
  tdpWatts: 300,
};

describe("calculateSelfHostCost - cloud rental", () => {
  const cloudParams: HostParams = {
    kind: "cloud",
    gpuInstance: syntheticGpuInstance,
    useReservedPricing: false,
    opsOverheadPct: 0.25,
  };

  it("sizes GPU count and utilization from required throughput", () => {
    const result = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, cloudParams);

    // output + weighted input = 672,000 + 5,950,000 * 0.45 = 672,000 + 2,677,500 = 3,349,500
    const effectiveMonthlyTokens = 672_000 + 5_950_000 * 0.45;
    expect(effectiveMonthlyTokens).toBe(3_349_500);
    expect(INPUT_TOKEN_COMPUTE_WEIGHT).toBe(0.45);
    // Processed within the 10h x 5d active window, not 24/7:
    // 3,349,500 / 782,142.86 s = 4.2825 tok/s
    const expectedThroughput = effectiveMonthlyTokens / DEFAULT_ACTIVE_SECONDS;
    expect(expectedThroughput).toBeCloseTo(4.2825, 4);

    expect(result.requiredThroughputTokPerSec).toBeCloseTo(expectedThroughput, 6);
    expect(result.gpuThroughputTokPerSec).toBe(1000); // A100-80GB multiplier is 1.0
    expect(result.replicas).toBe(1);
    expect(result.gpusNeeded).toBe(1);
    expect(result.limitingFactor).toBe("minimum-footprint");
    expect(result.activeHoursPerMonth).toBeCloseTo(217.2619, 4);
    // 4.2825 / (1 replica * 1000 tok/s) = 0.428%
    expect(result.utilizationPct).toBeCloseTo((expectedThroughput / 1000) * 100, 6);
  });

  it("computes on-demand compute + overhead cost with no electricity line item", () => {
    const result = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, cloudParams);

    // Scale-down is off by default, so GPUs are billed 24/7: 1 GPU * $3/hr * 730h = $2,190
    const expectedCompute = 1 * 3 * HOURS_PER_MONTH;
    expect(result.billedHoursPerMonth).toBe(HOURS_PER_MONTH);
    expect(result.computeCostMonthly).toBeCloseTo(expectedCompute, 5);
    expect(result.electricityCostMonthly).toBe(0);
    expect(result.overheadCostMonthly).toBeCloseTo(expectedCompute * 0.25, 5);
    expect(result.totalMonthlyCost).toBeCloseTo(expectedCompute * 1.25, 5);
  });

  it("applies the reserved discount when enabled", () => {
    const onDemand = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, cloudParams);
    const reserved = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, {
      ...cloudParams,
      useReservedPricing: true,
    });

    // reservedDiscountPct is 0.5 on the synthetic instance
    expect(reserved.computeCostMonthly).toBeCloseTo(onDemand.computeCostMonthly * 0.5, 5);
    expect(reserved.totalMonthlyCost).toBeLessThan(onDemand.totalMonthlyCost);
  });

  it("scales GPU throughput using the GPU type multiplier for a faster card", () => {
    const h100Params: HostParams = {
      ...cloudParams,
      gpuInstance: { ...syntheticGpuInstance, gpuType: "H100-80GB" },
    };
    const result = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, h100Params);
    // H100 multiplier (2.88) should raise throughput vs. A100 baseline (1.0)
    expect(result.gpuThroughputTokPerSec).toBeCloseTo(1000 * 2.88, 5);
  });
});

describe("calculateSelfHostCost - GPU throughput normalization (regression)", () => {
  // Regression test: throughputTokPerSecOnBaseline is measured on the
  // model's OWN recommended GPU (minGpuType), not always A100-80GB. A model
  // recommended on an L4 must show its full rated throughput when run on its
  // own recommended L4 - and scale relative to that L4 baseline, not get
  // treated as if it had been measured on an A100.
  const l4BaselineModel: OpenSourceModel = {
    ...syntheticOpenSourceModel,
    id: "test/l4-model",
    minGpuType: "L4",
    throughputTokPerSecOnBaseline: 1000,
  };

  it("applies no scaling when run on its own recommended GPU", () => {
    const params: HostParams = {
      kind: "cloud",
      gpuInstance: { ...syntheticGpuInstance, gpuType: "L4" },
      useReservedPricing: false,
      opsOverheadPct: 0.25,
    };
    const result = calculateSelfHostCost(baseWorkload, l4BaselineModel, params);
    expect(result.gpuThroughputTokPerSec).toBeCloseTo(1000, 5);
  });

  it("scales relative to the model's own baseline GPU, not A100-80GB", () => {
    const params: HostParams = {
      kind: "cloud",
      gpuInstance: { ...syntheticGpuInstance, gpuType: "A100-80GB" },
      useReservedPricing: false,
      opsOverheadPct: 0.25,
    };
    const result = calculateSelfHostCost(baseWorkload, l4BaselineModel, params);
    // A100 multiplier (1.0) / L4 multiplier (0.3) = 3.33x the L4-measured throughput
    expect(result.gpuThroughputTokPerSec).toBeCloseTo(1000 * (1.0 / 0.3), 2);
  });
});

describe("calculateSelfHostCost - owned hardware", () => {
  const ownedParams: HostParams = {
    kind: "owned",
    ownedGpu: syntheticOwnedGpu,
    opsOverheadPct: 0.3,
    depreciationYears: 2,
  };

  it("amortizes hardware cost and adds electricity + overhead", () => {
    const result = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, ownedParams);

    const hardwareTotal = 1 * 10_000 * OWN_SERVER_DEFAULTS.serverOverheadMultiplier;
    const expectedDepreciation = hardwareTotal / (2 * 12);
    const expectedKw = (1 * 300 * OWN_SERVER_DEFAULTS.pue) / 1000; // 0.42 kW
    // Owned hardware is powered for the usage pattern's active hours:
    // 0.42 kW * 217.2619 h * $0.14/kWh = $12.775
    const expectedElectricity =
      expectedKw * (10 * 5 * WEEKS_PER_MONTH) * OWN_SERVER_DEFAULTS.electricityPricePerKwh;
    expect(expectedElectricity).toBeCloseTo(12.775, 3);
    const expectedOverhead = (expectedDepreciation + expectedElectricity) * 0.3;

    expect(result.computeCostMonthly).toBeCloseTo(expectedDepreciation, 5);
    expect(result.electricityCostMonthly).toBeCloseTo(expectedElectricity, 5);
    expect(result.overheadCostMonthly).toBeCloseTo(expectedOverhead, 5);
    expect(result.totalMonthlyCost).toBeCloseTo(
      expectedDepreciation + expectedElectricity + expectedOverhead,
      5,
    );
  });

  it("lowers amortized cost when the depreciation period is longer", () => {
    const shortDepreciation = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, ownedParams);
    const longDepreciation = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, {
      ...ownedParams,
      depreciationYears: 5,
    });
    expect(longDepreciation.computeCostMonthly).toBeLessThan(shortDepreciation.computeCostMonthly);
  });

  it("reports the one-time hardware purchase separately from the recurring monthly cost", () => {
    const result = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, ownedParams);

    // 1 GPU * $10,000 * 1.4 server overhead = $14,000 one-time; / 24 months = $583.33/mo amortized
    expect(result.hardwareCostOneTimeUsd).toBeCloseTo(14_000, 6);
    expect(result.computeCostMonthly).toBeCloseTo(14_000 / 24, 6);
    // electricity $12.775 + ops ($583.33 + $12.775) * 0.3 = $178.83 -> recurring $191.61/mo
    expect(result.recurringMonthlyCostExclHardware).toBeCloseTo(
      result.electricityCostMonthly + result.overheadCostMonthly,
      6,
    );
    expect(result.recurringMonthlyCostExclHardware).toBeCloseTo(191.6075, 3);
    // Recurring excludes exactly the amortized hardware slice; the total
    // comparison figure is unchanged: $191.61 + $583.33 = $774.94/mo.
    expect(result.recurringMonthlyCostExclHardware).toBeCloseTo(
      result.totalMonthlyCost - result.computeCostMonthly,
      6,
    );
    expect(result.totalMonthlyCost).toBeCloseTo(774.9408, 3);
  });

  it("matches a hand-computed capex/opex split for a real 2x H100 model (Nemotron 3 Super)", () => {
    const nemotronSuper = OPEN_SOURCE_MODELS.find((m) => m.id === "nemotron-3-super")!;
    const h100 = OWNED_GPU_SPECS.find((s) => s.gpuType === "H100-80GB")!;
    const result = calculateSelfHostCost(baseWorkload, nemotronSuper, {
      kind: "owned",
      ownedGpu: h100,
      opsOverheadPct: 0.3,
      depreciationYears: 3,
    });

    // Batch volume (4.28 tok/s) fits one replica = 2 GPUs.
    expect(result.gpusNeeded).toBe(2);
    // 2 GPUs * $28,000 * 1.4 overhead = $78,400 one-time; / 36 months = $2,177.78/mo amortized
    expect(result.hardwareCostOneTimeUsd).toBeCloseTo(78_400, 6);
    expect(result.computeCostMonthly).toBeCloseTo(2177.7778, 3);
    // 2 * 700W * 1.4 PUE = 1.96 kW * 217.2619 h * $0.14 = $59.62 electricity
    expect(result.electricityCostMonthly).toBeCloseTo(59.6167, 3);
    // ops: ($2,177.78 + $59.62) * 0.3 = $671.22 -> recurring $59.62 + $671.22 = $730.84/mo
    expect(result.recurringMonthlyCostExclHardware).toBeCloseTo(730.835, 2);
    // comparison total: $730.84 + $2,177.78 = $2,908.61/mo
    expect(result.totalMonthlyCost).toBeCloseTo(2908.6128, 3);
  });
});

describe("calculateSelfHostCost - cloud rental has no one-time hardware cost", () => {
  it("reports zero capex and a recurring cost equal to the full monthly total", () => {
    const result = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, {
      kind: "cloud",
      gpuInstance: syntheticGpuInstance,
      useReservedPricing: false,
      opsOverheadPct: 0.25,
    });
    // 1 GPU * $3/hr * 730h = $2,190 rental; * 1.25 ops = $2,737.50, all of it recurring
    expect(result.hardwareCostOneTimeUsd).toBe(0);
    expect(result.recurringMonthlyCostExclHardware).toBeCloseTo(2737.5, 6);
    expect(result.recurringMonthlyCostExclHardware).toBe(result.totalMonthlyCost);
  });

  it("keeps owned capex/recurring fields out of regional rental scaling, and aggregates them", () => {
    const owned: HostParams = {
      kind: "owned",
      ownedGpu: syntheticOwnedGpu,
      opsOverheadPct: 0.3,
      depreciationYears: 2,
    };
    const regionA = calculateSelfHostCost({ ...baseWorkload, docsPerMonth: 400 }, syntheticOpenSourceModel, owned);
    const regionB = calculateSelfHostCost({ ...baseWorkload, docsPerMonth: 600 }, syntheticOpenSourceModel, owned);

    // A 1.3x GPU-RENTAL multiplier doesn't apply to a hardware purchase:
    // $14,000 one-time stays $14,000 (previously wrongly inflated to $18,200).
    const scaled = scaleSelfHostBreakdown(regionA, 1.3, 400);
    expect(scaled.hardwareCostOneTimeUsd).toBeCloseTo(14_000, 6);
    expect(scaled.recurringMonthlyCostExclHardware).toBeCloseTo(regionA.recurringMonthlyCostExclHardware, 6);
    expect(scaled.recurringMonthlyCostExclHardware).toBeCloseTo(
      scaled.totalMonthlyCost - scaled.computeCostMonthly,
      6,
    );

    // Two independent regions each buy their own server: $14,000 + $14,000 = $28,000
    const combined = aggregateSelfHostBreakdowns([
      { regionId: "us", docsPerMonth: 400, breakdown: regionA },
      { regionId: "eu", docsPerMonth: 600, breakdown: regionB },
    ]);
    expect(combined.hardwareCostOneTimeUsd).toBeCloseTo(28_000, 6);
    expect(combined.recurringMonthlyCostExclHardware).toBeCloseTo(
      regionA.recurringMonthlyCostExclHardware + regionB.recurringMonthlyCostExclHardware,
      6,
    );
  });
});

const bigModel: CommercialModel = { ...syntheticCommercialModel, inputPricePerM: 2, outputPricePerM: 10 };
const smallModel: CommercialModel = {
  ...syntheticCommercialModel,
  id: "test/small-model",
  inputPricePerM: 0.1,
  outputPricePerM: 0.4,
  cachedInputPricePerM: 0.01,
  tier: "budget",
};

const jevRouter: RouterOption = {
  id: "jev",
  name: "Jev Router",
  vendor: "TypeSafe",
  isSelfHosted: false,
  costPerMInputTokens: 0.042,
  blurb: "test",
};

const layaRouter: RouterOption = {
  id: "laya",
  name: "Laya",
  vendor: "Open source",
  isSelfHosted: true,
  costPerMInputTokens: 0,
  selfHostMonthlyCost: 25,
  blurb: "test",
};

const noRouter: RouterOption = {
  id: "none",
  name: "No routing",
  vendor: "-",
  isSelfHosted: false,
  costPerMInputTokens: 0,
  blurb: "test",
};

describe("calculateRoutedApiCost", () => {
  it("splits calls between the big and small model according to the escalation rate", () => {
    const result = calculateRoutedApiCost(baseWorkload, bigModel, smallModel, jevRouter, 0.25);

    expect(result.totalCalls).toBe(1000);
    expect(result.escalatedCalls).toBe(250);
    expect(result.routedCalls).toBe(750);

    // bigModelCost: 250 calls * (5950 input + 672 output tokens/call) priced at $2 / $10 per M
    expect(result.bigModelCost).toBeCloseTo(4.655, 5);
    // smallModelCost: 750 calls at $0.1 / $0.4 per M
    expect(result.smallModelCost).toBeCloseTo(0.64785, 5);
  });

  it("prices the router decisions using the router's per-token rate", () => {
    const withJev = calculateRoutedApiCost(baseWorkload, bigModel, smallModel, jevRouter, 0.25);
    // 1000 calls * ROUTER_TOKENS_PER_DECISION tokens/decision, priced at $0.042/M
    const expectedRouterCost = ((1000 * ROUTER_TOKENS_PER_DECISION) / 1_000_000) * 0.042;
    expect(withJev.routerCost).toBeCloseTo(expectedRouterCost, 6);

    const withNoRouting = calculateRoutedApiCost(baseWorkload, bigModel, smallModel, noRouter, 0.25);
    expect(withNoRouting.routerCost).toBe(0);
  });

  it("adds a flat self-host cost for a self-hosted router", () => {
    const withLaya = calculateRoutedApiCost(baseWorkload, bigModel, smallModel, layaRouter, 0.25);
    expect(withLaya.routerCost).toBe(25);
  });

  it("computes savings relative to always using the big model", () => {
    const result = calculateRoutedApiCost(baseWorkload, bigModel, smallModel, jevRouter, 0.25);
    const baseline = calculateApiCost(baseWorkload, bigModel);

    expect(result.baselineCost).toBeCloseTo(baseline.totalMonthlyCost, 6);
    expect(result.savingsAmount).toBeCloseTo(baseline.totalMonthlyCost - result.totalMonthlyCost, 6);
    expect(result.savingsPct).toBeGreaterThan(0);
    expect(result.totalMonthlyCost).toBeLessThan(baseline.totalMonthlyCost);
  });

  it("costs strictly more as the escalation rate increases, all else equal", () => {
    const low = calculateRoutedApiCost(baseWorkload, bigModel, smallModel, jevRouter, 0.1);
    const high = calculateRoutedApiCost(baseWorkload, bigModel, smallModel, jevRouter, 0.5);
    expect(high.totalMonthlyCost).toBeGreaterThan(low.totalMonthlyCost);
  });

  it("regression: applies prompt caching to both models when workload.useCaching is on", () => {
    const cachedWorkload = { ...baseWorkload, useCaching: true };
    const withCaching = calculateRoutedApiCost(cachedWorkload, bigModel, smallModel, jevRouter, 0.25);
    const withoutCaching = calculateRoutedApiCost(baseWorkload, bigModel, smallModel, jevRouter, 0.25);

    // Toggling caching must actually change the routed total, matching the
    // non-routed calculateApiCost behavior (previously caching only worked
    // when routing was off).
    expect(withCaching.bigModelCost).toBeLessThan(withoutCaching.bigModelCost);
    expect(withCaching.smallModelCost).toBeLessThan(withoutCaching.smallModelCost);
    expect(withCaching.totalMonthlyCost).toBeLessThan(withoutCaching.totalMonthlyCost);
  });

  it("regression: reports negative savings (routing costs more) when the small model isn't actually cheaper", () => {
    // A "small" model priced ABOVE the big model per token - a realistic
    // misconfiguration the UI must be able to warn about rather than hide.
    const expensiveSmallModel: CommercialModel = {
      ...smallModel,
      inputPricePerM: bigModel.inputPricePerM * 5,
      outputPricePerM: bigModel.outputPricePerM * 5,
    };
    const result = calculateRoutedApiCost(baseWorkload, bigModel, expensiveSmallModel, jevRouter, 0.75);
    expect(result.savingsAmount).toBeLessThan(0);
    expect(result.totalMonthlyCost).toBeGreaterThan(result.baselineCost);
  });
});

const mediumModel: CommercialModel = {
  ...syntheticCommercialModel,
  id: "test/medium-model",
  inputPricePerM: 0.5,
  outputPricePerM: 2,
  tier: "balanced",
};

describe("calculateRoutedApiCost - three-tier (Low/Medium/High)", () => {
  it("collapses cleanly to 2-tier behavior when no medium model is given", () => {
    const withoutMedium = calculateRoutedApiCost(baseWorkload, bigModel, smallModel, jevRouter, 0.25);
    const withNullMedium = calculateRoutedApiCost(baseWorkload, bigModel, smallModel, jevRouter, 0.25, null, 0.2);
    expect(withNullMedium.mediumCalls).toBe(0);
    expect(withNullMedium.mediumModelCost).toBe(0);
    expect(withNullMedium.totalMonthlyCost).toBeCloseTo(withoutMedium.totalMonthlyCost, 6);
  });

  it("splits calls across all three tiers according to their rates", () => {
    const result = calculateRoutedApiCost(baseWorkload, bigModel, smallModel, jevRouter, 0.25, mediumModel, 0.2);
    expect(result.escalatedCalls).toBe(250); // 25% High
    expect(result.mediumCalls).toBe(200); // 20% Medium
    expect(result.routedCalls).toBe(550); // remainder Low
    expect(result.escalatedCalls + result.mediumCalls + result.routedCalls).toBe(result.totalCalls);
    expect(result.mediumModelCost).toBeGreaterThan(0);
  });

  it("clamps the medium rate so Low never goes negative when High + Medium would exceed 100%", () => {
    const result = calculateRoutedApiCost(baseWorkload, bigModel, smallModel, jevRouter, 0.75, mediumModel, 0.5);
    expect(result.escalatedCalls + result.mediumCalls).toBeLessThanOrEqual(result.totalCalls);
    expect(result.routedCalls).toBeGreaterThanOrEqual(0);
  });

  it("regression: tiers sum to exactly totalCalls even when both roundings hit a .5 boundary", () => {
    // 999 calls, High 50%, Medium 50% (already at the 1 - 0.5 clamp):
    // round(499.5) = 500 High, and independently round(499.5) = 500 Medium would be
    // 1,000 > 999 - a phantom call. Medium is now capped at 999 - 500 = 499, Low = 0.
    const result = calculateRoutedApiCost(
      { ...baseWorkload, docsPerMonth: 999 },
      bigModel,
      smallModel,
      jevRouter,
      0.5,
      mediumModel,
      0.5,
    );
    expect(result.totalCalls).toBe(999);
    expect(result.escalatedCalls).toBe(500);
    expect(result.mediumCalls).toBe(499);
    expect(result.routedCalls).toBe(0);
    expect(result.escalatedCalls + result.mediumCalls + result.routedCalls).toBe(999);
    expect(result.smallModelCost).toBe(0);
  });

  it("aggregates the medium tier correctly across regions", () => {
    const regionA = calculateRoutedApiCost({ ...baseWorkload, docsPerMonth: 400 }, bigModel, smallModel, jevRouter, 0.25, mediumModel, 0.2);
    const regionB = calculateRoutedApiCost({ ...baseWorkload, docsPerMonth: 600 }, bigModel, smallModel, jevRouter, 0.25, mediumModel, 0.2);
    const combined = aggregateRoutedApiBreakdowns([
      { regionId: "us", docsPerMonth: 400, breakdown: regionA },
      { regionId: "eu", docsPerMonth: 600, breakdown: regionB },
    ]);
    expect(combined.mediumModelCost).toBeCloseTo(regionA.mediumModelCost + regionB.mediumModelCost, 6);
    expect(combined.mediumCalls).toBe(regionA.mediumCalls + regionB.mediumCalls);
  });
});

describe("getModelsCheaperThan", () => {
  it("returns only models strictly cheaper than the reference model for this workload", () => {
    const pricier: CommercialModel = { ...syntheticCommercialModel, id: "test/pricier", inputPricePerM: 10, outputPricePerM: 50 };
    const result = getModelsCheaperThan(baseWorkload, [bigModel, smallModel, mediumModel, pricier], bigModel);
    const ids = result.map((m) => m.id);
    expect(ids).toContain(smallModel.id);
    expect(ids).toContain(mediumModel.id);
    expect(ids).not.toContain(pricier.id);
    expect(ids).not.toContain(bigModel.id);
  });

  it("returns an empty list when the reference model is already the cheapest", () => {
    const result = getModelsCheaperThan(baseWorkload, [bigModel, smallModel, mediumModel], smallModel);
    expect(result).toHaveLength(0);
  });
});

describe("splitTierCounts", () => {
  it("always sums to exactly the total, including at .5 rounding boundaries", () => {
    expect(splitTierCounts(999, 0.5, 0.5)).toEqual({ high: 500, medium: 499, low: 0 });
    expect(splitTierCounts(1000, 0.25, 0.2)).toEqual({ high: 250, medium: 200, low: 550 });
    // 3 * 0.5 = 1.5 -> 2 High; Medium round(1.5) = 2 capped to 1; Low 0
    expect(splitTierCounts(3, 0.5, 0.5)).toEqual({ high: 2, medium: 1, low: 0 });
    for (const total of [0, 1, 3, 7, 99, 999, 1001]) {
      for (const high of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
        const { high: h, medium: m, low: l } = splitTierCounts(total, high, 1 - high);
        expect(h + m + l).toBe(total);
        expect(Math.min(h, m, l)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("splitDocsAcrossRegions", () => {
  it("splits evenly when volume divides cleanly", () => {
    expect(splitDocsAcrossRegions(1000, 4)).toEqual([250, 250, 250, 250]);
  });

  it("distributes the remainder to the first regions", () => {
    expect(splitDocsAcrossRegions(1001, 4)).toEqual([251, 250, 250, 250]);
  });

  it("always sums back to the original total", () => {
    const split = splitDocsAcrossRegions(1000, 3);
    expect(split.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("returns a single-element array for one region", () => {
    expect(splitDocsAcrossRegions(1000, 1)).toEqual([1000]);
  });
});

describe("withDataResidencyPremium", () => {
  it("scales all price fields by the premium", () => {
    const result = withDataResidencyPremium(syntheticCommercialModel, 0.1);
    expect(result.inputPricePerM).toBeCloseTo(2 * 1.1, 6);
    expect(result.outputPricePerM).toBeCloseTo(10 * 1.1, 6);
    expect(result.cachedInputPricePerM).toBeCloseTo(0.2 * 1.1, 6);
  });

  it("returns the same object when the premium is zero", () => {
    expect(withDataResidencyPremium(syntheticCommercialModel, 0)).toBe(syntheticCommercialModel);
  });

  it("leaves an undefined cached price as undefined", () => {
    const noCaching = { ...syntheticCommercialModel, cachedInputPricePerM: undefined };
    expect(withDataResidencyPremium(noCaching, 0.1).cachedInputPricePerM).toBeUndefined();
  });
});

describe("scaleSelfHostBreakdown", () => {
  const base = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, {
    kind: "cloud",
    gpuInstance: syntheticGpuInstance,
    useReservedPricing: false,
    opsOverheadPct: 0.25,
  });

  it("scales compute, electricity and overhead by the multiplier", () => {
    const scaled = scaleSelfHostBreakdown(base, 1.3, baseWorkload.docsPerMonth);
    expect(scaled.computeCostMonthly).toBeCloseTo(base.computeCostMonthly * 1.3, 6);
    expect(scaled.overheadCostMonthly).toBeCloseTo(base.overheadCostMonthly * 1.3, 6);
    expect(scaled.totalMonthlyCost).toBeCloseTo(base.totalMonthlyCost * 1.3, 6);
  });

  it("leaves the breakdown unchanged at a 1.0 multiplier", () => {
    const scaled = scaleSelfHostBreakdown(base, 1.0, baseWorkload.docsPerMonth);
    expect(scaled.totalMonthlyCost).toBeCloseTo(base.totalMonthlyCost, 6);
  });

  it("regression: applies the GPU-rental multiplier to cloud rental only, never to owned hardware", () => {
    const owned = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, {
      kind: "owned",
      ownedGpu: syntheticOwnedGpu,
      opsOverheadPct: 0.3,
      depreciationYears: 2,
    });
    const eu = REGIONS.find((r) => r.id === "eu")!; // 1.19x
    const australia = REGIONS.find((r) => r.id === "australia")!; // 1.33x
    expect(eu.gpuPriceMultiplier).not.toBe(australia.gpuPriceMultiplier);

    const ownedEu = scaleSelfHostBreakdown(owned, eu.gpuPriceMultiplier, 1000);
    const ownedAu = scaleSelfHostBreakdown(owned, australia.gpuPriceMultiplier, 1000);
    // Owned: 1 GPU * $10,000 * 1.4 = $14,000 one-time in BOTH regions
    // (previously EU $16,660 / Australia $18,620).
    expect(ownedEu.hardwareCostOneTimeUsd).toBeCloseTo(14_000, 6);
    expect(ownedAu.hardwareCostOneTimeUsd).toBe(ownedEu.hardwareCostOneTimeUsd);
    // 0.42 kW * 217.2619 h * $0.14 = $12.775 power in BOTH regions
    expect(ownedEu.electricityCostMonthly).toBeCloseTo(12.775, 3);
    expect(ownedAu.electricityCostMonthly).toBe(ownedEu.electricityCostMonthly);
    // Amortized $583.33 + $12.775 power + ops ($596.11 * 0.3 = $178.83) = $774.94/mo, both regions
    expect(ownedEu.computeCostMonthly).toBeCloseTo(14_000 / 24, 6);
    expect(ownedEu.totalMonthlyCost).toBeCloseTo(774.9408, 3);
    expect(ownedAu.totalMonthlyCost).toBe(ownedEu.totalMonthlyCost);
    // Capex/opex invariant still holds after scaling
    expect(ownedAu.recurringMonthlyCostExclHardware).toBeCloseTo(
      ownedAu.totalMonthlyCost - ownedAu.computeCostMonthly,
      6,
    );

    // Cloud rental still scales: $2,190 rental * 1.33 = $2,912.70; ops 25% -> $3,640.875
    const cloudAu = scaleSelfHostBreakdown(base, australia.gpuPriceMultiplier, 1000);
    expect(cloudAu.computeCostMonthly).toBeCloseTo(2190 * 1.33, 6);
    expect(cloudAu.overheadCostMonthly).toBeCloseTo(2190 * 1.33 * 0.25, 6);
    expect(cloudAu.totalMonthlyCost).toBeCloseTo(3640.875, 6);
    expect(cloudAu.electricityCostMonthly).toBe(0);
    expect(cloudAu.hardwareCostOneTimeUsd).toBe(0);
    expect(cloudAu.recurringMonthlyCostExclHardware).toBe(cloudAu.totalMonthlyCost);
  });
});

// Resolves each model to a first-listed cloud instance of its own recommended
// GPU type, on-demand and always-on - a stand-in for page.tsx's
// hostParamsForModel with default settings.
const resolveOnDemandHostParams = (model: OpenSourceModel): HostParams => ({
  kind: "cloud",
  gpuInstance: GPU_INSTANCES.find((i) => i.gpuType === model.minGpuType)!,
  useReservedPricing: false,
  opsOverheadPct: 0.25,
});

describe("getOpenSourceModelsCheaperThan", () => {
  it("returns only open-source models genuinely cheaper to self-host than the reference model", () => {
    const cheapModel: OpenSourceModel = { ...syntheticOpenSourceModel, id: "test/oss-cheap", minGpuType: "L4" };
    const pricierModel: OpenSourceModel = {
      ...syntheticOpenSourceModel,
      id: "test/oss-pricier",
      minGpuType: "H100-80GB",
      minGpuCount: 4,
    };
    // reference: 1x A100-80GB (Azure $3.673/hr) * 730h * 1.25 ops = $3,351.61/mo
    // cheap:     1x L4 (AWS $0.8048/hr)        = $734.38/mo
    // pricier:   4x H100 (AWS $6.88/hr)        = $25,112/mo
    const result = getOpenSourceModelsCheaperThan(
      baseWorkload,
      [syntheticOpenSourceModel, cheapModel, pricierModel],
      syntheticOpenSourceModel,
      resolveOnDemandHostParams,
    );
    const ids = result.map((m) => m.id);
    expect(ids).toContain(cheapModel.id);
    expect(ids).not.toContain(pricierModel.id);
    expect(ids).not.toContain(syntheticOpenSourceModel.id);
  });
});

const highOssModel: OpenSourceModel = { ...syntheticOpenSourceModel, id: "test/oss-high" };
// An 8B-class model sized for a 24GB L4 (6GB 4-bit weights), like the
// catalog's efficient tier - a 70B/40GB model can't physically load on an L4.
const lowOssModel: OpenSourceModel = {
  ...syntheticOpenSourceModel,
  id: "test/oss-low",
  paramsB: 8,
  vramFp16GB: 16,
  vramInt4GB: 6,
  minGpuType: "L4",
  throughputTokPerSecOnBaseline: 1800,
};
const mediumOssModel: OpenSourceModel = {
  ...syntheticOpenSourceModel,
  id: "test/oss-medium",
  minGpuType: "A100-40GB",
  throughputTokPerSecOnBaseline: 1400,
};

const highHostParams: HostParams = {
  kind: "cloud",
  gpuInstance: syntheticGpuInstance, // A100-80GB, $3/hr
  useReservedPricing: false,
  opsOverheadPct: 0.25,
};
const lowHostParams: HostParams = {
  kind: "cloud",
  gpuInstance: { ...syntheticGpuInstance, id: "test-l4", gpuType: "L4", perGpuOnDemandPerHour: 0.8 },
  useReservedPricing: false,
  opsOverheadPct: 0.25,
};
const mediumHostParams: HostParams = {
  kind: "cloud",
  gpuInstance: { ...syntheticGpuInstance, id: "test-a100-40", gpuType: "A100-40GB", perGpuOnDemandPerHour: 2 },
  useReservedPricing: false,
  opsOverheadPct: 0.25,
};

const laya: RouterOption = {
  id: "laya",
  name: "Laya",
  vendor: "Open source",
  isSelfHosted: true,
  costPerMInputTokens: 0,
  selfHostMonthlyCost: 60,
  blurb: "test",
};
const noRouterOption: RouterOption = {
  id: "none",
  name: "No routing",
  vendor: "-",
  isSelfHosted: false,
  costPerMInputTokens: 0,
  blurb: "test",
};

describe("calculateRoutedSelfHostCost", () => {
  const highTier: SelfHostRoutingTier = { model: highOssModel, hostParams: highHostParams };
  const lowTier: SelfHostRoutingTier = { model: lowOssModel, hostParams: lowHostParams };
  const mediumTier: SelfHostRoutingTier = { model: mediumOssModel, hostParams: mediumHostParams };

  it("splits document volume across tiers according to their rates", () => {
    const result = calculateRoutedSelfHostCost(baseWorkload, highTier, lowTier, laya, 0.25);
    expect(result.tiers).toHaveLength(2); // high + low, no medium
    const high = result.tiers.find((t) => t.tier === "high")!;
    const low = result.tiers.find((t) => t.tier === "low")!;
    expect(high.docsPerMonth).toBe(250);
    expect(low.docsPerMonth).toBe(750);
  });

  it("adds a three-way split when a medium tier is provided", () => {
    const result = calculateRoutedSelfHostCost(baseWorkload, highTier, lowTier, laya, 0.25, mediumTier, 0.2);
    expect(result.tiers).toHaveLength(3);
    const high = result.tiers.find((t) => t.tier === "high")!;
    const medium = result.tiers.find((t) => t.tier === "medium")!;
    const low = result.tiers.find((t) => t.tier === "low")!;
    expect(high.docsPerMonth).toBe(250);
    expect(medium.docsPerMonth).toBe(200);
    expect(low.docsPerMonth).toBe(550);
    expect(high.docsPerMonth + medium.docsPerMonth + low.docsPerMonth).toBe(1000);
  });

  it("includes the router's flat self-host cost", () => {
    const result = calculateRoutedSelfHostCost(baseWorkload, highTier, lowTier, laya, 0.25);
    expect(result.routerCost).toBe(60);
    expect(result.baselineCost).toBeGreaterThan(0);
  });

  it("reduces total cost vs. baseline once volume is high enough that the baseline would need multiple high-tier GPUs", () => {
    // At high volume, always using the High-tier model/GPU needs 2 GPUs; routing
    // most traffic to a single cheap Low-tier GPU and reserving just 1 High-tier
    // GPU for the escalated share costs less than 2 High-tier GPUs.
    const highVolumeWorkload = { ...baseWorkload, docsPerMonth: 3_000_000 };
    const result = calculateRoutedSelfHostCost(highVolumeWorkload, highTier, lowTier, laya, 0.25);
    const baseline = calculateSelfHostCost(highVolumeWorkload, highOssModel, highHostParams);

    expect(baseline.gpusNeeded).toBeGreaterThan(1);
    expect(result.totalMonthlyCost).toBeLessThan(result.baselineCost);
    expect(result.savingsAmount).toBeGreaterThan(0);
  });

  it("regression: at low volume, splitting into separate tiers can cost MORE than a single deployment, because each tier pays its own minimum-1-GPU floor", () => {
    // This is a real, expected characteristic of self-hosted routing (unlike
    // API routing): a single low-volume deployment may already be far under
    // one GPU's capacity, so splitting it into two separately-hosted tiers
    // means paying for two GPU floors instead of one.
    const result = calculateRoutedSelfHostCost(baseWorkload, highTier, lowTier, laya, 0.25);
    const baseline = calculateSelfHostCost(baseWorkload, highOssModel, highHostParams);

    expect(baseline.gpusNeeded).toBe(1);
    expect(result.tiers.every((t) => t.breakdown.gpusNeeded === 1)).toBe(true);
    expect(result.totalMonthlyCost).toBeGreaterThan(result.baselineCost);
    expect(result.savingsAmount).toBeLessThan(0);
  });

  it("charges no router cost when routing is off", () => {
    const result = calculateRoutedSelfHostCost(baseWorkload, highTier, lowTier, noRouterOption, 0.25);
    expect(result.routerCost).toBe(0);
  });

  it("clamps the medium rate so the low tier never goes negative", () => {
    const result = calculateRoutedSelfHostCost(baseWorkload, highTier, lowTier, laya, 0.75, mediumTier, 0.5);
    const low = result.tiers.find((t) => t.tier === "low")!;
    expect(low.docsPerMonth).toBeGreaterThanOrEqual(0);
  });

  it("regression: tier documents sum to exactly totalDocs even when both roundings hit a .5 boundary", () => {
    // 999 docs, High 50%, Medium 50%: round(499.5) = 500 High; Medium capped at 499
    // (was 500, giving 1,000 docs priced for a 999-doc workload); Low = 0.
    const result = calculateRoutedSelfHostCost(
      { ...baseWorkload, docsPerMonth: 999 },
      highTier,
      lowTier,
      laya,
      0.5,
      mediumTier,
      0.5,
    );
    const high = result.tiers.find((t) => t.tier === "high")!;
    const medium = result.tiers.find((t) => t.tier === "medium")!;
    const low = result.tiers.find((t) => t.tier === "low")!;
    expect(high.docsPerMonth).toBe(500);
    expect(medium.docsPerMonth).toBe(499);
    expect(low.docsPerMonth).toBe(0);
    expect(high.docsPerMonth + medium.docsPerMonth + low.docsPerMonth).toBe(999);
  });

  it("sums GPUs needed across all active tiers", () => {
    const result = calculateRoutedSelfHostCost(baseWorkload, highTier, lowTier, laya, 0.25);
    const high = result.tiers.find((t) => t.tier === "high")!;
    const low = result.tiers.find((t) => t.tier === "low")!;
    expect(result.totalGpusNeeded).toBe(high.breakdown.gpusNeeded + low.breakdown.gpusNeeded);
  });
});

describe("scaleRoutedSelfHostBreakdown and aggregateRoutedSelfHostBreakdowns", () => {
  const highTier: SelfHostRoutingTier = { model: highOssModel, hostParams: highHostParams };
  const lowTier: SelfHostRoutingTier = { model: lowOssModel, hostParams: lowHostParams };

  it("scales tier costs and baseline by the region multiplier, but not the router fee", () => {
    const base = calculateRoutedSelfHostCost(baseWorkload, highTier, lowTier, laya, 0.25);
    const scaled = scaleRoutedSelfHostBreakdown(base, 1.3, baseWorkload.docsPerMonth);

    const baseTiersCost = base.tiers.reduce((s, t) => s + t.breakdown.totalMonthlyCost, 0);
    const scaledTiersCost = scaled.tiers.reduce((s, t) => s + t.breakdown.totalMonthlyCost, 0);
    expect(scaledTiersCost).toBeCloseTo(baseTiersCost * 1.3, 5);
    expect(scaled.routerCost).toBe(base.routerCost);
    expect(scaled.totalMonthlyCost).toBeCloseTo(scaledTiersCost + base.routerCost, 5);
    expect(scaled.baselineCost).toBeCloseTo(base.baselineCost * 1.3, 5);
  });

  it("regression: does not scale owned-hardware tiers or the owned baseline by the rental multiplier", () => {
    const ownedParams: HostParams = {
      kind: "owned",
      ownedGpu: syntheticOwnedGpu,
      opsOverheadPct: 0.3,
      depreciationYears: 2,
    };
    const base = calculateRoutedSelfHostCost(
      baseWorkload,
      { model: highOssModel, hostParams: ownedParams },
      { model: lowOssModel, hostParams: ownedParams },
      laya,
      0.25,
    );
    const scaled = scaleRoutedSelfHostBreakdown(base, 1.33, baseWorkload.docsPerMonth);
    expect(scaled.totalMonthlyCost).toBeCloseTo(base.totalMonthlyCost, 6);
    expect(scaled.baselineCost).toBe(base.baselineCost);
    scaled.tiers.forEach((t, i) => {
      expect(t.breakdown.hardwareCostOneTimeUsd).toBe(base.tiers[i].breakdown.hardwareCostOneTimeUsd);
      expect(t.breakdown.electricityCostMonthly).toBe(base.tiers[i].breakdown.electricityCostMonthly);
    });
  });

  it("aggregates multiple regions into one internally-consistent total", () => {
    const regionA = calculateRoutedSelfHostCost({ ...baseWorkload, docsPerMonth: 400 }, highTier, lowTier, laya, 0.25);
    const regionB = calculateRoutedSelfHostCost({ ...baseWorkload, docsPerMonth: 600 }, highTier, lowTier, laya, 0.25);
    const combined = aggregateRoutedSelfHostBreakdowns([
      { regionId: "us", docsPerMonth: 400, breakdown: regionA },
      { regionId: "eu", docsPerMonth: 600, breakdown: regionB },
    ]);

    expect(combined.totalMonthlyCost).toBeCloseTo(regionA.totalMonthlyCost + regionB.totalMonthlyCost, 6);
    expect(combined.routerCost).toBeCloseTo(regionA.routerCost + regionB.routerCost, 6);
    // Each region provisions its own router - two regions means two Laya fees, not one shared fee.
    expect(combined.routerCost).toBeCloseTo(120, 6);
    expect(combined.tiers).toHaveLength(regionA.tiers.length + regionB.tiers.length);
  });
});

describe("region aggregation", () => {
  it("aggregateApiBreakdowns sums cost fields and recomputes cost-per-document", () => {
    const regionA = calculateApiCost({ ...baseWorkload, docsPerMonth: 400 }, bigModel);
    const regionB = calculateApiCost({ ...baseWorkload, docsPerMonth: 600 }, bigModel);
    const allocations: RegionAllocation<typeof regionA>[] = [
      { regionId: "us", docsPerMonth: 400, breakdown: regionA },
      { regionId: "eu", docsPerMonth: 600, breakdown: regionB },
    ];

    const combined = aggregateApiBreakdowns(allocations);
    expect(combined.totalMonthlyCost).toBeCloseTo(regionA.totalMonthlyCost + regionB.totalMonthlyCost, 6);
    expect(combined.costPerDocument).toBeCloseTo(combined.totalMonthlyCost / 1000, 6);

    // A single-region "aggregate" should exactly match the un-aggregated breakdown
    const single = aggregateApiBreakdowns([{ regionId: "us", docsPerMonth: 1000, breakdown: calculateApiCost(baseWorkload, bigModel) }]);
    const direct = calculateApiCost(baseWorkload, bigModel);
    expect(single.totalMonthlyCost).toBeCloseTo(direct.totalMonthlyCost, 6);
    expect(single.costPerDocument).toBeCloseTo(direct.costPerDocument, 6);
  });

  it("aggregateRoutedApiBreakdowns recomputes savings from the combined totals", () => {
    const regionA = calculateRoutedApiCost({ ...baseWorkload, docsPerMonth: 400 }, bigModel, smallModel, jevRouter, 0.25);
    const regionB = calculateRoutedApiCost({ ...baseWorkload, docsPerMonth: 600 }, bigModel, smallModel, jevRouter, 0.25);
    const combined = aggregateRoutedApiBreakdowns([
      { regionId: "us", docsPerMonth: 400, breakdown: regionA },
      { regionId: "eu", docsPerMonth: 600, breakdown: regionB },
    ]);

    expect(combined.totalMonthlyCost).toBeCloseTo(regionA.totalMonthlyCost + regionB.totalMonthlyCost, 6);
    expect(combined.baselineCost).toBeCloseTo(regionA.baselineCost + regionB.baselineCost, 6);
    expect(combined.savingsAmount).toBeCloseTo(combined.baselineCost - combined.totalMonthlyCost, 6);
  });

  it("aggregateSelfHostBreakdowns sums GPU counts and cost components", () => {
    const hostParams: HostParams = {
      kind: "cloud",
      gpuInstance: syntheticGpuInstance,
      useReservedPricing: false,
      opsOverheadPct: 0.25,
    };
    const regionA = calculateSelfHostCost({ ...baseWorkload, docsPerMonth: 400 }, syntheticOpenSourceModel, hostParams);
    const regionB = calculateSelfHostCost({ ...baseWorkload, docsPerMonth: 600 }, syntheticOpenSourceModel, hostParams);
    const combined = aggregateSelfHostBreakdowns([
      { regionId: "us", docsPerMonth: 400, breakdown: regionA },
      { regionId: "eu", docsPerMonth: 600, breakdown: regionB },
    ]);

    expect(combined.gpusNeeded).toBe(regionA.gpusNeeded + regionB.gpusNeeded);
    expect(combined.computeCostMonthly).toBeCloseTo(regionA.computeCostMonthly + regionB.computeCostMonthly, 6);
    expect(combined.totalMonthlyCost).toBeCloseTo(regionA.totalMonthlyCost + regionB.totalMonthlyCost, 6);
    expect(combined.utilizationPct).toBeGreaterThan(0);
    expect(combined.utilizationPct).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Capacity model: replicas, usage pattern, scale-down billing, VRAM headroom
// ---------------------------------------------------------------------------

const a100CloudParams: HostParams = {
  kind: "cloud",
  gpuInstance: syntheticGpuInstance, // A100-80GB, $3/GPU-hr, 50% reserved discount
  useReservedPricing: false,
  opsOverheadPct: 0.25,
};

describe("calculateSelfHostCost - GPU count scales in whole replicas of minGpuCount", () => {
  // A model that needs an 8-GPU cluster just to load. Its 1000 tok/s baseline
  // is the aggregate throughput of ONE 8-GPU replica.
  const clusterModel: OpenSourceModel = { ...syntheticOpenSourceModel, id: "test/cluster", minGpuCount: 8 };

  it("regression: bills the full 8-GPU footprint even at low volume (previously priced as 1 GPU)", () => {
    const result = calculateSelfHostCost(baseWorkload, clusterModel, a100CloudParams);
    expect(result.replicas).toBe(1);
    expect(result.gpusNeeded).toBe(8);
    expect(result.limitingFactor).toBe("minimum-footprint");
    // 8 GPUs * $3/hr * 730h = $17,520
    expect(result.computeCostMonthly).toBeCloseTo(8 * 3 * 730, 5);
  });

  it("adds a whole second cluster (8 more GPUs) once one replica can't keep up", () => {
    // 200,000 docs * 3,349.5 effective tokens = 669,900,000 tokens
    // / 782,142.86 active s = 856.5 tok/s ; one replica plans for 1000 * 0.8 = 800 tok/s
    // -> ceil(856.5 / 800) = 2 replicas -> 2 * 8 = 16 GPUs
    const workload = { ...baseWorkload, docsPerMonth: 200_000 };
    const result = calculateSelfHostCost(workload, clusterModel, a100CloudParams);
    expect(result.requiredThroughputTokPerSec).toBeCloseTo(856.5, 1);
    expect(result.replicas).toBe(2);
    expect(result.gpusNeeded).toBe(16);
    expect(result.limitingFactor).toBe("volume");
    expect(result.computeCostMonthly).toBeCloseTo(16 * 3 * 730, 5);
    // utilization during active hours = 856.5 / (2 * 1000) = 42.8%
    expect(result.utilizationPct).toBeCloseTo(42.83, 1);
  });

  it("keeps the 80% utilization planning target", () => {
    expect(UTILIZATION_TARGET).toBe(0.8);
  });
});

describe("calculateSelfHostCost - batch operating window", () => {
  const workload = { ...baseWorkload, docsPerMonth: 200_000 };

  it("needs more GPUs to process the same volume in business hours than spread over 24/7", () => {
    // 24/7: 669,900,000 / 2,628,000 s = 254.9 tok/s -> ceil(254.9 / 800) = 1 replica
    // 10h x 5d: 669,900,000 / 782,142.86 s = 856.5 tok/s -> ceil(856.5 / 800) = 2 replicas
    const alwaysOn = calculateSelfHostCost(
      { ...workload, capacity: ALWAYS_ON_CAPACITY },
      syntheticOpenSourceModel,
      a100CloudParams,
    );
    const businessHours = calculateSelfHostCost(workload, syntheticOpenSourceModel, a100CloudParams);

    expect(alwaysOn.activeHoursPerMonth).toBeCloseTo(730, 6);
    expect(alwaysOn.requiredThroughputTokPerSec).toBeCloseTo(254.9, 1);
    expect(alwaysOn.gpusNeeded).toBe(1);
    expect(businessHours.gpusNeeded).toBe(2);
    expect(businessHours.totalMonthlyCost).toBeGreaterThan(alwaysOn.totalMonthlyCost);
  });

  it("computes active hours/month from hours/day x days/week x weeks/month", () => {
    expect(getActiveHoursPerMonth(DEFAULT_CAPACITY_PROFILE)).toBeCloseTo(217.2619, 4);
    expect(getActiveHoursPerMonth(ALWAYS_ON_CAPACITY)).toBeCloseTo(730, 6);
  });
});

const interactive = (peakConcurrentUsers: number, targetTokPerSecPerUser = 20): WorkloadInputs => ({
  ...baseWorkload,
  capacity: { ...DEFAULT_CAPACITY_PROFILE, pattern: "interactive", peakConcurrentUsers, targetTokPerSecPerUser },
});

// Same 1000 tok/s A100 model, but with an 8B-class KV footprint so GPU
// memory is never the binding constraint in these throughput-focused tests:
// KV/seq = 8 * 0.0043 MiB * 4096 = 140.9024 MiB; (80 - 6) GB * 0.85 = 62.9 GiB
// -> floor(64,409.6 / 140.9024) = floor(457.12) = 457 sequences/replica
// (2 GPUs: 130.9 GiB = 134,041.6 MiB -> 951), far above every throughput
// bound used below (at most 100 users/replica).
const lightKvModel: OpenSourceModel = {
  ...syntheticOpenSourceModel,
  id: "test/oss-light-kv",
  paramsB: 8,
  vramFp16GB: 16,
  vramInt4GB: 6,
};

describe("calculateSelfHostCost - interactive (live users) pattern", () => {
  it("sizes for peak concurrency even when monthly volume alone would fit one replica", () => {
    // Volume: 4.28 tok/s -> 1 replica.
    // Concurrency: one replica serves floor(1000 * 0.8 / 20) = 40 users at 20 tok/s
    // (VRAM allows 457, so throughput binds); 100 users -> ceil(100 / 40) = 3 replicas.
    const result = calculateSelfHostCost(interactive(100), lightKvModel, a100CloudParams);
    expect(result.replicas).toBe(3);
    expect(result.gpusNeeded).toBe(3);
    expect(result.limitingFactor).toBe("concurrency");
    expect(result.concurrencyBound).toBe("throughput");
    expect(result.peakConcurrentUsers).toBe(100);

    const sameVolumeAsBatch = calculateSelfHostCost(baseWorkload, lightKvModel, a100CloudParams);
    expect(sameVolumeAsBatch.gpusNeeded).toBe(1);
  });

  it("multiplies concurrency replicas by minGpuCount for multi-GPU models", () => {
    const twoGpuModel = { ...lightKvModel, minGpuCount: 2 };
    const result = calculateSelfHostCost(interactive(100), twoGpuModel, a100CloudParams);
    expect(result.replicas).toBe(3);
    expect(result.gpusNeeded).toBe(6);
  });

  it("needs more replicas for a snappier per-user speed target", () => {
    // 40 tok/s per user -> floor(800 / 40) = 20 users per replica -> ceil(100 / 20) = 5 replicas
    const snappy = calculateSelfHostCost(interactive(100, 40), lightKvModel, a100CloudParams);
    expect(snappy.replicas).toBe(5);
    // 8 tok/s -> floor(800 / 8) = 100 users per replica -> 1 replica
    const reading = calculateSelfHostCost(interactive(100, 8), lightKvModel, a100CloudParams);
    expect(reading.replicas).toBe(1);
  });

  it("ignores concurrency inputs in batch mode", () => {
    const batchWithUsers: WorkloadInputs = {
      ...baseWorkload,
      capacity: { ...DEFAULT_CAPACITY_PROFILE, pattern: "batch", peakConcurrentUsers: 10_000 },
    };
    const result = calculateSelfHostCost(batchWithUsers, syntheticOpenSourceModel, a100CloudParams);
    expect(result.replicas).toBe(1);
    expect(result.peakConcurrentUsers).toBe(0);
    expect(result.concurrencyBound).toBeUndefined();
  });
});

describe("calculateSelfHostCost - concurrency is capped by GPU memory (KV cache), not just throughput", () => {
  it("maxConcurrentSequencesFromVram: 70B dense model on one 80GB A100", () => {
    // KV/token = 70B * 0.0043 MiB = 0.301 MiB; * 4096 tokens = 1,232.896 MiB per sequence
    // headroom = (80 - 40) GB * 0.85 = 34 GiB = 34,816 MiB -> floor(34,816 / 1,232.896) = floor(28.24) = 28
    expect(KV_CACHE_MB_PER_TOKEN_PER_B_PARAMS).toBe(0.0043);
    expect(KV_CACHE_USABLE_VRAM_FRACTION).toBe(0.85);
    expect(ASSUMED_AVG_CONTEXT_TOKENS_PER_CONCURRENT_USER).toBe(4096);
    expect(maxConcurrentSequencesFromVram(syntheticOpenSourceModel, "A100-80GB", 1)).toBe(28);
    // 2 GPUs: (160 - 40) * 0.85 = 102 GiB = 104,448 MiB -> floor(104,448 / 1,232.896) = floor(84.72) = 84
    expect(maxConcurrentSequencesFromVram(syntheticOpenSourceModel, "A100-80GB", 2)).toBe(84);
    // Shorter assumed context -> more sequences: 2048 tokens -> 616.448 MiB -> floor(56.48) = 56
    expect(maxConcurrentSequencesFromVram(syntheticOpenSourceModel, "A100-80GB", 1, 2048)).toBe(56);
  });

  it("maxConcurrentSequencesFromVram never drops below 1, even with no headroom", () => {
    // 40GB weights on a 24GB L4: max(0, 24 - 40) = 0 headroom -> floored at 1
    expect(maxConcurrentSequencesFromVram(syntheticOpenSourceModel, "L4", 1)).toBe(1);
  });

  it("MoE models scale KV cache off ACTIVE params, not total params", () => {
    const gptOss120b = OPEN_SOURCE_MODELS.find((m) => m.id === "gpt-oss-120b")!;
    // 5.1B active * 0.0043 MiB * 4096 = 89.82528 MiB/seq; (80 - 65) GB * 0.85 = 12.75 GiB = 13,056 MiB
    // -> floor(13,056 / 89.82528) = floor(145.35) = 145
    // (using 117B total params: 2,060.6976 MiB/seq -> floor(6.34) = 6)
    expect(maxConcurrentSequencesFromVram(gptOss120b, "H100-80GB", 1)).toBe(145);
  });

  it("regression: a 70B model on one A100 is memory-bound - needs more replicas than throughput alone implies", () => {
    // Throughput-only: floor(1000 * 0.8 / 20) = 40 users/replica -> ceil(100 / 40) = 3 replicas (old answer)
    // VRAM: 28 sequences/replica -> min(40, 28) = 28 -> ceil(100 / 28) = ceil(3.57) = 4 replicas
    const result = calculateSelfHostCost(interactive(100), syntheticOpenSourceModel, a100CloudParams);
    const naiveThroughputOnlyReplicas = Math.ceil(100 / Math.floor((1000 * 0.8) / 20));
    expect(naiveThroughputOnlyReplicas).toBe(3);
    expect(result.replicas).toBe(4);
    expect(result.gpusNeeded).toBe(4);
    expect(result.gpusNeeded).toBeGreaterThan(naiveThroughputOnlyReplicas);
    expect(result.limitingFactor).toBe("concurrency");
    expect(result.concurrencyBound).toBe("vram");
    // 4 GPUs * $3/hr * 730h = $8,760
    expect(result.computeCostMonthly).toBeCloseTo(4 * 3 * 730, 5);
  });

  it("regression: a fast, low-active-param MoE (GPT-OSS 120B on H100) at 1,000 reading-speed users is memory-bound", () => {
    const gptOss120b = OPEN_SOURCE_MODELS.find((m) => m.id === "gpt-oss-120b")!;
    const h100Params: HostParams = {
      ...a100CloudParams,
      gpuInstance: { ...syntheticGpuInstance, gpuType: "H100-80GB" },
    };
    // At 8 tok/s ("reading speed"), throughput: 2500 tok/s on its own H100 baseline * 0.8 / 8
    //   = 250 users/replica -> ceil(1000 / 250) = 4 replicas under the old throughput-only math
    // VRAM: 145 sequences/replica -> min(250, 145) = 145 -> ceil(1000 / 145) = ceil(6.90) = 7 replicas
    const result = calculateSelfHostCost(interactive(1000, 8), gptOss120b, h100Params);
    expect(result.gpuThroughputTokPerSec).toBeCloseTo(2500, 6);
    expect(result.replicas).toBe(7);
    expect(result.gpusNeeded).toBe(7);
    expect(result.gpusNeeded).toBeGreaterThan(4);
    expect(result.concurrencyBound).toBe("vram");
  });

  it("GPT-OSS 120B at 20 tok/s/user is throughput-bound (memory has room for 145, compute only 100)", () => {
    const gptOss120b = OPEN_SOURCE_MODELS.find((m) => m.id === "gpt-oss-120b")!;
    const h100Params: HostParams = {
      ...a100CloudParams,
      gpuInstance: { ...syntheticGpuInstance, gpuType: "H100-80GB" },
    };
    // Throughput: 2500 * 0.8 / 20 = 100 users/replica < 145 VRAM -> ceil(1000 / 100) = 10 replicas
    const result = calculateSelfHostCost(interactive(1000), gptOss120b, h100Params);
    expect(result.replicas).toBe(10);
    expect(result.concurrencyBound).toBe("throughput");
  });

  it("stays throughput-bound when VRAM has room to spare (Nemotron 3 Super on 2x H100)", () => {
    const nemotronSuper = OPEN_SOURCE_MODELS.find((m) => m.id === "nemotron-3-super")!;
    const h100Params: HostParams = {
      ...a100CloudParams,
      gpuInstance: { ...syntheticGpuInstance, gpuType: "H100-80GB" },
    };
    // Throughput: 700 tok/s * 0.8 / 20 = 28 users/replica
    // VRAM: 12B active * 0.0043 * 4096 = 211.3536 MiB/seq; (160 - 60) * 0.85 = 85 GiB = 87,040 MiB
    //   -> floor(411.82) = 411 sequences - not binding
    // -> min(28, 411) = 28 -> ceil(100 / 28) = 4 replicas = 8 GPUs
    expect(maxConcurrentSequencesFromVram(nemotronSuper, "H100-80GB", 2)).toBe(411);
    const result = calculateSelfHostCost(interactive(100), nemotronSuper, h100Params);
    expect(result.replicas).toBe(4);
    expect(result.gpusNeeded).toBe(8);
    expect(result.limitingFactor).toBe("concurrency");
    expect(result.concurrencyBound).toBe("throughput");
  });

  it("omits concurrencyBound when volume (not concurrency) sets the replica count", () => {
    // 3 users need 1 replica for concurrency, but 200,000 docs need 2 for volume
    const result = calculateSelfHostCost(
      { ...interactive(3), docsPerMonth: 200_000 },
      syntheticOpenSourceModel,
      a100CloudParams,
    );
    expect(result.limitingFactor).toBe("volume");
    expect(result.concurrencyBound).toBeUndefined();
  });
});

describe("calculateSelfHostCost - shut down outside active hours (cloud)", () => {
  const scaleDownParams: HostParams = {
    kind: "cloud",
    gpuInstance: syntheticGpuInstance,
    useReservedPricing: false,
    opsOverheadPct: 0.25,
    scaleDownOutsideActiveHours: true,
  };

  it("bills active hours plus a 30-min/active-day spin-up buffer instead of 730h", () => {
    // 217.2619 active h + 0.5h * 5 days * 4.345238 weeks = 217.2619 + 10.8631 = 228.125 h
    const result = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, scaleDownParams);
    expect(result.billedHoursPerMonth).toBeCloseTo(228.125, 3);
    // 1 GPU * $3/hr * 228.125h = $684.375
    expect(result.computeCostMonthly).toBeCloseTo(684.375, 3);
  });

  it("ignores reserved pricing when scaling down (reserved assumes a 24/7 commitment)", () => {
    const withReserved = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, {
      ...scaleDownParams,
      useReservedPricing: true,
    });
    const withoutReserved = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, scaleDownParams);
    expect(withReserved.computeCostMonthly).toBeCloseTo(withoutReserved.computeCostMonthly, 6);
  });

  it("never bills more than the full month, even for a 24/7 pattern", () => {
    expect(getCloudBilledHoursPerMonth(ALWAYS_ON_CAPACITY, true)).toBe(HOURS_PER_MONTH);
    expect(getCloudBilledHoursPerMonth(DEFAULT_CAPACITY_PROFILE, false)).toBe(HOURS_PER_MONTH);
  });
});

describe("VRAM headroom warning", () => {
  const llama70b = OPEN_SOURCE_MODELS.find((m) => m.id === "llama-3.3-70b")!;
  const deepseekFlash = OPEN_SOURCE_MODELS.find((m) => m.id === "deepseek-v4-flash")!;

  it("warns for a genuinely tight fit: a 70B model (40GB at 4-bit) on a single 24GB L4", () => {
    // 40GB * 1.1 = 44GB > 24GB * 1
    expect(hasVramHeadroomWarning(llama70b, "L4")).toBe(true);
    const result = calculateSelfHostCost(baseWorkload, llama70b, {
      ...a100CloudParams,
      gpuInstance: { ...syntheticGpuInstance, gpuType: "L4" },
    });
    expect(result.vramHeadroomWarning).toBe(true);
  });

  it("does not warn when the recommended GPU has headroom", () => {
    // 40GB * 1.1 = 44GB <= 80GB * 1
    expect(hasVramHeadroomWarning(llama70b, "A100-80GB")).toBe(false);
    const result = calculateSelfHostCost(baseWorkload, llama70b, a100CloudParams);
    expect(result.vramHeadroomWarning).toBe(false);
  });

  it("regression: DeepSeek V4 Flash at the old 2x H100 sizing was tight; the corrected 4x H100 is not", () => {
    // 160GB * 1.1 = 176GB > 2 * 80GB = 160GB, but <= 4 * 80GB = 320GB
    expect(deepseekFlash.minGpuCount).toBe(4);
    expect(hasVramHeadroomWarning({ ...deepseekFlash, minGpuCount: 2 }, "H100-80GB")).toBe(true);
    expect(hasVramHeadroomWarning(deepseekFlash, "H100-80GB")).toBe(false);
  });

  it("no catalog model warns on its own recommended GPU setup", () => {
    const tight = OPEN_SOURCE_MODELS.filter((m) => hasVramHeadroomWarning(m, m.minGpuType));
    expect(tight.map((m) => m.id)).toEqual([]);
  });
});

describe("Batch API pricing", () => {
  it("halves calculateApiCost's total (input, cached input and output)", () => {
    const standard = calculateApiCost(baseWorkload, syntheticCommercialModel);
    const batch = calculateApiCost({ ...baseWorkload, useBatchApi: true }, syntheticCommercialModel);
    // $18.62 -> $9.31
    expect(batch.totalMonthlyCost).toBeCloseTo(9.31, 5);
    expect(batch.totalMonthlyCost).toBeCloseTo(standard.totalMonthlyCost * 0.5, 6);
    // Token counts are unchanged - only prices are discounted.
    expect(batch.monthlyInputTokens).toBe(standard.monthlyInputTokens);

    const cachedStandard = calculateApiCost({ ...baseWorkload, useCaching: true }, syntheticCommercialModel);
    const cachedBatch = calculateApiCost(
      { ...baseWorkload, useCaching: true, useBatchApi: true },
      syntheticCommercialModel,
    );
    expect(cachedBatch.totalMonthlyCost).toBeCloseTo(cachedStandard.totalMonthlyCost * 0.5, 6);
  });

  it("halves each routed tier's model cost, but not the router's cost", () => {
    const standard = calculateRoutedApiCost(baseWorkload, bigModel, smallModel, layaRouter, 0.25);
    const batch = calculateRoutedApiCost({ ...baseWorkload, useBatchApi: true }, bigModel, smallModel, layaRouter, 0.25);
    expect(batch.bigModelCost).toBeCloseTo(standard.bigModelCost * 0.5, 6); // 4.655 -> 2.3275
    expect(batch.smallModelCost).toBeCloseTo(standard.smallModelCost * 0.5, 6);
    expect(batch.routerCost).toBe(standard.routerCost);
    expect(batch.baselineCost).toBeCloseTo(standard.baselineCost * 0.5, 6);
  });
});

describe("Claude tokenizer multiplier", () => {
  const CLAUDE_NEW_TOKENIZER_IDS = [
    "anthropic/claude-sonnet-5",
    "anthropic/claude-opus-5.5",
    "anthropic/claude-fable-5.1",
  ];

  it("adds 30% input tokens for exactly the three newest-tokenizer Claude models", () => {
    for (const model of COMMERCIAL_MODELS) {
      const result = calculateApiCost(baseWorkload, model);
      if (CLAUDE_NEW_TOKENIZER_IDS.includes(model.id)) {
        // 5,950,000 * 1.3 = 7,735,000
        expect(result.monthlyInputTokens, model.id).toBe(7_735_000);
      } else {
        expect(result.monthlyInputTokens, model.id).toBe(5_950_000);
      }
      // Output tokens are not affected.
      expect(result.monthlyOutputTokens, model.id).toBe(672_000);
    }
    expect(COMMERCIAL_MODELS.filter((m) => m.tokenizerMultiplier).map((m) => m.id).sort()).toEqual(
      [...CLAUDE_NEW_TOKENIZER_IDS].sort(),
    );
  });

  it("prices the extra input tokens (synthetic $2/$10 model)", () => {
    const withMultiplier = calculateApiCost(baseWorkload, { ...syntheticCommercialModel, tokenizerMultiplier: 1.3 });
    // input: 7,735,000 * $2/M = $15.47 ; output unchanged at $6.72 -> $22.19 (vs $18.62)
    expect(withMultiplier.inputCost).toBeCloseTo(15.47, 5);
    expect(withMultiplier.totalMonthlyCost).toBeCloseTo(22.19, 5);
  });

  it("applies in routed API calculations too, only to the model that has it", () => {
    const claudeLikeBig = { ...bigModel, tokenizerMultiplier: 1.3 };
    const result = calculateRoutedApiCost(baseWorkload, claudeLikeBig, smallModel, jevRouter, 0.25);
    // 250 calls: 1,487,500 input * 1.3 = 1,933,750 tokens * $2/M = $3.8675 ; output 168,000 * $10/M = $1.68
    expect(result.bigModelCost).toBeCloseTo(5.5475, 5);
    // small model has no multiplier: unchanged from the plain 2-tier case
    expect(result.smallModelCost).toBeCloseTo(0.64785, 5);
  });
});

describe("checkContextWindowFit accounts for a model's own tokenizer multiplier", () => {
  it("uses the raw token count for a model with no tokenizer multiplier", () => {
    // 8-page "medium" doc -> 5,600 doc tokens + 350 overhead = 5,950 raw input tokens/call
    const result = checkContextWindowFit(baseWorkload, syntheticCommercialModel);
    expect(result.inputTokensPerCall).toBe(5950);
  });

  it("inflates the checked token count by the tokenizer multiplier, matching what's actually billed", () => {
    // 5,950 raw * 1.3 = 7,735 - matches calculateApiCost's monthlyInputTokens/1000 calls
    const result = checkContextWindowFit(baseWorkload, { ...syntheticCommercialModel, tokenizerMultiplier: 1.3 });
    expect(result.inputTokensPerCall).toBe(7735);
  });

  it("regression: a tighter context window can flip from fitting to exceeding once the multiplier is applied", () => {
    // contextWindow=7000 sits between the raw (5,950) and multiplier-adjusted (7,735) token
    // counts - checking the raw count alone would wrongly report this request as fitting.
    const tightModel = { ...syntheticCommercialModel, contextWindow: 7000, tokenizerMultiplier: 1.3 };
    const result = checkContextWindowFit(baseWorkload, tightModel);
    expect(result.inputTokensPerCall).toBe(7735);
    expect(result.fits).toBe(false);
  });
});

describe("Routing and regions split peak concurrent users proportionally", () => {
  const interactiveWorkload: WorkloadInputs = {
    ...baseWorkload,
    capacity: { ...DEFAULT_CAPACITY_PROFILE, pattern: "interactive", peakConcurrentUsers: 100 },
  };

  it("gives each routing tier its share of peak users", () => {
    const highTier: SelfHostRoutingTier = { model: highOssModel, hostParams: highHostParams };
    const lowTier: SelfHostRoutingTier = { model: lowOssModel, hostParams: lowHostParams };
    const result = calculateRoutedSelfHostCost(interactiveWorkload, highTier, lowTier, laya, 0.25);
    const high = result.tiers.find((t) => t.tier === "high")!;
    const low = result.tiers.find((t) => t.tier === "low")!;

    // High: 25 users; throughput 1000 tok/s * 0.8 / 20 = 40 users/replica, VRAM
    // (70B on one 80GB A100) holds 28 sequences -> min(40, 28) = 28 -> ceil(25 / 28) = 1 replica
    // (one replica is the minimum footprint, so no concurrency bound is reported)
    expect(high.breakdown.peakConcurrentUsers).toBe(25);
    expect(high.breakdown.replicas).toBe(1);
    expect(high.breakdown.limitingFactor).toBe("minimum-footprint");
    expect(high.breakdown.concurrencyBound).toBeUndefined();
    // Low: 75 users; L4 8B model: throughput 1800 * 0.8 / 20 = 72 users/replica;
    // VRAM (24 - 6) GB * 0.85 = 15.3 GiB = 15,667.2 MiB / 140.9024 MiB = floor(111.19) = 111
    // -> min(72, 111) = 72 -> ceil(75 / 72) = 2 replicas
    expect(low.breakdown.peakConcurrentUsers).toBe(75);
    expect(low.breakdown.replicas).toBe(2);
    expect(low.breakdown.limitingFactor).toBe("concurrency");
    expect(low.breakdown.concurrencyBound).toBe("throughput");
  });

  it("withWorkloadShare scales peak users and sets the region's docs", () => {
    const half = withWorkloadShare(interactiveWorkload, 500, 0.5);
    expect(half.docsPerMonth).toBe(500);
    expect(half.capacity.peakConcurrentUsers).toBe(50);
    expect(interactiveWorkload.capacity.peakConcurrentUsers).toBe(100); // not mutated
  });

  it("aggregates replicas, limiting factor and VRAM warnings across regions", () => {
    const regionA = calculateSelfHostCost(
      withWorkloadShare(interactiveWorkload, 500, 0.5),
      syntheticOpenSourceModel,
      a100CloudParams,
    );
    const regionB = calculateSelfHostCost(
      withWorkloadShare(interactiveWorkload, 500, 0.5),
      syntheticOpenSourceModel,
      a100CloudParams,
    );
    // 50 users per region; VRAM caps a replica at 28 sequences (throughput would allow 40)
    // -> ceil(50 / 28) = ceil(1.79) = 2 replicas each
    expect(regionA.replicas).toBe(2);
    expect(regionA.concurrencyBound).toBe("vram");
    const combined = aggregateSelfHostBreakdowns([
      { regionId: "us", docsPerMonth: 500, breakdown: regionA },
      { regionId: "eu", docsPerMonth: 500, breakdown: regionB },
    ]);
    expect(combined.replicas).toBe(4);
    expect(combined.gpusNeeded).toBe(4);
    expect(combined.limitingFactor).toBe("concurrency");
    expect(combined.concurrencyBound).toBe("vram");
    expect(combined.peakConcurrentUsers).toBe(100);
    expect(combined.vramHeadroomWarning).toBe(false);
    // scaling for a regional price multiplier preserves the new fields
    const scaled = scaleSelfHostBreakdown(regionA, 1.3, 500);
    expect(scaled.replicas).toBe(regionA.replicas);
    expect(scaled.limitingFactor).toBe(regionA.limitingFactor);
  });
});

describe("estimateSelfHostMonthlyCost uses the workload's usage pattern", () => {
  it("costs more under an interactive pattern that needs more replicas", () => {
    const llama70b = OPEN_SOURCE_MODELS.find((m) => m.id === "llama-3.3-70b")!;
    // Batch: 1 replica -> 1 GPU * $3/hr * 730h * 1.25 = $2,737.50
    const batch = estimateSelfHostMonthlyCost(baseWorkload, llama70b, a100CloudParams);
    expect(batch).toBeCloseTo(2737.5, 6);
    // 200 live users: throughput 600 * 0.8 / 20 = 24 users/replica; VRAM holds 28
    // -> min(24, 28) = 24 -> ceil(200 / 24) = ceil(8.33) = 9 GPUs * $2,737.50 = $24,637.50
    const interactiveCost = estimateSelfHostMonthlyCost(interactive(200), llama70b, a100CloudParams);
    expect(interactiveCost).toBeCloseTo(9 * 2737.5, 6);
    expect(interactiveCost).toBeGreaterThan(batch);
  });
});

describe("estimateSelfHostMonthlyCost follows the hosting settings it is given (catalog preview)", () => {
  const nemotronSuper = OPEN_SOURCE_MODELS.find((m) => m.id === "nemotron-3-super")!;
  const awsH100 = GPU_INSTANCES.find((i) => i.id === "aws-p5-48xlarge")!;
  const awsOnDemandAlwaysOn: HostParams = {
    kind: "cloud",
    gpuInstance: awsH100,
    useReservedPricing: false,
    opsOverheadPct: 0.25,
  };

  const hostParamsFor = (overrides: Partial<Record<GpuType, HostParams>>) => (model: OpenSourceModel) =>
    overrides[model.minGpuType] ?? resolveOnDemandHostParams(model);

  it("regression: returns different costs for different hosting setups (no longer hardcoded to AWS on-demand)", () => {
    // Old hardcoded preview: 2 H100s * $6.88/hr * 730h = $10,044.80; * 1.25 ops = $12,556/mo
    const onDemand = estimateSelfHostMonthlyCost(baseWorkload, nemotronSuper, awsOnDemandAlwaysOn);
    expect(onDemand).toBeCloseTo(12_556, 6);

    // Scale-down: 228.125 billed h -> 2 * $6.88 * 228.125 = $3,139.00; * 1.25 = $3,923.75/mo
    const scaleDown = estimateSelfHostMonthlyCost(baseWorkload, nemotronSuper, {
      ...awsOnDemandAlwaysOn,
      scaleDownOutsideActiveHours: true,
    });
    expect(scaleDown).toBeCloseTo(3923.75, 6);

    // Reserved (57% off): $6.88 * 0.43 = $2.9584/hr * 2 * 730h = $4,319.26; * 1.25 = $5,399.08/mo
    const reserved = estimateSelfHostMonthlyCost(baseWorkload, nemotronSuper, {
      ...awsOnDemandAlwaysOn,
      useReservedPricing: true,
    });
    expect(reserved).toBeCloseTo(5399.08, 2);

    // Owned (3 yr, 30% ops): $78,400 / 36 = $2,177.78 + $59.62 power + $671.22 ops = $2,908.61/mo
    const owned = estimateSelfHostMonthlyCost(baseWorkload, nemotronSuper, {
      kind: "owned",
      ownedGpu: OWNED_GPU_SPECS.find((s) => s.gpuType === "H100-80GB")!,
      opsOverheadPct: 0.3,
      depreciationYears: 3,
    });
    expect(owned).toBeCloseTo(2908.6128, 3);

    expect(new Set([onDemand, scaleDown, reserved, owned]).size).toBe(4);
  });

  it("acceptance: the catalog card price for the High-tier model matches the routing panel's baseline", () => {
    // Both now go through calculateSelfHostCost with identical workload + hostParams,
    // so the full-volume catalog preview and the routing "always use High" baseline agree.
    const userHosting: HostParams = { ...awsOnDemandAlwaysOn, scaleDownOutsideActiveHours: true };
    const resolve = hostParamsFor({ "H100-80GB": userHosting });
    const catalogCardPrice = estimateSelfHostMonthlyCost(baseWorkload, nemotronSuper, resolve(nemotronSuper));
    const routed = calculateRoutedSelfHostCost(
      baseWorkload,
      { model: nemotronSuper, hostParams: resolve(nemotronSuper) },
      { model: lowOssModel, hostParams: resolve(lowOssModel) },
      laya,
      0.25,
    );
    // $3,923.75 in both places (previously the card showed $12,556 regardless of settings)
    expect(catalogCardPrice).toBeCloseTo(3923.75, 6);
    expect(routed.baselineCost).toBe(catalogCardPrice);
  });

  it("getOpenSourceModelsCheaperThan resolves each model's own hosting through the callback", () => {
    // A 1x A100-80GB model on cloud rental costs $3,351.61/mo. That is cheaper than
    // Nemotron 3 Super on AWS on-demand ($12,556/mo), but NOT cheaper than Nemotron 3
    // Super on owned H100s ($2,908.61/mo) - the guardrail must use the resolved hosting.
    const a100Model: OpenSourceModel = { ...syntheticOpenSourceModel, id: "test/a100-model" };
    const ownedH100: HostParams = {
      kind: "owned",
      ownedGpu: OWNED_GPU_SPECS.find((s) => s.gpuType === "H100-80GB")!,
      opsOverheadPct: 0.3,
      depreciationYears: 3,
    };
    const cheaperVsOnDemand = getOpenSourceModelsCheaperThan(
      baseWorkload,
      [nemotronSuper, a100Model],
      nemotronSuper,
      hostParamsFor({ "H100-80GB": awsOnDemandAlwaysOn }),
    );
    expect(cheaperVsOnDemand.map((m) => m.id)).toEqual([a100Model.id]);

    const cheaperVsOwned = getOpenSourceModelsCheaperThan(
      baseWorkload,
      [nemotronSuper, a100Model],
      nemotronSuper,
      hostParamsFor({ "H100-80GB": ownedH100 }),
    );
    expect(cheaperVsOwned).toHaveLength(0);
  });
});
