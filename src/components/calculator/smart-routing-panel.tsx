"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ROUTER_OPTIONS } from "@/lib/data/routing";
import { getModelsCheaperThan } from "@/lib/calculations";
import { formatUsd } from "@/lib/format";
import type { CommercialModel, RouterChoice, RoutingConfig, WorkloadInputs } from "@/lib/types";
import { AlertTriangle, Info, Route } from "lucide-react";

const NONE_VALUE = "__none__";

interface SmartRoutingPanelProps {
  config: RoutingConfig;
  onChange: (next: RoutingConfig) => void;
  models: CommercialModel[];
  workload: WorkloadInputs;
  bigModel: CommercialModel;
}

export function SmartRoutingPanel({ config, onChange, models, workload, bigModel }: SmartRoutingPanelProps) {
  // Structural guardrail: only models genuinely cheaper than the selected
  // "High" model, for this exact workload, are offered as Low/Medium tiers -
  // this makes routing mathematically unable to cost more due to a
  // misconfigured model choice, rather than just warning about it after the fact.
  const cheaperModels = useMemo(
    () => getModelsCheaperThan(workload, models, bigModel).sort((a, b) => a.inputPricePerM - b.inputPricePerM),
    [workload, models, bigModel],
  );

  const highPct = Math.round(config.escalationRatePct * 100);
  const mediumPct = config.mediumModelId ? Math.round(config.mediumRatePct * 100) : 0;
  const lowPct = Math.max(0, 100 - highPct - mediumPct);

  const lowOptions = cheaperModels.filter((m) => m.id !== config.mediumModelId);
  const mediumOptions = cheaperModels.filter((m) => m.id !== config.smallModelId);

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
              {bigModel.name} is already the cheapest model available for this workload, so there
              is no cheaper tier to route to. Select a pricier main model above to enable routing
              savings.
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
          Send simple requests to a cheap model and only call {bigModel.name} for the requests
          that actually need it. A small &quot;router&quot; model makes that decision automatically,
          inside your pipeline, for every request. Only models cheaper than {bigModel.name} for
          your workload are offered below, so routing can never end up costing more because of the
          model choice itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <div>
            <Label htmlFor="routing-enabled" className="text-sm">
              Enable smart routing
            </Label>
            <p className="text-xs text-muted-foreground">
              Adds a routing step before your model call. Optional - off by default.
            </p>
          </div>
          <Switch
            id="routing-enabled"
            checked={config.enabled}
            onCheckedChange={(checked) => onChange({ ...config, enabled: checked })}
          />
        </div>

        {config.enabled && (
          <>
            <div className="space-y-2">
              <Label>Router</Label>
              <ToggleGroup
                type="single"
                value={config.router}
                onValueChange={(v) => v && onChange({ ...config, router: v as RouterChoice })}
                className="flex-wrap justify-start"
              >
                {ROUTER_OPTIONS.filter((r) => r.id !== "none").map((r) => (
                  <ToggleGroupItem key={r.id} value={r.id} className="px-3 text-xs">
                    {r.name}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">
                {ROUTER_OPTIONS.find((r) => r.id === config.router)?.blurb}
              </p>
            </div>

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
                        The router escalates this share of requests to {bigModel.name}. Typical
                        mixed document workloads see 15-35% genuinely complex requests.
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
                        {m.name} ({m.provider})
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
                        {m.name} ({m.provider})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {formatUsd(models.find((m) => m.id === config.smallModelId)?.inputPricePerM ?? 0, {
                    decimals: 3,
                  })}{" "}
                  / 1M input tokens - handles the {lowPct}% of requests that aren&apos;t escalated.
                </p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
