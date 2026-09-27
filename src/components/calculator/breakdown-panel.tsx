"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatPercent, formatUsd } from "@/lib/format";
import type {
  ApiCostBreakdown,
  CommercialModel,
  OpenSourceModel,
  RoutedApiCostBreakdown,
  SelfHostCostBreakdown,
} from "@/lib/types";
import { AlertTriangle, TrendingDown } from "lucide-react";
import { RegionalCostList, type RegionalCostRow } from "@/components/calculator/regional-cost-list";

interface LineItemProps {
  label: string;
  value: string;
  sub?: string;
}

function LineItem({ label, value, sub }: LineItemProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <div>
        <p className="text-sm text-foreground">{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      <p className="text-sm font-medium tabular-nums whitespace-nowrap">{value}</p>
    </div>
  );
}

function WarningBanner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
      <p className="text-sm text-amber-800 dark:text-amber-300">{children}</p>
    </div>
  );
}

export interface ContextWindowWarning {
  modelName: string;
  inputTokensPerCall: number;
  contextWindow: number;
  exceeds: boolean;
}

function ContextWindowNotice({ warning }: { warning?: ContextWindowWarning }) {
  if (!warning) return null;
  return (
    <WarningBanner>
      <span className="font-semibold">
        {warning.exceeds ? "This document size exceeds" : "This document size is close to"}{" "}
        {warning.modelName}&apos;s context window
      </span>{" "}
      ({formatNumber(warning.inputTokensPerCall)} of {formatNumber(warning.contextWindow)} tokens
      per request). {warning.exceeds ? "Requests this large may fail or be truncated." : "Consider a shorter document or a model with a larger context window."}
    </WarningBanner>
  );
}

export function ApiBreakdownPanel({
  model,
  breakdown,
  regionalBreakdowns,
  contextWarning,
}: {
  model: CommercialModel;
  breakdown: ApiCostBreakdown;
  regionalBreakdowns?: RegionalCostRow[];
  contextWarning?: ContextWindowWarning;
}) {
  return (
    <Card className="sticky top-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Cost breakdown</CardTitle>
          <Badge variant="secondary">{model.provider}</Badge>
        </div>
        <CardDescription>{model.name}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-3xl font-bold tabular-nums">{formatUsd(breakdown.totalMonthlyCost)}</p>
          <p className="text-sm text-muted-foreground">per month</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">Per document</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatUsd(breakdown.costPerDocument, { decimals: 4 })}
            </p>
          </div>
          <div className="rounded-md bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">Per year</p>
            <p className="text-lg font-semibold tabular-nums">{formatUsd(breakdown.annualCost)}</p>
          </div>
        </div>

        <ContextWindowNotice warning={contextWarning} />

        {regionalBreakdowns && <RegionalCostList rows={regionalBreakdowns} />}

        <Separator />

        <div>
          <LineItem
            label="Input tokens"
            sub={`${formatNumber(breakdown.uncachedInputTokens)} tokens`}
            value={formatUsd(breakdown.inputCost)}
          />
          {breakdown.cachedInputTokens > 0 && (
            <LineItem
              label="Cached input tokens"
              sub={`${formatNumber(breakdown.cachedInputTokens)} tokens, discounted rate`}
              value={formatUsd(breakdown.cachedInputCost)}
            />
          )}
          <LineItem
            label="Output tokens"
            sub={`${formatNumber(breakdown.monthlyOutputTokens)} tokens`}
            value={formatUsd(breakdown.outputCost)}
          />
          <Separator className="my-2" />
          <LineItem label="Total" value={formatUsd(breakdown.totalMonthlyCost)} />
        </div>

        <p className="text-xs text-muted-foreground pt-2 border-t">
          Estimate based on list/pay-as-you-go pricing. Enterprise agreements, volume discounts
          and provider-specific rate tiers may lower your actual cost.
        </p>
      </CardContent>
    </Card>
  );
}

export function RoutedApiBreakdownPanel({
  bigModel,
  mediumModel,
  smallModel,
  routerName,
  breakdown,
  regionalBreakdowns,
  contextWarning,
}: {
  bigModel: CommercialModel;
  mediumModel?: CommercialModel | null;
  smallModel: CommercialModel;
  routerName: string;
  breakdown: RoutedApiCostBreakdown;
  regionalBreakdowns?: RegionalCostRow[];
  contextWarning?: ContextWindowWarning;
}) {
  return (
    <Card className="sticky top-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Cost breakdown</CardTitle>
          <Badge variant="secondary">Smart routing</Badge>
        </div>
        <CardDescription>
          {routerName} routing across {smallModel.name}
          {mediumModel ? `, ${mediumModel.name}` : ""} and {bigModel.name}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-3xl font-bold tabular-nums">{formatUsd(breakdown.totalMonthlyCost)}</p>
          <p className="text-sm text-muted-foreground">per month</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">Per document</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatUsd(breakdown.costPerDocument, { decimals: 4 })}
            </p>
          </div>
          <div className="rounded-md bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">Per year</p>
            <p className="text-lg font-semibold tabular-nums">{formatUsd(breakdown.annualCost)}</p>
          </div>
        </div>

        {breakdown.savingsAmount > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
            <TrendingDown className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            <p className="text-sm text-emerald-800 dark:text-emerald-300">
              <span className="font-semibold">
                Save {formatUsd(breakdown.savingsAmount)}/mo ({formatPercent(breakdown.savingsPct)})
              </span>{" "}
              versus always using {bigModel.name} ({formatUsd(breakdown.baselineCost)}/mo).
            </p>
          </div>
        ) : (
          <WarningBanner>
            <span className="font-semibold">
              This routing setup costs {formatUsd(Math.abs(breakdown.savingsAmount))}/mo more
            </span>{" "}
            than always using {bigModel.name} ({formatUsd(breakdown.baselineCost)}/mo). Try a
            cheaper &quot;simple request&quot; model or a lower escalation rate.
          </WarningBanner>
        )}

        <ContextWindowNotice warning={contextWarning} />

        {regionalBreakdowns && <RegionalCostList rows={regionalBreakdowns} />}

        <Separator />

        <div>
          <LineItem
            label={`${bigModel.name} (High)`}
            sub={`${formatNumber(breakdown.escalatedCalls)} of ${formatNumber(breakdown.totalCalls)} requests`}
            value={formatUsd(breakdown.bigModelCost)}
          />
          {mediumModel && (
            <LineItem
              label={`${mediumModel.name} (Medium)`}
              sub={`${formatNumber(breakdown.mediumCalls)} of ${formatNumber(breakdown.totalCalls)} requests`}
              value={formatUsd(breakdown.mediumModelCost)}
            />
          )}
          <LineItem
            label={`${smallModel.name} (Low)`}
            sub={`${formatNumber(breakdown.routedCalls)} of ${formatNumber(breakdown.totalCalls)} requests`}
            value={formatUsd(breakdown.smallModelCost)}
          />
          <LineItem
            label="Router decisions"
            sub={`${formatNumber(breakdown.totalCalls)} decisions, ${formatNumber(breakdown.routerInputTokens)} tokens`}
            value={formatUsd(breakdown.routerCost)}
          />
          <Separator className="my-2" />
          <LineItem label="Total" value={formatUsd(breakdown.totalMonthlyCost)} />
        </div>

        <p className="text-xs text-muted-foreground pt-2 border-t">
          Escalation rate is a planning assumption, not a measured value - your actual complex-vs-simple
          split will vary by workload and router confidence threshold.
        </p>
      </CardContent>
    </Card>
  );
}

export function SelfHostBreakdownPanel({
  model,
  breakdown,
  locationLabel,
  isOwned,
  regionalBreakdowns,
}: {
  model: OpenSourceModel;
  breakdown: SelfHostCostBreakdown;
  locationLabel: string;
  isOwned: boolean;
  regionalBreakdowns?: RegionalCostRow[];
}) {
  const multiRegion = (regionalBreakdowns?.length ?? 1) > 1;
  const lowUtilization = multiRegion && breakdown.utilizationPct < 30;

  return (
    <Card className="sticky top-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Cost breakdown</CardTitle>
          <Badge variant="secondary">{model.family}</Badge>
        </div>
        <CardDescription>
          {model.name} on {locationLabel}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-3xl font-bold tabular-nums">{formatUsd(breakdown.totalMonthlyCost)}</p>
          <p className="text-sm text-muted-foreground">per month</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">Per document</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatUsd(breakdown.costPerDocument, { decimals: 4 })}
            </p>
          </div>
          <div className="rounded-md bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">Per year</p>
            <p className="text-lg font-semibold tabular-nums">{formatUsd(breakdown.annualCost)}</p>
          </div>
        </div>

        {regionalBreakdowns && <RegionalCostList rows={regionalBreakdowns} />}

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Server capacity used</span>
            <span className="font-medium tabular-nums">{breakdown.utilizationPct.toFixed(0)}%</span>
          </div>
          <Progress value={breakdown.utilizationPct} />
          <p className="text-xs text-muted-foreground">
            {breakdown.gpusNeeded} GPU{breakdown.gpusNeeded > 1 ? "s" : ""} needed to comfortably
            handle this volume.
          </p>
        </div>

        {lowUtilization && (
          <WarningBanner>
            <span className="font-semibold">Utilization is only {breakdown.utilizationPct.toFixed(0)}%</span>{" "}
            across your selected regions - splitting volume this many ways forces a minimum of one
            GPU per region even at low usage. Consider fewer regions, or cloud rental with
            autoscaling, to avoid paying for idle capacity.
          </WarningBanner>
        )}

        <Separator />

        <div>
          <LineItem
            label={isOwned ? "Hardware (amortized)" : "GPU rental"}
            value={formatUsd(breakdown.computeCostMonthly)}
          />
          {isOwned && (
            <LineItem label="Electricity" value={formatUsd(breakdown.electricityCostMonthly)} />
          )}
          <LineItem label="Ops & maintenance" value={formatUsd(breakdown.overheadCostMonthly)} />
          <Separator className="my-2" />
          <LineItem label="Total" value={formatUsd(breakdown.totalMonthlyCost)} />
        </div>

        <p className="text-xs text-muted-foreground pt-2 border-t">
          Estimate based on public cloud list pricing and typical hardware/ops assumptions.
          Actual cost depends on region, negotiated discounts and real-world utilization.
        </p>
      </CardContent>
    </Card>
  );
}
