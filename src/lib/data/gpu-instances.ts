import type { GpuInstance, OwnedGpuSpec } from "@/lib/types";

// Cloud GPU on-demand pricing, US regions. Verified: 2026-09-28.
// perGpuOnDemandPerHour normalizes multi-GPU instances to a per-card rate
// so the calculator can size "N GPUs worth" of capacity independent of
// real-world instance bin-packing.
export const GPU_PRICING_LAST_VERIFIED = "2026-09-28";

export const GPU_INSTANCES: GpuInstance[] = [
  // AWS
  {
    id: "aws-g6-xlarge",
    cloud: "AWS",
    gpuType: "L4",
    gpuCountPerInstance: 1,
    instanceName: "g6.xlarge",
    vcpu: 4,
    ramGB: 16,
    onDemandPerHour: 0.8048,
    perGpuOnDemandPerHour: 0.8048,
    reservedDiscountPct: 0.35,
  },
  {
    id: "aws-g5-xlarge",
    cloud: "AWS",
    gpuType: "A10G",
    gpuCountPerInstance: 1,
    instanceName: "g5.xlarge",
    vcpu: 4,
    ramGB: 16,
    onDemandPerHour: 1.006,
    perGpuOnDemandPerHour: 1.006,
    reservedDiscountPct: 0.35,
  },
  {
    id: "aws-p4d-24xlarge",
    cloud: "AWS",
    gpuType: "A100-40GB",
    gpuCountPerInstance: 8,
    instanceName: "p4d.24xlarge",
    vcpu: 96,
    ramGB: 1152,
    onDemandPerHour: 21.9576,
    perGpuOnDemandPerHour: 2.7447,
    reservedDiscountPct: 0.55,
  },
  {
    id: "aws-p5-48xlarge",
    cloud: "AWS",
    gpuType: "H100-80GB",
    gpuCountPerInstance: 8,
    instanceName: "p5.48xlarge",
    vcpu: 192,
    ramGB: 2048,
    onDemandPerHour: 98.32,
    perGpuOnDemandPerHour: 12.29,
    reservedDiscountPct: 0.4,
  },
  // Azure
  {
    id: "azure-nc24ads-a100-v4",
    cloud: "Azure",
    gpuType: "A100-80GB",
    gpuCountPerInstance: 1,
    instanceName: "NC24ads_A100_v4",
    vcpu: 24,
    ramGB: 220,
    onDemandPerHour: 3.673,
    perGpuOnDemandPerHour: 3.673,
    reservedDiscountPct: 0.35,
  },
  {
    id: "azure-nc96ads-a100-v4",
    cloud: "Azure",
    gpuType: "A100-80GB",
    gpuCountPerInstance: 4,
    instanceName: "NC96ads_A100_v4",
    vcpu: 96,
    ramGB: 880,
    onDemandPerHour: 14.692,
    perGpuOnDemandPerHour: 3.673,
    reservedDiscountPct: 0.35,
  },
  {
    id: "azure-nc40adsh100-v5",
    cloud: "Azure",
    gpuType: "H100-80GB",
    gpuCountPerInstance: 1,
    instanceName: "NC40adsH100_v5",
    vcpu: 40,
    ramGB: 320,
    onDemandPerHour: 6.98,
    perGpuOnDemandPerHour: 6.98,
    reservedDiscountPct: 0.35,
  },
  {
    id: "azure-nd-h100-v5",
    cloud: "Azure",
    gpuType: "H100-80GB",
    gpuCountPerInstance: 8,
    instanceName: "ND H100 v5",
    vcpu: 96,
    ramGB: 1900,
    onDemandPerHour: 98.32,
    perGpuOnDemandPerHour: 12.29,
    reservedDiscountPct: 0.4,
  },
  // GCP
  {
    id: "gcp-g2-standard-4",
    cloud: "GCP",
    gpuType: "L4",
    gpuCountPerInstance: 1,
    instanceName: "g2-standard-4",
    vcpu: 4,
    ramGB: 16,
    onDemandPerHour: 0.7,
    perGpuOnDemandPerHour: 0.7,
    reservedDiscountPct: 0.37,
  },
  {
    id: "gcp-a2-highgpu-1g",
    cloud: "GCP",
    gpuType: "A100-40GB",
    gpuCountPerInstance: 1,
    instanceName: "a2-highgpu-1g",
    vcpu: 12,
    ramGB: 85,
    onDemandPerHour: 3.6734,
    perGpuOnDemandPerHour: 3.6734,
    reservedDiscountPct: 0.37,
  },
  {
    id: "gcp-a3-highgpu-8g",
    cloud: "GCP",
    gpuType: "H100-80GB",
    gpuCountPerInstance: 8,
    instanceName: "a3-highgpu-8g",
    vcpu: 208,
    ramGB: 1872,
    onDemandPerHour: 87.83,
    perGpuOnDemandPerHour: 10.98,
    reservedDiscountPct: 0.4,
  },
];

// Approximate owned-hardware costs for the "Own Server" self-host mode.
// Street/OEM prices vary widely by vendor and region - treat as an estimate.
export const OWNED_GPU_SPECS: OwnedGpuSpec[] = [
  { gpuType: "L4", approxUnitCostUsd: 3000, tdpWatts: 72 },
  { gpuType: "A10G", approxUnitCostUsd: 3800, tdpWatts: 150 },
  { gpuType: "A100-40GB", approxUnitCostUsd: 12000, tdpWatts: 300 },
  { gpuType: "A100-80GB", approxUnitCostUsd: 17000, tdpWatts: 400 },
  { gpuType: "H100-80GB", approxUnitCostUsd: 28000, tdpWatts: 700 },
];

// Reference-only figures used in the "Own Server" calculation.
export const OWN_SERVER_DEFAULTS = {
  serverOverheadMultiplier: 1.4, // chassis, CPU, RAM, storage, networking on top of raw GPU cost
  depreciationYears: 3,
  pue: 1.4, // power usage effectiveness (cooling/facility overhead)
  electricityPricePerKwh: 0.14, // US commercial average
  defaultOpsOverheadPct: 0.3, // DevOps/MLOps/security overhead as % of hardware+power
};

export const CLOUD_OPS_OVERHEAD_DEFAULT_PCT = 0.25;
