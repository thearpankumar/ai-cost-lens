import type { RouterOption } from "@/lib/types";

// "Router" here means a lightweight decision-making layer that sits in front
// of your main model call: it classifies each request and either handles it
// directly, sends it to a cheap model, or escalates to your chosen
// higher-end model when the request looks complex/uncertain.
//
// Jev (TypeSafe) - hosted decision model, priced per input token, accessed
// via OpenRouter. Laya - open-source/self-hosted equivalent with
// near-zero marginal cost once deployed. Verified: 2026-09-28.
export const ROUTING_LAST_VERIFIED = "2026-09-28";

// Estimated input tokens consumed by a single routing decision (the typed
// "which option applies" prompt built from available tools/outputs). Jev/Laya
// return a typed decision in one fast pass, not free text, so there's no
// meaningful output-token cost and the input itself is much lighter than a
// normal chat turn - no vendor publishes a per-decision figure, so this is a
// documented planning assumption, not a measured value.
export const ROUTER_TOKENS_PER_DECISION = 150;

export const ROUTER_OPTIONS: RouterOption[] = [
  {
    id: "none",
    name: "No routing",
    vendor: "-",
    isSelfHosted: false,
    costPerMInputTokens: 0,
    selfHostMonthlyCost: 0,
    blurb: "Every request goes straight to your selected model.",
  },
  {
    id: "jev",
    name: "Jev (pinned model)",
    vendor: "TypeSafe",
    isSelfHosted: false,
    costPerMInputTokens: 0.042,
    blurb:
      "Hosted decision model (typesafe/jev-1.13 via OpenRouter). Pay per routing decision, no infrastructure to run. TypeSafe's auto-routed \"jev-router\" SKU is currently free as a promotional price; this uses the stable pinned-model rate instead.",
  },
  {
    id: "laya",
    name: "Laya",
    vendor: "Open source (Apache 2.0)",
    isSelfHosted: true,
    costPerMInputTokens: 0,
    selfHostMonthlyCost: 60,
    blurb: "Self-hosted, open-weight alternative to Jev. Free per-decision cost; runs on a small CPU instance (~$45-85/mo).",
  },
];

// Default share of requests assumed complex enough to need the full model,
// editable by the user.
export const DEFAULT_ESCALATION_RATE_PCT = 0.25;
