import type {
  ApiCostBreakdown,
  CommercialModel,
  GpuInstance,
  OpenSourceModel,
  OwnedGpuSpec,
  RouterOption,
  RoutedApiCostBreakdown,
  SelfHostCostBreakdown,
  WorkloadInputs,
} from "@/lib/types";
import type { RegionAllocation } from "@/lib/types";
import {
  ASSUMED_CACHEABLE_INPUT_FRACTION,
  DOC_SIZE_PRESETS,
  HOURS_PER_MONTH,
  INPUT_TOKEN_COMPUTE_WEIGHT,
  SECONDS_PER_MONTH,
  TASK_PRESETS,
  TOKENS_PER_PAGE,
} from "@/lib/data/constants";
import { GPU_THROUGHPUT_MULTIPLIER } from "@/lib/data/opensource-models";
import { CLOUD_OPS_OVERHEAD_DEFAULT_PCT, GPU_INSTANCES, OWN_SERVER_DEFAULTS } from "@/lib/data/gpu-instances";
import { ROUTER_TOKENS_PER_DECISION } from "@/lib/data/routing";

export function getDocTokens(workload: WorkloadInputs): number {
  const preset = DOC_SIZE_PRESETS.find((p) => p.id === workload.docSizePresetId);
  const pages = workload.docSizePresetId === "custom" ? workload.customPages : preset?.pages ?? 8;
  return Math.max(1, Math.round(pages * TOKENS_PER_PAGE));
}

export interface TokenVolume {
  monthlyInputTokens: number;
  monthlyOutputTokens: number;
  inputTokensPerCall: number;
  outputTokensPerCall: number;
}

export function getMonthlyTokenVolume(workload: WorkloadInputs): TokenVolume {
  const task = TASK_PRESETS.find((t) => t.id === workload.taskType) ?? TASK_PRESETS[0];
  const docTokens = getDocTokens(workload);

  const inputTokensPerCall = docTokens + task.promptOverheadTokens;
  const outputTokensPerCall = Math.max(
    task.minOutputTokens,
    Math.round(docTokens * task.outputRatio),
  );

  const calls = workload.docsPerMonth * workload.callsPerDoc;

  return {
    monthlyInputTokens: Math.round(calls * inputTokensPerCall),
    monthlyOutputTokens: Math.round(calls * outputTokensPerCall),
    inputTokensPerCall,
    outputTokensPerCall,
  };
}

export function calculateApiCost(
  workload: WorkloadInputs,
  model: CommercialModel,
): ApiCostBreakdown {
  const { monthlyInputTokens, monthlyOutputTokens } = getMonthlyTokenVolume(workload);

  const canCache = workload.useCaching && !!model.cachedInputPricePerM;
  const cachedInputTokens = canCache
    ? Math.round(monthlyInputTokens * ASSUMED_CACHEABLE_INPUT_FRACTION)
    : 0;
  const uncachedInputTokens = monthlyInputTokens - cachedInputTokens;

  const inputCost = (uncachedInputTokens / 1_000_000) * model.inputPricePerM;
  const cachedInputCost = canCache
    ? (cachedInputTokens / 1_000_000) * (model.cachedInputPricePerM as number)
    : 0;
  const outputCost = (monthlyOutputTokens / 1_000_000) * model.outputPricePerM;

  const totalMonthlyCost = inputCost + cachedInputCost + outputCost;

  return {
    modelId: model.id,
    monthlyInputTokens,
    monthlyOutputTokens,
    cachedInputTokens,
    uncachedInputTokens,
    inputCost,
    cachedInputCost,
    outputCost,
    totalMonthlyCost,
    costPerDocument: workload.docsPerMonth > 0 ? totalMonthlyCost / workload.docsPerMonth : 0,
    annualCost: totalMonthlyCost * 12,
  };
}

export interface CloudHostParams {
  kind: "cloud";
  gpuInstance: GpuInstance;
  useReservedPricing: boolean;
  opsOverheadPct: number;
}

export interface OwnedHostParams {
  kind: "owned";
  ownedGpu: OwnedGpuSpec;
  hoursPerMonth: number;
  opsOverheadPct: number;
  depreciationYears: number;
}

export type HostParams = CloudHostParams | OwnedHostParams;

export function calculateSelfHostCost(
  workload: WorkloadInputs,
  model: OpenSourceModel,
  hostParams: HostParams,
): SelfHostCostBreakdown {
  const { monthlyInputTokens, monthlyOutputTokens } = getMonthlyTokenVolume(workload);

  const effectiveMonthlyTokens =
    monthlyOutputTokens + monthlyInputTokens * INPUT_TOKEN_COMPUTE_WEIGHT;
  const requiredThroughputTokPerSec = effectiveMonthlyTokens / SECONDS_PER_MONTH;

  const gpuType = hostParams.kind === "cloud" ? hostParams.gpuInstance.gpuType : hostParams.ownedGpu.gpuType;
  // throughputTokPerSecOnBaseline is measured on the model's OWN recommended
  // GPU (model.minGpuType), not always A100-80GB - normalize relative to that
  // baseline before applying the selected GPU's multiplier, otherwise models
  // recommended on non-A100 hardware get double- or under-scaled.
  const selectedMultiplier = GPU_THROUGHPUT_MULTIPLIER[gpuType] ?? 1;
  const baselineMultiplier = GPU_THROUGHPUT_MULTIPLIER[model.minGpuType] ?? 1;
  const gpuThroughputTokPerSec =
    model.throughputTokPerSecOnBaseline * (selectedMultiplier / baselineMultiplier);

  const gpusNeeded = Math.max(1, Math.ceil(requiredThroughputTokPerSec / gpuThroughputTokPerSec));
  const utilizationPct = Math.min(
    100,
    (requiredThroughputTokPerSec / (gpusNeeded * gpuThroughputTokPerSec)) * 100,
  );

  let computeCostMonthly = 0;
  let electricityCostMonthly = 0;

  if (hostParams.kind === "cloud") {
    const rate = hostParams.useReservedPricing
      ? hostParams.gpuInstance.perGpuOnDemandPerHour * (1 - hostParams.gpuInstance.reservedDiscountPct)
      : hostParams.gpuInstance.perGpuOnDemandPerHour;
    computeCostMonthly = gpusNeeded * rate * HOURS_PER_MONTH;
    // Electricity is already bundled into cloud on-demand/reserved pricing.
    electricityCostMonthly = 0;
  } else {
    const hardwareCostTotal =
      gpusNeeded * hostParams.ownedGpu.approxUnitCostUsd * OWN_SERVER_DEFAULTS.serverOverheadMultiplier;
    const monthlyDepreciation = hardwareCostTotal / (hostParams.depreciationYears * 12);
    computeCostMonthly = monthlyDepreciation;

    const kw = (gpusNeeded * hostParams.ownedGpu.tdpWatts * OWN_SERVER_DEFAULTS.pue) / 1000;
    electricityCostMonthly = kw * hostParams.hoursPerMonth * OWN_SERVER_DEFAULTS.electricityPricePerKwh;
  }

  const overheadCostMonthly =
    (computeCostMonthly + electricityCostMonthly) * hostParams.opsOverheadPct;

  const totalMonthlyCost = computeCostMonthly + electricityCostMonthly + overheadCostMonthly;

  return {
    modelId: model.id,
    requiredThroughputTokPerSec,
    gpuThroughputTokPerSec,
    gpusNeeded,
    utilizationPct,
    computeCostMonthly,
    electricityCostMonthly,
    overheadCostMonthly,
    totalMonthlyCost,
    costPerDocument: workload.docsPerMonth > 0 ? totalMonthlyCost / workload.docsPerMonth : 0,
    annualCost: totalMonthlyCost * 12,
  };
}

/**
 * Models a Jev/Laya-style pre-classification router: every request is first
 * scored by a cheap/fast router, which escalates a configurable share of
 * requests to a "High" (hard/complex) model, an optional "Medium" model, and
 * routes the remainder to a cheaper "Low" model. Leaving mediumModel unset
 * collapses this cleanly to the original 2-tier Low/High behavior.
 */
export function calculateRoutedApiCost(
  workload: WorkloadInputs,
  bigModel: CommercialModel,
  smallModel: CommercialModel,
  router: RouterOption,
  escalationRatePct: number,
  mediumModel?: CommercialModel | null,
  mediumRatePct = 0,
): RoutedApiCostBreakdown {
  const { inputTokensPerCall, outputTokensPerCall } = getMonthlyTokenVolume(workload);
  const totalCalls = workload.docsPerMonth * workload.callsPerDoc;

  const escalatedCalls = Math.round(totalCalls * escalationRatePct);
  // Medium can never eat into the High share; clamp so Low never goes negative.
  const clampedMediumRatePct = mediumModel ? Math.max(0, Math.min(mediumRatePct, 1 - escalationRatePct)) : 0;
  const mediumCalls = mediumModel ? Math.round(totalCalls * clampedMediumRatePct) : 0;
  const routedCalls = Math.max(0, totalCalls - escalatedCalls - mediumCalls);

  const costForCalls = (calls: number, model: CommercialModel) => {
    const inputTokens = calls * inputTokensPerCall;
    const outputTokens = calls * outputTokensPerCall;

    const canCache = workload.useCaching && !!model.cachedInputPricePerM;
    const cachedInputTokens = canCache
      ? Math.round(inputTokens * ASSUMED_CACHEABLE_INPUT_FRACTION)
      : 0;
    const uncachedInputTokens = inputTokens - cachedInputTokens;

    const inputCost = (uncachedInputTokens / 1_000_000) * model.inputPricePerM;
    const cachedInputCost = canCache
      ? (cachedInputTokens / 1_000_000) * (model.cachedInputPricePerM as number)
      : 0;
    const outputCost = (outputTokens / 1_000_000) * model.outputPricePerM;

    return inputCost + cachedInputCost + outputCost;
  };

  const bigModelCost = costForCalls(escalatedCalls, bigModel);
  const mediumModelCost = mediumModel ? costForCalls(mediumCalls, mediumModel) : 0;
  const smallModelCost = costForCalls(routedCalls, smallModel);

  const routerInputTokens = router.id === "none" ? 0 : totalCalls * ROUTER_TOKENS_PER_DECISION;
  const routerCost =
    router.id === "none"
      ? 0
      : (routerInputTokens / 1_000_000) * router.costPerMInputTokens + (router.selfHostMonthlyCost ?? 0);

  const totalMonthlyCost = bigModelCost + mediumModelCost + smallModelCost + routerCost;

  const baselineCost = calculateApiCost(workload, bigModel).totalMonthlyCost;
  const savingsAmount = baselineCost - totalMonthlyCost;
  const savingsPct = baselineCost > 0 ? (savingsAmount / baselineCost) * 100 : 0;

  return {
    totalCalls,
    escalatedCalls,
    mediumCalls,
    routedCalls,
    routerCost,
    routerInputTokens,
    bigModelCost,
    mediumModelCost,
    smallModelCost,
    totalMonthlyCost,
    costPerDocument: workload.docsPerMonth > 0 ? totalMonthlyCost / workload.docsPerMonth : 0,
    annualCost: totalMonthlyCost * 12,
    baselineCost,
    savingsAmount,
    savingsPct,
  };
}

/**
 * Quick, comparable cost estimate for an open-source model using its own
 * recommended GPU (preferring AWS on-demand pricing, falling back to
 * whichever cloud lists that GPU type) at default ops overhead. Used to show
 * a cost preview on the open-source catalog cards, the same way the
 * commercial catalog shows a live price per card.
 */
export function estimateSelfHostMonthlyCost(workload: WorkloadInputs, model: OpenSourceModel): number {
  const candidates = GPU_INSTANCES.filter((i) => i.gpuType === model.minGpuType);
  const instance =
    candidates.find((i) => i.cloud === "AWS") ?? candidates[0] ?? GPU_INSTANCES[0];

  const breakdown = calculateSelfHostCost(workload, model, {
    kind: "cloud",
    gpuInstance: instance,
    useReservedPricing: false,
    opsOverheadPct: CLOUD_OPS_OVERHEAD_DEFAULT_PCT,
  });

  return breakdown.totalMonthlyCost;
}

/**
 * Whether a single model call's input would exceed (or come close to) a
 * model's context window - the calculator otherwise gives a confident dollar
 * figure for a request that wouldn't actually fit.
 */
export function checkContextWindowFit(
  workload: WorkloadInputs,
  contextWindow: number,
): { fits: boolean; nearLimit: boolean; inputTokensPerCall: number } {
  const { inputTokensPerCall } = getMonthlyTokenVolume(workload);
  return {
    fits: inputTokensPerCall <= contextWindow,
    nearLimit: inputTokensPerCall > contextWindow * 0.85,
    inputTokensPerCall,
  };
}

/**
 * Structural guardrail for Smart Routing: only a model that is genuinely
 * cheaper than the reference model, for this exact workload, is a valid
 * choice for a "cheaper tier". This is what makes routing mathematically
 * unable to cost more than the baseline due to model misconfiguration
 * (rather than merely warning about it after the fact).
 */
export function getModelsCheaperThan(
  workload: WorkloadInputs,
  models: CommercialModel[],
  referenceModel: CommercialModel,
): CommercialModel[] {
  const referenceCost = calculateApiCost(workload, referenceModel).totalMonthlyCost;
  return models.filter(
    (m) => m.id !== referenceModel.id && calculateApiCost(workload, m).totalMonthlyCost < referenceCost,
  );
}

/**
 * Splits a total monthly document count evenly across N compliance regions.
 * Compliance-driven multi-region deployments run independent, non-shared
 * infrastructure per region, so each region gets its own slice of volume
 * (and, for self-hosting, its own minimum GPU footprint even at low volume).
 */
export function splitDocsAcrossRegions(totalDocs: number, regionCount: number): number[] {
  if (regionCount <= 0) return [];
  const base = Math.floor(totalDocs / regionCount);
  const remainder = totalDocs - base * regionCount;
  return Array.from({ length: regionCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Applies a flat data-residency pricing premium (e.g. Azure OpenAI Data Zone) to a model. */
export function withDataResidencyPremium(model: CommercialModel, premiumPct: number): CommercialModel {
  if (premiumPct === 0) return model;
  return {
    ...model,
    inputPricePerM: model.inputPricePerM * (1 + premiumPct),
    outputPricePerM: model.outputPricePerM * (1 + premiumPct),
    cachedInputPricePerM:
      model.cachedInputPricePerM !== undefined
        ? model.cachedInputPricePerM * (1 + premiumPct)
        : undefined,
  };
}

/**
 * Scales an already-computed self-host breakdown by a regional cost
 * multiplier (representing higher GPU rental/hosting costs in that region),
 * recomputing the totals that derive from the scaled components.
 */
export function scaleSelfHostBreakdown(
  breakdown: SelfHostCostBreakdown,
  multiplier: number,
  regionalDocsPerMonth: number,
): SelfHostCostBreakdown {
  const computeCostMonthly = breakdown.computeCostMonthly * multiplier;
  const electricityCostMonthly = breakdown.electricityCostMonthly * multiplier;
  const overheadCostMonthly = breakdown.overheadCostMonthly * multiplier;
  const totalMonthlyCost = computeCostMonthly + electricityCostMonthly + overheadCostMonthly;

  return {
    ...breakdown,
    computeCostMonthly,
    electricityCostMonthly,
    overheadCostMonthly,
    totalMonthlyCost,
    costPerDocument: regionalDocsPerMonth > 0 ? totalMonthlyCost / regionalDocsPerMonth : 0,
    annualCost: totalMonthlyCost * 12,
  };
}

function totalDocsOf(allocations: RegionAllocation<unknown>[]): number {
  return allocations.reduce((sum, a) => sum + a.docsPerMonth, 0);
}

/** Combines per-region API cost breakdowns into one internally-consistent total. */
export function aggregateApiBreakdowns(allocations: RegionAllocation<ApiCostBreakdown>[]): ApiCostBreakdown {
  const totalDocs = totalDocsOf(allocations);
  const sum = (fn: (b: ApiCostBreakdown) => number) =>
    allocations.reduce((acc, a) => acc + fn(a.breakdown), 0);

  const totalMonthlyCost = sum((b) => b.totalMonthlyCost);

  return {
    modelId: allocations[0]?.breakdown.modelId ?? "",
    monthlyInputTokens: sum((b) => b.monthlyInputTokens),
    monthlyOutputTokens: sum((b) => b.monthlyOutputTokens),
    cachedInputTokens: sum((b) => b.cachedInputTokens),
    uncachedInputTokens: sum((b) => b.uncachedInputTokens),
    inputCost: sum((b) => b.inputCost),
    cachedInputCost: sum((b) => b.cachedInputCost),
    outputCost: sum((b) => b.outputCost),
    totalMonthlyCost,
    costPerDocument: totalDocs > 0 ? totalMonthlyCost / totalDocs : 0,
    annualCost: totalMonthlyCost * 12,
  };
}

/** Combines per-region routed (smart-routing) breakdowns into one internally-consistent total. */
export function aggregateRoutedApiBreakdowns(
  allocations: RegionAllocation<RoutedApiCostBreakdown>[],
): RoutedApiCostBreakdown {
  const totalDocs = totalDocsOf(allocations);
  const sum = (fn: (b: RoutedApiCostBreakdown) => number) =>
    allocations.reduce((acc, a) => acc + fn(a.breakdown), 0);

  const totalMonthlyCost = sum((b) => b.totalMonthlyCost);
  const baselineCost = sum((b) => b.baselineCost);
  const savingsAmount = baselineCost - totalMonthlyCost;

  return {
    totalCalls: sum((b) => b.totalCalls),
    escalatedCalls: sum((b) => b.escalatedCalls),
    mediumCalls: sum((b) => b.mediumCalls),
    routedCalls: sum((b) => b.routedCalls),
    routerCost: sum((b) => b.routerCost),
    routerInputTokens: sum((b) => b.routerInputTokens),
    bigModelCost: sum((b) => b.bigModelCost),
    mediumModelCost: sum((b) => b.mediumModelCost),
    smallModelCost: sum((b) => b.smallModelCost),
    totalMonthlyCost,
    costPerDocument: totalDocs > 0 ? totalMonthlyCost / totalDocs : 0,
    annualCost: totalMonthlyCost * 12,
    baselineCost,
    savingsAmount,
    savingsPct: baselineCost > 0 ? (savingsAmount / baselineCost) * 100 : 0,
  };
}

/** Combines per-region self-host breakdowns into one internally-consistent total. */
export function aggregateSelfHostBreakdowns(
  allocations: RegionAllocation<SelfHostCostBreakdown>[],
): SelfHostCostBreakdown {
  const totalDocs = totalDocsOf(allocations);
  const sum = (fn: (b: SelfHostCostBreakdown) => number) =>
    allocations.reduce((acc, a) => acc + fn(a.breakdown), 0);

  const computeCostMonthly = sum((b) => b.computeCostMonthly);
  const electricityCostMonthly = sum((b) => b.electricityCostMonthly);
  const overheadCostMonthly = sum((b) => b.overheadCostMonthly);
  const totalMonthlyCost = computeCostMonthly + electricityCostMonthly + overheadCostMonthly;
  const requiredThroughputTokPerSec = sum((b) => b.requiredThroughputTokPerSec);
  const totalCapacityTokPerSec = allocations.reduce(
    (acc, a) => acc + a.breakdown.gpusNeeded * a.breakdown.gpuThroughputTokPerSec,
    0,
  );

  return {
    modelId: allocations[0]?.breakdown.modelId ?? "",
    requiredThroughputTokPerSec,
    gpuThroughputTokPerSec: allocations[0]?.breakdown.gpuThroughputTokPerSec ?? 0,
    gpusNeeded: sum((b) => b.gpusNeeded),
    utilizationPct:
      totalCapacityTokPerSec > 0
        ? Math.min(100, (requiredThroughputTokPerSec / totalCapacityTokPerSec) * 100)
        : 0,
    computeCostMonthly,
    electricityCostMonthly,
    overheadCostMonthly,
    totalMonthlyCost,
    costPerDocument: totalDocs > 0 ? totalMonthlyCost / totalDocs : 0,
    annualCost: totalMonthlyCost * 12,
  };
}
