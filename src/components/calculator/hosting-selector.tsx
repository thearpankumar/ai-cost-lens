"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GPU_INSTANCES, OWNED_GPU_SPECS } from "@/lib/data/gpu-instances";
import { cn } from "@/lib/utils";
import { formatUsd } from "@/lib/format";
import type { CloudProvider, GpuType, HostingLocation, OpenSourceModel } from "@/lib/types";
import { Info } from "lucide-react";

export interface SelfHostConfig {
  location: HostingLocation;
  cloudProvider: CloudProvider;
  gpuInstanceId: string;
  useReservedPricing: boolean;
  ownedGpuType: GpuType;
  hoursPerDay: number;
  depreciationYears: number;
  opsOverheadPct: number;
}

const CLOUDS: CloudProvider[] = ["AWS", "Azure", "GCP"];

interface HostingSelectorProps {
  config: SelfHostConfig;
  onChange: (next: SelfHostConfig) => void;
  model: OpenSourceModel;
}

export function HostingSelector({ config, onChange, model }: HostingSelectorProps) {
  const cloudInstances = GPU_INSTANCES.filter((i) => i.cloud === config.cloudProvider);
  const currentGpuType = GPU_INSTANCES.find((i) => i.id === config.gpuInstanceId)?.gpuType;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where will it run?</CardTitle>
        <CardDescription>
          Choose a cloud GPU rental or your own server hardware. {model.name} recommends{" "}
          <span className="font-medium text-foreground">{model.recommendedGpuLabel}</span> minimum.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ToggleGroup
          type="single"
          value={config.location}
          onValueChange={(v) => v && onChange({ ...config, location: v as HostingLocation })}
          className="w-full"
        >
          <ToggleGroupItem value="cloud" className="flex-1">
            Cloud rental (AWS / Azure / GCP)
          </ToggleGroupItem>
          <ToggleGroupItem value="owned" className="flex-1">
            Own server (on-prem / colo)
          </ToggleGroupItem>
        </ToggleGroup>

        {config.location === "cloud" ? (
          <div className="space-y-4">
            <ToggleGroup
              type="single"
              value={config.cloudProvider}
              onValueChange={(v) => {
                if (!v) return;
                // Preserve the currently selected GPU type when switching cloud,
                // so comparing clouds doesn't silently swap the hardware tier too.
                const sameType = GPU_INSTANCES.find(
                  (i) => i.cloud === v && i.gpuType === currentGpuType,
                );
                const fallback = GPU_INSTANCES.find((i) => i.cloud === v);
                onChange({
                  ...config,
                  cloudProvider: v as CloudProvider,
                  gpuInstanceId: sameType?.id ?? fallback?.id ?? config.gpuInstanceId,
                });
              }}
            >
              {CLOUDS.map((c) => (
                <ToggleGroupItem key={c} value={c} className="px-4">
                  {c}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {cloudInstances.map((instance) => {
                const selected = instance.id === config.gpuInstanceId;
                const isRecommended = instance.gpuType === model.minGpuType;
                return (
                  <button
                    key={instance.id}
                    type="button"
                    onClick={() => onChange({ ...config, gpuInstanceId: instance.id })}
                    className={cn(
                      "text-left rounded-lg border p-3 transition-colors hover:border-primary/50",
                      selected && "border-primary ring-1 ring-primary",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{instance.gpuType}</span>
                      {isRecommended && (
                        <span className="text-[10px] font-medium text-primary">
                          recommended
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{instance.instanceName}</p>
                    <p className="text-sm tabular-nums mt-1">
                      {formatUsd(instance.perGpuOnDemandPerHour, { decimals: 2 })}/hr per GPU
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <Label htmlFor="reserved" className="text-sm">
                  Use committed-use / reserved pricing
                </Label>
                <p className="text-xs text-muted-foreground">
                  Approx. discount for a 1-year commitment instead of on-demand rates.
                </p>
              </div>
              <Switch
                id="reserved"
                checked={config.useReservedPricing}
                onCheckedChange={(checked) => onChange({ ...config, useReservedPricing: checked })}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {OWNED_GPU_SPECS.map((spec) => {
                const selected = spec.gpuType === config.ownedGpuType;
                const isRecommended = spec.gpuType === model.minGpuType;
                return (
                  <button
                    key={spec.gpuType}
                    type="button"
                    onClick={() => onChange({ ...config, ownedGpuType: spec.gpuType })}
                    className={cn(
                      "text-left rounded-lg border p-3 transition-colors hover:border-primary/50",
                      selected && "border-primary ring-1 ring-primary",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{spec.gpuType}</span>
                      {isRecommended && (
                        <span className="text-[10px] font-medium text-primary">
                          recommended
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      ~{formatUsd(spec.approxUnitCostUsd, { decimals: 0 })}/card
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="space-y-2">
              <Label>Hours running per day</Label>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Slider
                  aria-label="Hours running per day"
                  min={1}
                  max={24}
                  step={1}
                  value={[config.hoursPerDay]}
                  onValueChange={([v]) => onChange({ ...config, hoursPerDay: v })}
                  className="max-w-xs min-w-[120px] flex-1"
                />
                <span className="text-sm tabular-nums text-muted-foreground w-24 shrink-0 whitespace-nowrap">
                  {config.hoursPerDay}h/day
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                Hardware depreciation period
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Spreads the one-time hardware purchase cost across this many years.</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Slider
                  aria-label="Hardware depreciation period, years"
                  min={1}
                  max={5}
                  step={1}
                  value={[config.depreciationYears]}
                  onValueChange={([v]) => onChange({ ...config, depreciationYears: v })}
                  className="max-w-xs min-w-[120px] flex-1"
                />
                <span className="text-sm tabular-nums text-muted-foreground w-16 shrink-0 whitespace-nowrap">
                  {config.depreciationYears} yr
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            Ops &amp; maintenance overhead
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                <p>
                  Covers engineering time to deploy, monitor, patch and support the
                  self-hosted model - typically 15-30% of infrastructure spend.
                  {config.location === "cloud"
                    ? " Electricity is already included in the cloud rental rate."
                    : ""}
                </p>
              </TooltipContent>
            </Tooltip>
          </Label>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Slider
              aria-label="Ops and maintenance overhead percentage"
              min={0}
              max={40}
              step={5}
              value={[Math.round(config.opsOverheadPct * 100)]}
              onValueChange={([v]) => onChange({ ...config, opsOverheadPct: v / 100 })}
              className="max-w-xs min-w-[120px] flex-1"
            />
            <span className="text-sm tabular-nums text-muted-foreground w-12 shrink-0 whitespace-nowrap">
              {Math.round(config.opsOverheadPct * 100)}%
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
