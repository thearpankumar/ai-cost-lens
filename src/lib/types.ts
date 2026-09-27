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

export interface WorkloadInputs {
  docsPerMonth: number;
  docSizePresetId: string;
  customPages: number;
  taskType: TaskType;
  callsPerDoc: number;
  useCaching: boolean;
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

export interface SelfHostCostBreakdown {
  modelId: string;
  requiredThroughputTokPerSec: number;
  gpuThroughputTokPerSec: number;
  gpusNeeded: number;
  utilizationPct: number;
  computeCostMonthly: number; // GPU rental or amortized hardware
  electricityCostMonthly: number; // 0 for cloud rental
  overheadCostMonthly: number; // ops/maintenance
  totalMonthlyCost: number;
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

// --- Multi-region compliance deployments ---

export type RegionId = "us" | "eu" | "apac" | "australia";

export interface RegionInfo {
  id: RegionId;
  label: string;
  exampleLocations: string;
  gpuPriceMultiplier: number; // relative to US baseline, for self-hosted GPU rental
  blurb: string;
}

export interface RegionAllocation<TBreakdown> {
  regionId: RegionId;
  docsPerMonth: number;
  breakdown: TBreakdown;
}
