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
import { IntelligenceMeter, PriceTierBadge, SpeedBadge } from "@/components/calculator/rating-widgets";
import { calculateApiCost } from "@/lib/calculations";
import { providerLogos } from "@/lib/data/logos";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CommercialModel, WorkloadInputs } from "@/lib/types";

type SortMode = "cheapest" | "smartest" | "fastest";

interface CommercialModelCatalogProps {
  models: CommercialModel[];
  workload: WorkloadInputs;
  selectedId: string;
  onSelect: (id: string) => void;
}

export function CommercialModelCatalog({
  models,
  workload,
  selectedId,
  onSelect,
}: CommercialModelCatalogProps) {
  const [sort, setSort] = useState<SortMode>("cheapest");
  const [taskFilterOn, setTaskFilterOn] = useState(true);

  const filteredModels = useMemo(() => {
    if (!taskFilterOn) return models;
    const filtered = models.filter((m) => m.goodFor.includes(workload.taskType));
    // Never filter down to nothing (or exclude the currently selected model) -
    // fall back to the full list rather than leaving the user with no options.
    return filtered.some((m) => m.id === selectedId) || filtered.length > 0 ? filtered : models;
  }, [models, taskFilterOn, workload.taskType, selectedId]);

  const rows = useMemo(() => {
    const withCost = filteredModels.map((model) => ({
      model,
      cost: calculateApiCost(workload, model),
    }));

    return withCost.sort((a, b) => {
      if (sort === "cheapest") return a.cost.totalMonthlyCost - b.cost.totalMonthlyCost;
      if (sort === "smartest") return b.model.intelligenceScore - a.model.intelligenceScore;
      const speedRank = { fast: 0, medium: 1, slow: 2 } as const;
      return speedRank[a.model.speedTier] - speedRank[b.model.speedTier];
    });
  }, [filteredModels, workload, sort]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {rows.length} model{rows.length === 1 ? "" : "s"} &middot; select one to see the full
          breakdown
        </p>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Switch id="task-filter" checked={taskFilterOn} onCheckedChange={setTaskFilterOn} />
            <Label htmlFor="task-filter" className="text-xs text-muted-foreground font-normal">
              Suited to my task only
            </Label>
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
            <SelectTrigger className="w-[180px]" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cheapest">Cheapest first</SelectItem>
              <SelectItem value="smartest">Most capable first</SelectItem>
              <SelectItem value="fastest">Fastest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {rows.map(({ model, cost }) => {
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
                  <div className="flex items-center gap-1.5 mb-1">
                    <img
                      src={providerLogos[model.provider]}
                      alt=""
                      aria-hidden="true"
                      width={16}
                      height={16}
                      className="h-4 w-4 object-contain shrink-0"
                    />
                    <Badge variant="secondary" className="text-[10px] font-normal">
                      {model.provider}
                    </Badge>
                  </div>
                  <h3 className="text-sm font-semibold leading-tight">{model.name}</h3>
                </div>
                <PriceTierBadge tier={model.tier} />
              </div>

              <p className="text-xs text-muted-foreground leading-snug">{model.blurb}</p>

              <div className="flex items-center justify-between">
                <IntelligenceMeter score={model.intelligenceScore} />
                <SpeedBadge speed={model.speedTier} />
              </div>

              <div className="rounded-md bg-muted/60 px-3 py-2 mt-1">
                <p className="text-lg font-semibold tabular-nums leading-tight">
                  {formatUsd(cost.totalMonthlyCost)}
                  <span className="text-xs font-normal text-muted-foreground">/mo</span>
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatUsd(cost.costPerDocument, { decimals: 4 })} per document
                </p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
