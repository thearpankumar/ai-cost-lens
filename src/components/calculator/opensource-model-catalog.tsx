"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IntelligenceMeter, PriceTierBadge } from "@/components/calculator/rating-widgets";
import { estimateSelfHostMonthlyCost } from "@/lib/calculations";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OpenSourceModel, WorkloadInputs } from "@/lib/types";
import { Cpu } from "lucide-react";

type SortMode = "cheapest" | "smartest" | "efficient";

interface OpenSourceModelCatalogProps {
  models: OpenSourceModel[];
  workload: WorkloadInputs;
  selectedId: string;
  onSelect: (id: string) => void;
}

export function OpenSourceModelCatalog({
  models,
  workload,
  selectedId,
  onSelect,
}: OpenSourceModelCatalogProps) {
  const [sort, setSort] = useState<SortMode>("cheapest");
  const [taskFilterOn, setTaskFilterOn] = useState(true);

  const filteredModels = useMemo(() => {
    if (!taskFilterOn) return models;
    const filtered = models.filter((m) => m.goodFor.includes(workload.taskType));
    return filtered.some((m) => m.id === selectedId) || filtered.length > 0 ? filtered : models;
  }, [models, taskFilterOn, workload.taskType, selectedId]);

  const rows = useMemo(() => {
    const withCost = filteredModels.map((model) => ({
      model,
      monthlyCost: estimateSelfHostMonthlyCost(workload, model),
    }));

    return withCost.sort((a, b) => {
      if (sort === "cheapest") return a.monthlyCost - b.monthlyCost;
      if (sort === "smartest") return b.model.intelligenceScore - a.model.intelligenceScore;
      return a.model.paramsB - b.model.paramsB;
    });
  }, [filteredModels, workload, sort]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {rows.length} open-source model{rows.length === 1 ? "" : "s"} &middot; select one to
          size your server
        </p>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Switch id="oss-task-filter" checked={taskFilterOn} onCheckedChange={setTaskFilterOn} />
            <Label htmlFor="oss-task-filter" className="text-xs text-muted-foreground font-normal">
              Suited to my task only
            </Label>
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
            <SelectTrigger className="w-[190px]" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cheapest">Cheapest first (est.)</SelectItem>
              <SelectItem value="smartest">Most capable first</SelectItem>
              <SelectItem value="efficient">Fewest parameters first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {rows.map(({ model, monthlyCost }) => {
          const selected = model.id === selectedId;
          return (
            <Card
              key={model.id}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              onClick={() => onSelect(model.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(model.id);
                }
              }}
              className={cn(
                "cursor-pointer p-4 transition-colors gap-3 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                selected && "border-primary ring-1 ring-primary",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Badge variant="secondary" className="mb-1 text-[10px] font-normal">
                    {model.family}
                  </Badge>
                  <h3 className="text-sm font-semibold leading-tight">{model.name}</h3>
                </div>
                <PriceTierBadge tier={model.tier} />
              </div>

              <p className="text-xs text-muted-foreground leading-snug">{model.blurb}</p>

              <div className="flex items-center justify-between">
                <IntelligenceMeter score={model.intelligenceScore} />
              </div>

              <div className="rounded-md bg-muted/60 px-3 py-2 mt-1">
                <p className="text-lg font-semibold tabular-nums leading-tight">
                  {formatUsd(monthlyCost)}
                  <span className="text-xs font-normal text-muted-foreground">/mo</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  on its recommended GPU, AWS on-demand
                </p>
              </div>

              <div className="rounded-md bg-muted/60 px-3 py-2 flex items-center gap-2">
                <Cpu className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium leading-tight">{model.recommendedGpuLabel}</p>
                  <p className="text-xs text-muted-foreground">recommended minimum</p>
                </div>
              </div>

              {model.tier === "enterprise-cluster" && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                  Requires a multi-GPU cluster - a significant infrastructure commitment
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
