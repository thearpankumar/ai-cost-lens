"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getOpenSourceModelsCheaperThan,
  estimateSelfHostMonthlyCost,
  type ResolveHostParams,
} from "@/lib/calculations";
import { formatUsd } from "@/lib/format";
import type { OpenSourceModel, RoutingConfig, WorkloadInputs } from "@/lib/types";
import { AlertTriangle, Info, Route } from "lucide-react";

const NONE_VALUE = "__none__";

interface SelfHostRoutingPanelProps {
  config: RoutingConfig;
  onChange: (next: RoutingConfig) => void;
  models: OpenSourceModel[];
  workload: WorkloadInputs;
  highModel: OpenSourceModel;
  // Same per-model hosting resolver the routing breakdown uses, so the
  // guardrail and previews here match the routed costs.
  hostParamsForModel: ResolveHostParams;
}

export function SelfHostRoutingPanel({
  config,
  onChange,
  models,
  workload,
  highModel,
  hostParamsForModel,
}: SelfHostRoutingPanelProps) {
  // Structural guardrail: only open-source models genuinely cheaper to
  // self-host than the selected "High" model, for this exact workload and
  // hosting setup, are offered as Low/Medium tiers.
  const cheaperModels = useMemo(
    () =>
      getOpenSourceModelsCheaperThan(workload, models, highModel, hostParamsForModel).sort(
        (a, b) =>
          estimateSelfHostMonthlyCost(workload, a, hostParamsForModel(a)) -
          estimateSelfHostMonthlyCost(workload, b, hostParamsForModel(b)),
      ),
    [workload, models, highModel, hostParamsForModel],
  );

  const highPct = Math.round(config.escalationRatePct * 100);
  const mediumPct = config.mediumModelId ? Math.round(config.mediumRatePct * 100) : 0;
  const lowPct = Math.max(0, 100 - highPct - mediumPct);

  const lowOptions = cheaperModels.filter((m) => m.id !== config.mediumModelId);
  const mediumOptions = cheaperModels.filter((m) => m.id !== config.smallModelId);
  const lowModel = models.find((m) => m.id === config.smallModelId);

  if (cheaperModels.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Route className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Smart model routing</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              {highModel.name} is already the cheapest model available to self-host for this
              workload, so there is no cheaper tier to route to. Select a larger main model above
              to enable routing savings.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Smart model routing</CardTitle>
        </div>
        <CardDescription>
          Send simple requests to a smaller, cheaper self-hosted model and only run {highModel.name}
          {" "}for the requests that actually need it. Routed by Laya - an open-source, self-hosted
          decision model with no external calls, consistent with a fully self-hosted deployment.
          Only open-source models cheaper than {highModel.name} to self-host are offered below.
          Routing pays off once your volume is large enough that running {highModel.name} alone
          would already need more than one GPU - at low volume, splitting into separate deployments
          can cost more, since each one needs its own minimum GPU.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <div>
            <Label htmlFor="self-host-routing-enabled" className="text-sm">
              Enable smart routing
            </Label>
            <p className="text-xs text-muted-foreground">
              Adds a Laya routing step in front of your self-hosted models. Optional - off by
              default.
            </p>
          </div>
          <Switch
            id="self-host-routing-enabled"
            checked={config.enabled}
            onCheckedChange={(checked) => onChange({ ...config, enabled: checked })}
          />
        </div>

        {config.enabled && (
          <div className="rounded-lg border p-3 space-y-4">
            <p className="text-xs font-medium text-muted-foreground">
              Traffic split - Low {lowPct}% / {config.mediumModelId ? `Medium ${mediumPct}% / ` : ""}
              High {highPct}%
            </p>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                Share of requests that are complex (High)
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    <p>
                      Laya escalates this share of requests to {highModel.name}. Typical mixed
                      document workloads see 15-35% genuinely complex requests.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Slider
                  aria-label="Share of requests that are complex (High), percent"
                  min={5}
                  max={75}
                  step={5}
                  value={[highPct]}
                  onValueChange={([v]) => {
                    const maxMedium = Math.max(0, 95 - v);
                    onChange({
                      ...config,
                      escalationRatePct: v / 100,
                      mediumRatePct: Math.min(config.mediumRatePct, maxMedium / 100),
                    });
                  }}
                  className="max-w-xs min-w-[120px] flex-1"
                />
                <span className="text-sm tabular-nums text-muted-foreground w-10 shrink-0 whitespace-nowrap">{highPct}%</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Medium tier (optional)</Label>
              <Select
                value={config.mediumModelId ?? NONE_VALUE}
                onValueChange={(v) =>
                  onChange({
                    ...config,
                    mediumModelId: v === NONE_VALUE ? null : v,
                    mediumRatePct: v === NONE_VALUE ? 0 : config.mediumRatePct || 0.2,
                  })
                }
              >
                <SelectTrigger className="w-full sm:w-[320px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>None - keep it 2-tier (Low/High)</SelectItem>
                  {mediumOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} ({m.family})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {config.mediumModelId && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                  <Slider
                    aria-label="Share of requests sent to the Medium tier, percent"
                    min={0}
                    max={Math.max(0, 95 - highPct)}
                    step={5}
                    value={[mediumPct]}
                    onValueChange={([v]) => onChange({ ...config, mediumRatePct: v / 100 })}
                    className="max-w-xs min-w-[120px] flex-1"
                  />
                  <span className="text-sm tabular-nums text-muted-foreground w-10 shrink-0 whitespace-nowrap">{mediumPct}%</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Low tier - simple requests</Label>
              <Select
                value={config.smallModelId}
                onValueChange={(v) => onChange({ ...config, smallModelId: v })}
              >
                <SelectTrigger className="w-full sm:w-[320px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {lowOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} ({m.family})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lowModel && (
                <p className="text-xs text-muted-foreground">
                  {lowModel.recommendedGpuLabel} - roughly{" "}
                  {formatUsd(
                    estimateSelfHostMonthlyCost(workload, lowModel, hostParamsForModel(lowModel)),
                  )}
                  /mo if it handled all
                  your volume alone - handles the {lowPct}% of requests that aren&apos;t escalated.
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
