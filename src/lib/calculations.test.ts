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
  getDocTokens,
  getModelsCheaperThan,
  getOpenSourceModelsCheaperThan,
  getMonthlyTokenVolume,
  scaleRoutedSelfHostBreakdown,
  scaleSelfHostBreakdown,
  splitDocsAcrossRegions,
  withDataResidencyPremium,
  type HostParams,
  type SelfHostRoutingTier,
} from "@/lib/calculations";
import { TOKENS_PER_PAGE, SECONDS_PER_MONTH, HOURS_PER_MONTH } from "@/lib/data/constants";
import { OWN_SERVER_DEFAULTS } from "@/lib/data/gpu-instances";
import { ROUTER_TOKENS_PER_DECISION } from "@/lib/data/routing";
import type {
  CommercialModel,
  GpuInstance,
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
};

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

    const effectiveMonthlyTokens = 672_000 + 5_950_000 * 0.1; // output + weighted input
    const expectedThroughput = effectiveMonthlyTokens / SECONDS_PER_MONTH;

    expect(result.requiredThroughputTokPerSec).toBeCloseTo(expectedThroughput, 6);
    expect(result.gpuThroughputTokPerSec).toBe(1000); // A100-80GB multiplier is 1.0
    expect(result.gpusNeeded).toBe(1);
    expect(result.utilizationPct).toBeCloseTo((expectedThroughput / 1000) * 100, 6);
  });

  it("computes on-demand compute + overhead cost with no electricity line item", () => {
    const result = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, cloudParams);

    const expectedCompute = 1 * 3 * HOURS_PER_MONTH; // 1 GPU * $3/hr * 730h
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
    hoursPerMonth: HOURS_PER_MONTH,
    opsOverheadPct: 0.3,
    depreciationYears: 2,
  };

  it("amortizes hardware cost and adds electricity + overhead", () => {
    const result = calculateSelfHostCost(baseWorkload, syntheticOpenSourceModel, ownedParams);

    const hardwareTotal = 1 * 10_000 * OWN_SERVER_DEFAULTS.serverOverheadMultiplier;
    const expectedDepreciation = hardwareTotal / (2 * 12);
    const expectedKw = (1 * 300 * OWN_SERVER_DEFAULTS.pue) / 1000;
    const expectedElectricity =
      expectedKw * HOURS_PER_MONTH * OWN_SERVER_DEFAULTS.electricityPricePerKwh;
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
    const result = getOpenSourceModelsCheaperThan(
      baseWorkload,
      [syntheticOpenSourceModel, cheapModel, pricierModel],
      syntheticOpenSourceModel,
    );
    const ids = result.map((m) => m.id);
    expect(ids).toContain(cheapModel.id);
    expect(ids).not.toContain(pricierModel.id);
    expect(ids).not.toContain(syntheticOpenSourceModel.id);
  });
});

const highOssModel: OpenSourceModel = { ...syntheticOpenSourceModel, id: "test/oss-high" };
const lowOssModel: OpenSourceModel = {
  ...syntheticOpenSourceModel,
  id: "test/oss-low",
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
