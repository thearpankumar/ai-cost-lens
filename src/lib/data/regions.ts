import type { RegionInfo } from "@/lib/types";

// Standard macro-region groupings used for compliance/data-residency
// deployments. GPU price multipliers are Azure-sourced (the clearest
// published regional GPU pricing pattern found) and applied as a
// representative estimate across clouds, since AWS/GCP don't publish
// clean per-region multipliers - GCP in particular appears to price GPUs
// close to uniformly across regions. Verified: 2026-09-28.
export const REGION_PRICING_LAST_VERIFIED = "2026-09-28";

export const REGIONS: RegionInfo[] = [
  {
    id: "us",
    label: "United States",
    exampleLocations: "AWS us-east-1 · Azure East US · GCP us-central1",
    gpuPriceMultiplier: 1.0,
    blurb: "Baseline region, used as the reference price for GPU rental.",
  },
  {
    id: "eu",
    label: "European Union",
    exampleLocations: "AWS eu-west-1/eu-central-1 · Azure West Europe · GCP europe-west1/3",
    gpuPriceMultiplier: 1.19,
    blurb: "GDPR-aligned hosting. GPU rental runs ~19% above US pricing.",
  },
  {
    id: "apac",
    label: "Asia Pacific",
    exampleLocations: "AWS ap-southeast-1 · Azure Southeast Asia · GCP asia-southeast1",
    gpuPriceMultiplier: 1.3,
    blurb: "GPU rental runs ~30% above US pricing.",
  },
  {
    id: "australia",
    label: "Australia",
    exampleLocations: "AWS ap-southeast-2 · Azure Australia East · GCP australia-southeast1",
    gpuPriceMultiplier: 1.33,
    blurb: "GPU rental runs ~33% above US pricing.",
  },
];

// Confirmed premium for routing API calls through an enterprise
// data-residency deployment (e.g. Azure OpenAI Data Zone, OpenAI's own
// Australia residency region) instead of the provider's global endpoint.
export const DATA_RESIDENCY_PREMIUM_PCT = 0.1;
