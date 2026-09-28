import type { CapacityProfile, DocSizePreset, TaskPreset } from "@/lib/types";

// Rule-of-thumb conversion: ~500 words per page, ~1.35 tokens per word
// for typical English business/legal prose.
export const TOKENS_PER_PAGE = 700;

export const DOC_SIZE_PRESETS: DocSizePreset[] = [
  { id: "short", label: "Short", pages: 2, description: "~2 pages (e.g. a short invoice or memo)" },
  { id: "medium", label: "Medium", pages: 8, description: "~8 pages (e.g. a standard contract)" },
  { id: "long", label: "Long", pages: 25, description: "~25 pages (e.g. a full agreement or report)" },
  { id: "custom", label: "Custom", pages: 8, description: "Set an exact page count" },
];

export const TASK_PRESETS: TaskPreset[] = [
  {
    id: "extraction",
    label: "Data extraction",
    description: "Pull structured fields out of a document (names, dates, amounts, clauses)",
    outputRatio: 0.12,
    promptOverheadTokens: 350,
    minOutputTokens: 80,
  },
  {
    id: "classification",
    label: "Classification / tagging",
    description: "Sort or label documents (e.g. contract type, risk level, department)",
    outputRatio: 0.03,
    promptOverheadTokens: 300,
    minOutputTokens: 40,
  },
  {
    id: "summarization",
    label: "Summarization",
    description: "Produce a condensed summary of each document",
    outputRatio: 0.25,
    promptOverheadTokens: 300,
    minOutputTokens: 150,
  },
  {
    id: "qa",
    label: "Question answering",
    description: "Ask specific questions against each document",
    outputRatio: 0.08,
    promptOverheadTokens: 400,
    minOutputTokens: 100,
  },
  {
    id: "rewrite",
    label: "Rewrite / translation",
    description: "Rewrite, standardize, or translate the full document",
    outputRatio: 1.0,
    promptOverheadTokens: 300,
    minOutputTokens: 200,
  },
];

// When "prompt caching" is enabled, this fraction of input tokens
// (repeated system instructions/templates/few-shot examples) is assumed
// to hit the cached-input rate instead of the full input rate.
export const ASSUMED_CACHEABLE_INPUT_FRACTION = 0.3;

export const HOURS_PER_MONTH = 730;
export const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600;

// Average weeks per calendar month (365 / 7 / 12 ≈ 4.345).
export const WEEKS_PER_MONTH = 365 / 7 / 12;

// Planning headroom: size self-hosted capacity so it runs at no more than
// 80% of rated throughput during active hours, rather than a fragile 100%.
export const UTILIZATION_TARGET = 0.8;

// Default self-hosted usage pattern: a batch pipeline running during
// business hours (10h/day, 5 days/week). The interactive-only fields are
// used only when pattern === "interactive".
export const DEFAULT_CAPACITY_PROFILE: CapacityProfile = {
  pattern: "batch",
  activeHoursPerDay: 10,
  activeDaysPerWeek: 5,
  peakConcurrentUsers: 25,
  targetTokPerSecPerUser: 20,
};

// Per-user generation speed presets for the "Live users" pattern.
export const TOK_PER_SEC_PER_USER_PRESETS = [
  { value: 8, label: "Reading speed" },
  { value: 20, label: "Comfortable" },
  { value: 40, label: "Snappy" },
] as const;

// Share of a self-hosted GPU "compute unit" consumed by one INPUT token,
// relative to one OUTPUT token, when estimating required serving throughput.
// Prefill is cheaper per token than decode, but for the long-input document
// workloads this app models it is far from free: NVIDIA NIM benchmark tables
// (throughput at varying input/output lengths) put the effective input-token
// cost at roughly 0.4-0.5x an output token, not the 0.1x previously assumed.
export const INPUT_TOKEN_COMPUTE_WEIGHT = 0.45;

// Discount applied to both input and output token prices when async Batch
// API pricing is used (OpenAI Batch API, Anthropic Message Batches, Bedrock
// batch inference are all documented at ~50% off, results within 24h).
export const BATCH_API_PRICE_MULTIPLIER = 0.5;

// Cloud scale-down mode: extra billed time per active day for spinning
// instances up and loading model weights (30 min/active day).
export const SCALE_DOWN_SPINUP_HOURS_PER_ACTIVE_DAY = 0.5;

// Rough order-of-magnitude KV-cache size per token, per billion (active)
// params, fp16 KV cache. Calibrated directly to the published Llama-3.1 70B
// figure (~0.3MB/token / 70B =~ 0.0043) rather than averaged with the much
// smaller Llama-3 8B figure (~0.1MB/token / 8B =~ 0.0125), because this
// catalog's "live users" / interactive scenarios are dominated by 20B-120B
// models - a constant tuned to the 8B end would understate KV-cache pressure
// for exactly the model sizes this warning matters most for. This is a
// coarse approximation either way - actual KV-cache size depends on
// num_layers/num_kv_heads/head_dim, not just param count, and can vary 2-3x
// by architecture family - so it understates the true figure for small
// (7-14B) models, which mostly appear here in high-volume batch/extraction
// roles rather than concurrency-heavy interactive ones.
export const KV_CACHE_MB_PER_TOKEN_PER_B_PARAMS = 0.0043;

// Fraction of post-weights VRAM headroom assumed usable for KV-cache blocks
// (the rest covers activations, CUDA context, and framework overhead).
export const KV_CACHE_USABLE_VRAM_FRACTION = 0.85;

// Default assumed context length per concurrent interactive session, for
// capacity planning purposes (this app doesn't collect a per-workload average
// context length input). Chosen as a mid-range interactive/chat assumption.
export const ASSUMED_AVG_CONTEXT_TOKENS_PER_CONCURRENT_USER = 4096;
