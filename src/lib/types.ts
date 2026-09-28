// Shared domain types for the AI cost calculator

export type Provider =
  | "Anthropic"
  | "OpenAI"
  | "Google"
  | "Amazon"
  | "Mistral"
  | "xAI"
  | "Cohere";

export type ModelTier = "budget" | "balanced" | "flagship" | "frontier";

export type SpeedTier = "fast" | "medium" | "slow";

export interface CommercialModel {
  id: string; // OpenRouter-style id, e.g. "anthropic/claude-sonnet-5"
  name: string;
  provider: Provider;
  inputPricePerM: number; // USD per 1M input tokens (static fallback)
  outputPricePerM: number; // USD per 1M output tokens (static fallback)
  cachedInputPricePerM?: number; // USD per 1M cached input tokens
  contextWindow: number; // tokens
  intelligenceScore: number; // 0-100, relative capability index
  speedTier: SpeedTier;
  tier: ModelTier;
  goodFor: string[]; // task tags this model suits well
  blurb: string; // one-line, plain-English description for business users
  // Tokens this model's tokenizer produces relative to the ~700 tokens/page
  // baseline in TOKENS_PER_PAGE. Treated as 1 when absent.
  tokenizerMultiplier?: number;
}

export type OpenSourceTier = "efficient" | "balanced" | "frontier" | "enterprise-cluster";

export interface OpenSourceModel {
  id: string;
  name: string;
  family: string;
  paramsB: number; // total parameters, billions
  activeParamsB?: number; // active params for MoE models
  vramFp16GB: number; // VRAM needed at fp16/bf16
  vramInt4GB: number; // VRAM needed at 4-bit quantization
  recommendedGpuLabel: string; // human label, e.g. "1x A100 80GB"
  minGpuType: GpuType; // baseline GPU type this model targets
  minGpuCount: number; // number of that GPU type needed
  intelligenceScore: number; // 0-100
  throughputTokPerSecOnBaseline: number; // aggregate tok/s on the recommended GPU setup
  tier: OpenSourceTier;
  license: string;
  goodFor: string[];
  blurb: string;
}

export type GpuType = "L4" | "A10G" | "A100-40GB" | "A100-80GB" | "H100-80GB";

export type CloudProvider = "AWS" | "Azure" | "GCP";

export interface GpuInstance {
  id: string;
  cloud: CloudProvider;
  gpuType: GpuType;
  gpuCountPerInstance: number;
  instanceName: string;
  vcpu: number;
  ramGB: number;
  onDemandPerHour: number; // total instance price
  perGpuOnDemandPerHour: number; // normalized per-GPU price
  reservedDiscountPct: number; // approx 1yr committed-use discount, 0-1
}

export interface OwnedGpuSpec {
  gpuType: GpuType;
  approxUnitCostUsd: number; // street price per card
  tdpWatts: number; // thermal design power, per card
}

export type TaskType =
  | "extraction"
  | "classification"
  | "summarization"
  | "qa"
  | "rewrite";

export interface TaskPreset {
  id: TaskType;
  label: string;
  description: string;
  outputRatio: number; // output tokens as fraction of doc size
  promptOverheadTokens: number; // fixed instruction/system-prompt tokens per call
  minOutputTokens: number; // floor for output size
}

export interface DocSizePreset {
  id: string;
  label: string;
  pages: number;
  description: string;
}

export type CalcMode = "api" | "self-host";
export type HostingLocation = "cloud" | "owned";

// How the self-hosted deployment is used over time.
// - "batch": a pipeline that works through the monthly document volume
//   within an operating window (e.g. business hours).
// - "interactive": live users (e.g. an internal assistant) where peak
//   concurrent demand, not average monthly volume, sets the capacity needed.
export type ServingPattern = "batch" | "interactive";

export interface CapacityProfile {
  pattern: ServingPattern;
  activeHoursPerDay: number; // 1-24
  activeDaysPerWeek: number; // 1-7
  peakConcurrentUsers: number; // interactive only
  targetTokPerSecPerUser: number; // interactive only (8 reading speed / 20 comfortable / 40 snappy)
}

export interface WorkloadInputs {
  docsPerMonth: number;
  docSizePresetId: string;
  customPages: number;
  taskType: TaskType;
  callsPerDoc: number;
  useCaching: boolean;
  // Async Batch API pricing (~50% off, results within 24h) for commercial APIs.
  useBatchApi: boolean;
  capacity: CapacityProfile;
}

export interface ApiCostBreakdown {
  modelId: string;
  monthlyInputTokens: number;
  monthlyOutputTokens: number;
  cachedInputTokens: number;
  uncachedInputTokens: number;
  inputCost: number;
  cachedInputCost: number;
  outputCost: number;
  totalMonthlyCost: number;
  costPerDocument: number;
  annualCost: number;
}

// Which bound produced the final replica count.
export type SelfHostLimitingFactor = "minimum-footprint" | "volume" | "concurrency";

// For concurrency-limited interactive deployments: whether raw compute
// throughput or GPU memory (KV cache for in-flight conversations) capped how
// many users one replica can serve.
export type SelfHostConcurrencyBound = "throughput" | "vram";

export interface SelfHostCostBreakdown {
  modelId: string;
  // Whether this deployment rents cloud GPUs or runs on owned hardware.
  // Regional GPU-rental price multipliers only apply to cloud rental.
  hostingKind: "cloud" | "owned";
  requiredThroughputTokPerSec: number; // during active hours
  gpuThroughputTokPerSec: number; // aggregate throughput of ONE replica (model.minGpuCount GPUs)
  replicas: number; // independent copies of the model being served
  gpusNeeded: number; // replicas * model.minGpuCount
  limitingFactor: SelfHostLimitingFactor;
  // Set only when limitingFactor === "concurrency" (interactive pattern):
  // which per-replica bound was tighter. Omitted for batch / volume-bound.
  concurrencyBound?: SelfHostConcurrencyBound;
  servingPattern: ServingPattern;
  peakConcurrentUsers: number; // concurrency this deployment was sized for (0 for batch)
  activeHoursPerMonth: number;
  billedHoursPerMonth: number; // hours of GPU time paid for (cloud) / powered (owned)
  vramHeadroomWarning: boolean;
  utilizationPct: number; // average load during active hours
  computeCostMonthly: number; // GPU rental or amortized hardware
  electricityCostMonthly: number; // 0 for cloud rental
  overheadCostMonthly: number; // ops/maintenance
  // Apples-to-apples monthly figure (owned hardware amortized straight-line),
  // comparable against cloud rental and API pricing.
  totalMonthlyCost: number;
  // Owned hardware only: the raw, un-amortized upfront purchase (GPUs plus
  // server overhead). 0 for cloud rental, which has no capex.
  hardwareCostOneTimeUsd: number;
  // What genuinely recurs every month once any hardware is paid for:
  // totalMonthlyCost minus the amortized hardware slice for owned hardware;
  // equal to totalMonthlyCost for cloud rental.
  recurringMonthlyCostExclHardware: number;
  costPerDocument: number;
  annualCost: number;
}

// --- Smart model routing (Jev / Laya style pre-classification) ---

export type RouterChoice = "none" | "jev" | "laya";

export interface RouterOption {
  id: RouterChoice;
  name: string;
  vendor: string;
  isSelfHosted: boolean;
  costPerMInputTokens: number; // USD per 1M routing-decision input tokens
  selfHostMonthlyCost?: number; // flat estimated infra cost if self-hosted
  blurb: string;
}

export interface RoutingConfig {
  enabled: boolean;
  router: RouterChoice;
  escalationRatePct: number; // 0-1, share of requests sent to the "High" (hard) model
  smallModelId: string; // "Low" tier - always active
  mediumModelId: string | null; // "Medium" tier - optional, null disables it (2-tier mode)
  mediumRatePct: number; // 0-1, share of requests sent to the "Medium" model (0 when disabled)
}

export interface RoutedApiCostBreakdown {
  totalCalls: number;
  escalatedCalls: number; // calls sent to the High tier
  mediumCalls: number; // calls sent to the Medium tier (0 if disabled)
  routedCalls: number; // calls sent to the Low tier
  routerCost: number;
  routerInputTokens: number;
  bigModelCost: number; // High tier cost
  mediumModelCost: number; // Medium tier cost (0 if disabled)
  smallModelCost: number; // Low tier cost
  totalMonthlyCost: number;
  costPerDocument: number;
  annualCost: number;
  baselineCost: number; // cost if 100% of requests used the High (big) model
  savingsAmount: number;
  savingsPct: number;
}

export interface SelfHostTierResult {
  tier: "low" | "medium" | "high";
  modelId: string;
  docsPerMonth: number;
  breakdown: SelfHostCostBreakdown;
}

export interface RoutedSelfHostCostBreakdown {
  tiers: SelfHostTierResult[]; // active tiers only (medium omitted when disabled)
  routerCost: number;
  totalMonthlyCost: number;
  costPerDocument: number;
  annualCost: number;
  baselineCost: number; // cost if 100% of volume used the High-tier model/hosting alone
  savingsAmount: number;
  savingsPct: number;
  totalGpusNeeded: number;
}

// --- Multi-region compliance deployments ---

export type RegionId = "us" | "eu" | "apac" | "australia";

export interface RegionInfo {
  id: RegionId;
  label: string;
  exampleLocations: string;
  gpuPriceMultiplier: number; // relative to US baseline, for cloud GPU rental only (not owned hardware)
  blurb: string;
}

export interface RegionAllocation<TBreakdown> {
  regionId: RegionId;
  docsPerMonth: number;
  breakdown: TBreakdown;
}
