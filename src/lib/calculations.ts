import type {
  ApiCostBreakdown,
  CapacityProfile,
  CommercialModel,
  GpuInstance,
  GpuType,
  OpenSourceModel,
  OwnedGpuSpec,
  RouterOption,
  RoutedApiCostBreakdown,
  RoutedSelfHostCostBreakdown,
  SelfHostConcurrencyBound,
  SelfHostCostBreakdown,
  SelfHostLimitingFactor,
  SelfHostTierResult,
  WorkloadInputs,
} from "@/lib/types";
import type { RegionAllocation } from "@/lib/types";
import {
  ASSUMED_AVG_CONTEXT_TOKENS_PER_CONCURRENT_USER,
  ASSUMED_CACHEABLE_INPUT_FRACTION,
  BATCH_API_PRICE_MULTIPLIER,
  DOC_SIZE_PRESETS,
  HOURS_PER_MONTH,
  INPUT_TOKEN_COMPUTE_WEIGHT,
  KV_CACHE_MB_PER_TOKEN_PER_B_PARAMS,
  KV_CACHE_USABLE_VRAM_FRACTION,
  SCALE_DOWN_SPINUP_HOURS_PER_ACTIVE_DAY,
  TASK_PRESETS,
  TOKENS_PER_PAGE,
  UTILIZATION_TARGET,
  WEEKS_PER_MONTH,
} from "@/lib/data/constants";
import { GPU_THROUGHPUT_MULTIPLIER } from "@/lib/data/opensource-models";
import { GPU_VRAM_GB, OWN_SERVER_DEFAULTS } from "@/lib/data/gpu-instances";
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

/**
 * Input-token multiplier for models whose tokenizer produces more tokens
 * for the same text than the TOKENS_PER_PAGE baseline assumes (e.g.
 * Anthropic's newest-generation tokenizer, ~30% more). 1 when unset.
 */
export function getTokenizerMultiplier(model: CommercialModel): number {
  return model.tokenizerMultiplier ?? 1;
}

/**
 * Prices a given number of input/output tokens on a commercial model,
 * applying the model's tokenizer multiplier to input tokens, prompt caching
 * (when enabled and supported) and the async Batch API discount (when
 * enabled). Shared by the single-model and routed API calculations so both
 * stay consistent.
 */
function priceApiTokens(
  workload: WorkloadInputs,
  model: CommercialModel,
  rawInputTokens: number,
  outputTokens: number,
) {
  const inputTokens = Math.round(rawInputTokens * getTokenizerMultiplier(model));
  // Batch API discount applies to every token price, including cached reads.
  const priceMultiplier = workload.useBatchApi ? BATCH_API_PRICE_MULTIPLIER : 1;

  const canCache = workload.useCaching && !!model.cachedInputPricePerM;
  const cachedInputTokens = canCache
    ? Math.round(inputTokens * ASSUMED_CACHEABLE_INPUT_FRACTION)
    : 0;
  const uncachedInputTokens = inputTokens - cachedInputTokens;

  const inputCost = (uncachedInputTokens / 1_000_000) * model.inputPricePerM * priceMultiplier;
  const cachedInputCost = canCache
    ? (cachedInputTokens / 1_000_000) * (model.cachedInputPricePerM as number) * priceMultiplier
    : 0;
  const outputCost = (outputTokens / 1_000_000) * model.outputPricePerM * priceMultiplier;

  return {
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens,
    inputCost,
    cachedInputCost,
    outputCost,
    totalCost: inputCost + cachedInputCost + outputCost,
  };
}

export function calculateApiCost(
  workload: WorkloadInputs,
  model: CommercialModel,
): ApiCostBreakdown {
  const volume = getMonthlyTokenVolume(workload);
  const monthlyOutputTokens = volume.monthlyOutputTokens;
  const {
    inputTokens: monthlyInputTokens,
    cachedInputTokens,
    uncachedInputTokens,
    inputCost,
    cachedInputCost,
    outputCost,
    totalCost: totalMonthlyCost,
  } = priceApiTokens(workload, model, volume.monthlyInputTokens, monthlyOutputTokens);

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
  // When true, GPUs are only billed for the workload's active hours (plus a
  // daily spin-up buffer) instead of 24/7. Reserved pricing is ignored in
  // this mode, since committed-use discounts assume a 24/7 commitment.
  scaleDownOutsideActiveHours?: boolean;
}

export interface OwnedHostParams {
  kind: "owned";
  ownedGpu: OwnedGpuSpec;
  opsOverheadPct: number;
  depreciationYears: number;
}

export type HostParams = CloudHostParams | OwnedHostParams;

/** Hours per month the workload is actively running (activeHoursPerDay x activeDaysPerWeek x weeks/month). */
export function getActiveHoursPerMonth(capacity: CapacityProfile): number {
  return capacity.activeHoursPerDay * capacity.activeDaysPerWeek * WEEKS_PER_MONTH;
}

/**
 * Billed GPU-hours per month for cloud rental. Always-on (default) bills the
 * full month; scale-down bills active hours plus a 30-min/active-day
 * spin-up/model-load buffer, capped at the full month.
 */
export function getCloudBilledHoursPerMonth(capacity: CapacityProfile, scaleDown: boolean): number {
  if (!scaleDown) return HOURS_PER_MONTH;
  const spinUpHours =
    SCALE_DOWN_SPINUP_HOURS_PER_ACTIVE_DAY * capacity.activeDaysPerWeek * WEEKS_PER_MONTH;
  return Math.min(HOURS_PER_MONTH, getActiveHoursPerMonth(capacity) + spinUpHours);
}

/**
 * Whether the model's realistic (4-bit) weights, plus a 10% margin, would
 * leave little spare memory on one replica of the selected GPU type - i.e.
 * very little room for KV cache (long documents / concurrent requests).
 */
export function hasVramHeadroomWarning(model: OpenSourceModel, gpuType: GpuType): boolean {
  return model.vramInt4GB * 1.1 > GPU_VRAM_GB[gpuType] * model.minGpuCount;
}

/** Rough KV-cache bytes/token for a model, scaled off active params (MoE) or total params (dense). */
function approxKvCacheBytesPerToken(model: OpenSourceModel): number {
  const scaleParamsB = model.activeParamsB ?? model.paramsB;
  return scaleParamsB * KV_CACHE_MB_PER_TOKEN_PER_B_PARAMS * 1024 * 1024;
}

/**
 * Max concurrent sequences one replica's VRAM can hold, given spare memory
 * after model weights. This is frequently the REAL bottleneck for interactive
 * serving, not raw compute throughput - continuous batching (vLLM/TGI) is
 * often memory-bound rather than compute-bound.
 *
 * Uses the 4-bit weights footprint (vramInt4GB) regardless of configured
 * precision, consistent with hasVramHeadroomWarning().
 */
export function maxConcurrentSequencesFromVram(
  model: OpenSourceModel,
  gpuType: GpuType,
  minGpuCount: number,
  avgContextTokens: number = ASSUMED_AVG_CONTEXT_TOKENS_PER_CONCURRENT_USER,
): number {
  const totalVramGB = GPU_VRAM_GB[gpuType] * minGpuCount;
  const kvHeadroomBytes =
    Math.max(0, totalVramGB - model.vramInt4GB) * KV_CACHE_USABLE_VRAM_FRACTION * 1024 ** 3;
  const kvBytesPerSequence = approxKvCacheBytesPerToken(model) * avgContextTokens;
  return Math.max(1, Math.floor(kvHeadroomBytes / kvBytesPerSequence));
}

/**
 * Returns a copy of the workload representing a proportional share of it
 * (a smart-routing tier, or one compliance region): its own document count,
 * and the same share of peak concurrent users.
 */
export function withWorkloadShare(
  workload: WorkloadInputs,
  docsPerMonth: number,
  share: number,
): WorkloadInputs {
  return {
    ...workload,
    docsPerMonth,
    capacity: {
      ...workload.capacity,
      peakConcurrentUsers: workload.capacity.peakConcurrentUsers * share,
    },
  };
}

export function calculateSelfHostCost(
  workload: WorkloadInputs,
  model: OpenSourceModel,
  hostParams: HostParams,
): SelfHostCostBreakdown {
  const { monthlyInputTokens, monthlyOutputTokens } = getMonthlyTokenVolume(workload);
  const { capacity } = workload;
  const isInteractive = capacity.pattern === "interactive";

  // Monthly volume must be processed within the active window (not smeared
  // evenly over all 730 hours of the month).
  const activeHoursPerMonth = getActiveHoursPerMonth(capacity);
  const effectiveMonthlyTokens =
    monthlyOutputTokens + monthlyInputTokens * INPUT_TOKEN_COMPUTE_WEIGHT;
  const requiredThroughputTokPerSec = effectiveMonthlyTokens / (activeHoursPerMonth * 3600);

  const gpuType = hostParams.kind === "cloud" ? hostParams.gpuInstance.gpuType : hostParams.ownedGpu.gpuType;
  // throughputTokPerSecOnBaseline is measured on the model's OWN recommended
  // GPU setup (model.minGpuCount x model.minGpuType, i.e. one replica), not
  // always A100-80GB - normalize relative to that baseline before applying
  // the selected GPU's multiplier, otherwise models recommended on non-A100
  // hardware get double- or under-scaled. The result is the aggregate
  // throughput of ONE replica.
  const selectedMultiplier = GPU_THROUGHPUT_MULTIPLIER[gpuType] ?? 1;
  const baselineMultiplier = GPU_THROUGHPUT_MULTIPLIER[model.minGpuType] ?? 1;
  const gpuThroughputTokPerSec =
    model.throughputTokPerSecOnBaseline * (selectedMultiplier / baselineMultiplier);
  const plannedReplicaThroughput = gpuThroughputTokPerSec * UTILIZATION_TARGET;

  // Capacity scales in whole replicas (model.minGpuCount GPUs each) - you
  // can't add half a cluster to a model that needs 8 GPUs just to load.
  const replicasVolume = Math.ceil(requiredThroughputTokPerSec / plannedReplicaThroughput);
  const peakConcurrentUsers = isInteractive ? capacity.peakConcurrentUsers : 0;
  // Users one replica can serve is capped by BOTH raw compute (tok/s split
  // across users at the target per-user speed) AND spare VRAM for each
  // in-flight conversation's KV cache - whichever is tighter wins.
  let replicasConcurrency = 0;
  let tighterConcurrencyBound: SelfHostConcurrencyBound | undefined;
  if (isInteractive) {
    const throughputBoundConcurrency = Math.floor(
      plannedReplicaThroughput / capacity.targetTokPerSecPerUser,
    );
    const vramBoundConcurrency = maxConcurrentSequencesFromVram(model, gpuType, model.minGpuCount);
    const maxConcurrentPerReplica = Math.max(
      1,
      Math.min(throughputBoundConcurrency, vramBoundConcurrency),
    );
    replicasConcurrency = Math.ceil(peakConcurrentUsers / maxConcurrentPerReplica);
    tighterConcurrencyBound =
      vramBoundConcurrency < throughputBoundConcurrency ? "vram" : "throughput";
  }
  const replicas = Math.max(1, replicasVolume, replicasConcurrency);
  const gpusNeeded = replicas * model.minGpuCount;

  const limitingFactor: SelfHostLimitingFactor =
    replicas === 1
      ? "minimum-footprint"
      : replicasConcurrency > replicasVolume
        ? "concurrency"
        : "volume";
  const concurrencyBound = limitingFactor === "concurrency" ? tighterConcurrencyBound : undefined;

  const utilizationPct = Math.min(
    100,
    (requiredThroughputTokPerSec / (replicas * gpuThroughputTokPerSec)) * 100,
  );

  let computeCostMonthly = 0;
  let electricityCostMonthly = 0;
  let hardwareCostOneTimeUsd = 0;
  let billedHoursPerMonth: number;

  if (hostParams.kind === "cloud") {
    const scaleDown = !!hostParams.scaleDownOutsideActiveHours;
    // Reserved/committed-use pricing assumes 24/7 usage, so it can't be
    // combined with shutting GPUs down outside active hours.
    const useReserved = hostParams.useReservedPricing && !scaleDown;
    const rate = useReserved
      ? hostParams.gpuInstance.perGpuOnDemandPerHour * (1 - hostParams.gpuInstance.reservedDiscountPct)
      : hostParams.gpuInstance.perGpuOnDemandPerHour;
    billedHoursPerMonth = getCloudBilledHoursPerMonth(capacity, scaleDown);
    computeCostMonthly = gpusNeeded * rate * billedHoursPerMonth;
    // Electricity is already bundled into cloud on-demand/reserved pricing.
    electricityCostMonthly = 0;
  } else {
    const hardwareCostTotal =
      gpusNeeded * hostParams.ownedGpu.approxUnitCostUsd * OWN_SERVER_DEFAULTS.serverOverheadMultiplier;
    // The actual upfront check, kept separately from its amortized slice so
    // the UI can show capex vs. ongoing opex distinctly.
    hardwareCostOneTimeUsd = hardwareCostTotal;
    const monthlyDepreciation = hardwareCostTotal / (hostParams.depreciationYears * 12);
    computeCostMonthly = monthlyDepreciation;

    // Owned hardware is powered for the workload's active hours.
    billedHoursPerMonth = activeHoursPerMonth;
    const kw = (gpusNeeded * hostParams.ownedGpu.tdpWatts * OWN_SERVER_DEFAULTS.pue) / 1000;
    electricityCostMonthly = kw * billedHoursPerMonth * OWN_SERVER_DEFAULTS.electricityPricePerKwh;
  }

  const overheadCostMonthly =
    (computeCostMonthly + electricityCostMonthly) * hostParams.opsOverheadPct;

  const totalMonthlyCost = computeCostMonthly + electricityCostMonthly + overheadCostMonthly;
  // Cloud rental is fully recurring (no capex to strip out); owned hardware's
  // recurring burn excludes the amortized depreciation slice.
  const recurringMonthlyCostExclHardware =
    totalMonthlyCost - (hostParams.kind === "owned" ? computeCostMonthly : 0);

  return {
    modelId: model.id,
    requiredThroughputTokPerSec,
    gpuThroughputTokPerSec,
    replicas,
    gpusNeeded,
    limitingFactor,
    ...(concurrencyBound ? { concurrencyBound } : {}),
    servingPattern: capacity.pattern,
    peakConcurrentUsers,
    activeHoursPerMonth,
    billedHoursPerMonth,
    vramHeadroomWarning: hasVramHeadroomWarning(model, gpuType),
    utilizationPct,
    computeCostMonthly,
    electricityCostMonthly,
    overheadCostMonthly,
    totalMonthlyCost,
    hardwareCostOneTimeUsd,
    recurringMonthlyCostExclHardware,
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

  const costForCalls = (calls: number, model: CommercialModel) =>
    priceApiTokens(workload, model, calls * inputTokensPerCall, calls * outputTokensPerCall).totalCost;

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
 * Monthly cost estimate for an open-source model under a given, already
 * resolved hosting setup. Used for the open-source catalog card previews and
 * the routing-tier guardrails. Callers resolve hostParams from the user's
 * actual hosting settings (see hostParamsForModel in page.tsx) so these
 * previews match the rest of the app - e.g. the routing panel's baseline -
 * instead of assuming a fixed provider/pricing mode.
 */
export function estimateSelfHostMonthlyCost(
  workload: WorkloadInputs,
  model: OpenSourceModel,
  hostParams: HostParams,
): number {
  return calculateSelfHostCost(workload, model, hostParams).totalMonthlyCost;
}

/** Resolves the hosting setup to price a given open-source model under. */
export type ResolveHostParams = (model: OpenSourceModel) => HostParams;

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
 * Same structural guardrail as getModelsCheaperThan, but for self-hosted
 * open-source models: only a model that is genuinely cheaper to self-host
 * (on the hosting each model resolves to via resolveHostParams) than the
 * reference model is offered as a cheaper routing tier.
 */
export function getOpenSourceModelsCheaperThan(
  workload: WorkloadInputs,
  models: OpenSourceModel[],
  referenceModel: OpenSourceModel,
  resolveHostParams: ResolveHostParams,
): OpenSourceModel[] {
  const referenceCost = estimateSelfHostMonthlyCost(
    workload,
    referenceModel,
    resolveHostParams(referenceModel),
  );
  return models.filter(
    (m) =>
      m.id !== referenceModel.id &&
      estimateSelfHostMonthlyCost(workload, m, resolveHostParams(m)) < referenceCost,
  );
}

export interface SelfHostRoutingTier {
  model: OpenSourceModel;
  hostParams: HostParams;
}

/**
 * Self-hosted counterpart to calculateRoutedApiCost: a Laya-style self-hosted
 * router pre-classifies each request and sends a configurable share of
 * volume to a High-tier model/GPU setup, an optional Medium tier, and routes
 * the rest to a cheaper Low-tier model/GPU setup - reducing the number of
 * expensive GPUs you need to provision for the bulk of your traffic.
 */
export function calculateRoutedSelfHostCost(
  workload: WorkloadInputs,
  highTier: SelfHostRoutingTier,
  lowTier: SelfHostRoutingTier,
  router: RouterOption,
  escalationRatePct: number,
  mediumTier?: SelfHostRoutingTier | null,
  mediumRatePct = 0,
): RoutedSelfHostCostBreakdown {
  const totalDocs = workload.docsPerMonth;
  const highDocs = Math.round(totalDocs * escalationRatePct);
  const clampedMediumRatePct = mediumTier
    ? Math.max(0, Math.min(mediumRatePct, 1 - escalationRatePct))
    : 0;
  const mediumDocs = mediumTier ? Math.round(totalDocs * clampedMediumRatePct) : 0;
  const lowDocs = Math.max(0, totalDocs - highDocs - mediumDocs);
  // Each tier also serves the same proportional share of peak concurrent
  // users (simple proportional split, same as document volume).
  const lowSharePct = Math.max(0, 1 - escalationRatePct - clampedMediumRatePct);

  const tiers: SelfHostTierResult[] = [];

  tiers.push({
    tier: "high",
    modelId: highTier.model.id,
    docsPerMonth: highDocs,
    breakdown: calculateSelfHostCost(
      withWorkloadShare(workload, highDocs, escalationRatePct),
      highTier.model,
      highTier.hostParams,
    ),
  });

  if (mediumTier) {
    tiers.push({
      tier: "medium",
      modelId: mediumTier.model.id,
      docsPerMonth: mediumDocs,
      breakdown: calculateSelfHostCost(
        withWorkloadShare(workload, mediumDocs, clampedMediumRatePct),
        mediumTier.model,
        mediumTier.hostParams,
      ),
    });
  }

  tiers.push({
    tier: "low",
    modelId: lowTier.model.id,
    docsPerMonth: lowDocs,
    breakdown: calculateSelfHostCost(
      withWorkloadShare(workload, lowDocs, lowSharePct),
      lowTier.model,
      lowTier.hostParams,
    ),
  });

  const totalCalls = totalDocs * workload.callsPerDoc;
  const routerInputTokens = router.id === "none" ? 0 : totalCalls * ROUTER_TOKENS_PER_DECISION;
  const routerCost =
    router.id === "none"
      ? 0
      : (routerInputTokens / 1_000_000) * router.costPerMInputTokens + (router.selfHostMonthlyCost ?? 0);

  const tiersCost = tiers.reduce((sum, t) => sum + t.breakdown.totalMonthlyCost, 0);
  const totalMonthlyCost = tiersCost + routerCost;

  const baselineCost = calculateSelfHostCost(workload, highTier.model, highTier.hostParams).totalMonthlyCost;
  const savingsAmount = baselineCost - totalMonthlyCost;
  const savingsPct = baselineCost > 0 ? (savingsAmount / baselineCost) * 100 : 0;

  return {
    tiers,
    routerCost,
    totalMonthlyCost,
    costPerDocument: totalDocs > 0 ? totalMonthlyCost / totalDocs : 0,
    annualCost: totalMonthlyCost * 12,
    baselineCost,
    savingsAmount,
    savingsPct,
    totalGpusNeeded: tiers.reduce((sum, t) => sum + t.breakdown.gpusNeeded, 0),
  };
}

/**
 * Scales a per-region routed self-host breakdown by that region's GPU price
 * multiplier (each tier's compute/electricity/overhead scales; the router's
 * flat infra fee is charged per region as-is, matching how compliance
 * deployments provision independent infrastructure per region).
 */
export function scaleRoutedSelfHostBreakdown(
  breakdown: RoutedSelfHostCostBreakdown,
  multiplier: number,
  regionalDocsPerMonth: number,
): RoutedSelfHostCostBreakdown {
  const tiers = breakdown.tiers.map((t) => ({
    ...t,
    breakdown: scaleSelfHostBreakdown(t.breakdown, multiplier, t.docsPerMonth),
  }));
  const tiersCost = tiers.reduce((sum, t) => sum + t.breakdown.totalMonthlyCost, 0);
  const totalMonthlyCost = tiersCost + breakdown.routerCost;
  const baselineCost = breakdown.baselineCost * multiplier;
  const savingsAmount = baselineCost - totalMonthlyCost;

  return {
    tiers,
    routerCost: breakdown.routerCost,
    totalMonthlyCost,
    costPerDocument: regionalDocsPerMonth > 0 ? totalMonthlyCost / regionalDocsPerMonth : 0,
    annualCost: totalMonthlyCost * 12,
    baselineCost,
    savingsAmount,
    savingsPct: baselineCost > 0 ? (savingsAmount / baselineCost) * 100 : 0,
    totalGpusNeeded: tiers.reduce((sum, t) => sum + t.breakdown.gpusNeeded, 0),
  };
}

/** Combines per-region routed self-host breakdowns into one internally-consistent total. */
export function aggregateRoutedSelfHostBreakdowns(
  allocations: RegionAllocation<RoutedSelfHostCostBreakdown>[],
): RoutedSelfHostCostBreakdown {
  const totalDocs = totalDocsOf(allocations);
  const totalMonthlyCost = allocations.reduce((sum, a) => sum + a.breakdown.totalMonthlyCost, 0);
  const routerCost = allocations.reduce((sum, a) => sum + a.breakdown.routerCost, 0);
  const baselineCost = allocations.reduce((sum, a) => sum + a.breakdown.baselineCost, 0);
  const savingsAmount = baselineCost - totalMonthlyCost;

  return {
    tiers: allocations.flatMap((a) => a.breakdown.tiers),
    routerCost,
    totalMonthlyCost,
    costPerDocument: totalDocs > 0 ? totalMonthlyCost / totalDocs : 0,
    annualCost: totalMonthlyCost * 12,
    baselineCost,
    savingsAmount,
    savingsPct: baselineCost > 0 ? (savingsAmount / baselineCost) * 100 : 0,
    totalGpusNeeded: allocations.reduce((sum, a) => sum + a.breakdown.totalGpusNeeded, 0),
  };
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
  // Both new cost fields are linear in the same components, so they scale by
  // the same regional multiplier.
  const hardwareCostOneTimeUsd = breakdown.hardwareCostOneTimeUsd * multiplier;
  const recurringMonthlyCostExclHardware = breakdown.recurringMonthlyCostExclHardware * multiplier;

  return {
    ...breakdown,
    computeCostMonthly,
    electricityCostMonthly,
    overheadCostMonthly,
    totalMonthlyCost,
    hardwareCostOneTimeUsd,
    recurringMonthlyCostExclHardware,
    costPerDocument: regionalDocsPerMonth > 0 ? totalMonthlyCost / regionalDocsPerMonth : 0,
    annualCost: totalMonthlyCost * 12,
  };
}

/**
 * When several independently-sized deployments (e.g. regions) are combined,
 * report the most demand-driven reason any of them needed its replicas:
 * concurrency over volume over the bare minimum footprint.
 */
function combineLimitingFactors(factors: SelfHostLimitingFactor[]): SelfHostLimitingFactor {
  if (factors.includes("concurrency")) return "concurrency";
  if (factors.includes("volume")) return "volume";
  return "minimum-footprint";
}

/**
 * Across regions, GPU memory is reported as the concurrency bound if it
 * bound any concurrency-limited region (it changes what the user should do).
 */
function combineConcurrencyBounds(
  bounds: (SelfHostConcurrencyBound | undefined)[],
): SelfHostConcurrencyBound | undefined {
  if (bounds.includes("vram")) return "vram";
  if (bounds.includes("throughput")) return "throughput";
  return undefined;
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
  const hardwareCostOneTimeUsd = sum((b) => b.hardwareCostOneTimeUsd);
  const recurringMonthlyCostExclHardware = sum((b) => b.recurringMonthlyCostExclHardware);
  const limitingFactor = combineLimitingFactors(allocations.map((a) => a.breakdown.limitingFactor));
  const concurrencyBound =
    limitingFactor === "concurrency"
      ? combineConcurrencyBounds(allocations.map((a) => a.breakdown.concurrencyBound))
      : undefined;
  const requiredThroughputTokPerSec = sum((b) => b.requiredThroughputTokPerSec);
  // gpuThroughputTokPerSec is per replica, so total capacity is replicas x that.
  const totalCapacityTokPerSec = allocations.reduce(
    (acc, a) => acc + a.breakdown.replicas * a.breakdown.gpuThroughputTokPerSec,
    0,
  );
  const first = allocations[0]?.breakdown;

  return {
    modelId: first?.modelId ?? "",
    requiredThroughputTokPerSec,
    gpuThroughputTokPerSec: first?.gpuThroughputTokPerSec ?? 0,
    replicas: sum((b) => b.replicas),
    gpusNeeded: sum((b) => b.gpusNeeded),
    limitingFactor,
    ...(concurrencyBound ? { concurrencyBound } : {}),
    servingPattern: first?.servingPattern ?? "batch",
    peakConcurrentUsers: sum((b) => b.peakConcurrentUsers),
    activeHoursPerMonth: first?.activeHoursPerMonth ?? 0,
    billedHoursPerMonth: first?.billedHoursPerMonth ?? 0,
    vramHeadroomWarning: allocations.some((a) => a.breakdown.vramHeadroomWarning),
    utilizationPct:
      totalCapacityTokPerSec > 0
        ? Math.min(100, (requiredThroughputTokPerSec / totalCapacityTokPerSec) * 100)
        : 0,
    computeCostMonthly,
    electricityCostMonthly,
    overheadCostMonthly,
    totalMonthlyCost,
    hardwareCostOneTimeUsd,
    recurringMonthlyCostExclHardware,
    costPerDocument: totalDocs > 0 ? totalMonthlyCost / totalDocs : 0,
    annualCost: totalMonthlyCost * 12,
  };
}
