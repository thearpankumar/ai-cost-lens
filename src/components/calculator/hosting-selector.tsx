"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GPU_INSTANCES, OWNED_GPU_SPECS } from "@/lib/data/gpu-instances";
import { cn } from "@/lib/utils";
import { formatNumber, formatUsd } from "@/lib/format";
import type { CloudProvider, GpuType, HostingLocation, OpenSourceModel } from "@/lib/types";
import { Info } from "lucide-react";

export interface SelfHostConfig {
  location: HostingLocation;
  cloudProvider: CloudProvider;
  gpuInstanceId: string;
  useReservedPricing: boolean;
  // Cloud only: stop GPUs outside the usage pattern's active hours.
  scaleDownOutsideActiveHours: boolean;
  ownedGpuType: GpuType;
  depreciationYears: number;
  opsOverheadPct: number;
}

const CLOUDS: CloudProvider[] = ["AWS", "Azure", "GCP"];

interface HostingSelectorProps {
  config: SelfHostConfig;
  onChange: (next: SelfHostConfig) => void;
  model: OpenSourceModel;
  // Derived from the workload's usage pattern (active hours/day x days/week).
  activeHoursPerMonth: number;
}

export function HostingSelector({ config, onChange, model, activeHoursPerMonth }: HostingSelectorProps) {
  const reservedDisabled = config.scaleDownOutsideActiveHours;
  const activeHoursLabel = formatNumber(Math.round(activeHoursPerMonth));
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
                <Label htmlFor="scale-down" className="text-sm">
                  Shut down outside active hours
                </Label>
                <p className="text-xs text-muted-foreground">
                  {config.scaleDownOutsideActiveHours
                    ? `Pay only for your ~${activeHoursLabel} active hours/month, plus ~30 min/day to spin up and load the model.`
                    : "GPUs stay on 24/7 (730 h/month), even outside your active hours."}
                </p>
              </div>
              <Switch
                id="scale-down"
                checked={config.scaleDownOutsideActiveHours}
                onCheckedChange={(checked) => onChange({ ...config, scaleDownOutsideActiveHours: checked })}
              />
            </div>

            <div
              className={cn(
                "flex items-center justify-between gap-4 rounded-md border p-3",
                reservedDisabled && "opacity-60",
              )}
            >
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="reserved" className="text-sm">
                    Use committed-use / reserved pricing
                  </Label>
                  {reservedDisabled && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-label="Why reserved pricing is unavailable"
                        />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-64">
                        <p>
                          Reserved / committed-use discounts require paying for the GPUs around
                          the clock for a year, so they can&apos;t be combined with shutting down
                          outside active hours.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {reservedDisabled
                    ? "Not available while shutting down outside active hours (reserved pricing assumes 24/7 use)."
                    : "Approx. discount for a 1-year commitment instead of on-demand rates."}
                </p>
              </div>
              <Switch
                id="reserved"
                disabled={reservedDisabled}
                checked={config.useReservedPricing && !reservedDisabled}
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

            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-sm">Powered on</p>
                <p className="text-xs text-muted-foreground">
                  From your usage pattern above - electricity is estimated for these active hours.
                </p>
              </div>
              <span className="text-sm font-medium tabular-nums whitespace-nowrap">
                ~{activeHoursLabel} h/month
              </span>
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
