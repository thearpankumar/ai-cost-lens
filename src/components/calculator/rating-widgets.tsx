"use client";

import { cn } from "@/lib/utils";
import type { ModelTier, OpenSourceTier, SpeedTier } from "@/lib/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Zap, Gauge, Turtle } from "lucide-react";

const INTELLIGENCE_LABELS = ["Basic", "Capable", "Strong", "Advanced", "Frontier"];

function scoreToLevel(score: number): number {
  // 0-100 -> 1-5 filled segments
  return Math.max(1, Math.min(5, Math.ceil(score / 20)));
}

export function IntelligenceMeter({ score, className }: { score: number; className?: string }) {
  const level = scoreToLevel(score);
  const label = INTELLIGENCE_LABELS[level - 1];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-center gap-1.5", className)}>
          <span className="text-xs font-medium text-muted-foreground">Intelligence</span>
          <div className="flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                className={cn("h-3 w-1.5 rounded-sm", i < level ? "bg-primary" : "bg-muted")}
              />
            ))}
          </div>
          <span className="text-xs font-medium text-foreground">{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>
          {label} ({score}/100) &mdash; a directional capability index based on independent
          benchmark aggregators, not a precise measurement.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

const TIER_DOLLAR_SIGNS: Record<ModelTier | OpenSourceTier, number> = {
  budget: 1,
  balanced: 2,
  flagship: 3,
  frontier: 4,
  efficient: 1,
  "enterprise-cluster": 4,
};

const TIER_LABELS: Record<ModelTier | OpenSourceTier, string> = {
  budget: "Budget",
  balanced: "Balanced",
  flagship: "Flagship",
  frontier: "Frontier",
  efficient: "Efficient",
  "enterprise-cluster": "Enterprise cluster",
};

export function PriceTierBadge({ tier, className }: { tier: ModelTier | OpenSourceTier; className?: string }) {
  const count = TIER_DOLLAR_SIGNS[tier];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums",
            className,
          )}
        >
          <span className="text-foreground">{"$".repeat(count)}</span>
          <span className="text-muted-foreground">{"$".repeat(4 - count)}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{TIER_LABELS[tier]} pricing tier</p>
      </TooltipContent>
    </Tooltip>
  );
}

const SPEED_CONFIG: Record<SpeedTier, { icon: typeof Zap; label: string }> = {
  fast: { icon: Zap, label: "Fast" },
  medium: { icon: Gauge, label: "Medium speed" },
  slow: { icon: Turtle, label: "Slower, deeper reasoning" },
};

export function SpeedBadge({ speed, className }: { speed: SpeedTier; className?: string }) {
  const { icon: Icon, label } = SPEED_CONFIG[speed];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>Typical response speed for this model</p>
      </TooltipContent>
    </Tooltip>
  );
}
