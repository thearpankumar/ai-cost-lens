import type { DocSizePreset, TaskPreset } from "@/lib/types";

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

// Prefill (reading input) is much faster than decode (generating output)
// on GPU hardware. This weights input tokens far lower than output tokens
// when estimating required serving throughput.
export const INPUT_TOKEN_COMPUTE_WEIGHT = 0.1;
