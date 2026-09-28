"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatPercent, formatUsd } from "@/lib/format";
import { aggregateSelfHostBreakdowns } from "@/lib/calculations";
import type {
  ApiCostBreakdown,
  CommercialModel,
  OpenSourceModel,
  RoutedApiCostBreakdown,
  RoutedSelfHostCostBreakdown,
  SelfHostCostBreakdown,
} from "@/lib/types";
import { AlertTriangle, Info, TrendingDown } from "lucide-react";
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

const VRAM_HEADROOM_MESSAGE =
  "This configuration leaves little spare VRAM for request concurrency - long documents or multiple simultaneous requests may be slower than expected.";

function VramHeadroomNotice({ modelName }: { modelName?: string }) {
  return (
    <WarningBanner>
      {modelName && <span className="font-semibold">{modelName}: </span>}
      {VRAM_HEADROOM_MESSAGE}
    </WarningBanner>
  );
}

/** Plain-English "why this many GPUs" explanation for a self-host breakdown. */
export function describeLimitingFactor(breakdown: SelfHostCostBreakdown): string {
  switch (breakdown.limitingFactor) {
    case "concurrency": {
      const people = formatNumber(Math.ceil(breakdown.peakConcurrentUsers));
      return breakdown.concurrencyBound === "vram"
        ? `sized to handle ${people} people at once - limited by GPU memory for concurrent conversations, not raw speed`
        : `sized to comfortably handle ${people} people at once`;
    }
    case "volume":
      return "sized for your document volume";
    default:
      return "minimum footprint for this model";
  }
}

const VRAM_BOUND_CONCURRENCY_MESSAGE =
  "Each live conversation needs its own slice of GPU memory (its KV cache, assumed ~4K tokens of context per person). Here that memory - not raw GPU speed - caps how many people one server can serve at once, so capacity grows by adding GPUs or choosing GPUs with more memory; a faster card with the same memory won't help much.";

function VramBoundConcurrencyNotice() {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
      <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Limited by GPU memory: </span>
        {VRAM_BOUND_CONCURRENCY_MESSAGE}
      </p>
    </div>
  );
}

function yearsLabel(years: number): string {
  return `${years} year${years === 1 ? "" : "s"}`;
}

/**
 * Owned hardware: shows the one-time purchase separately from what keeps
 * recurring every month, so capex isn't blurred into the monthly figure.
 */
function OwnedHardwareCostSplit({
  oneTimeUsd,
  recurringMonthly,
  gpusNeeded,
  recurringSub,
}: {
  oneTimeUsd: number;
  recurringMonthly: number;
  gpusNeeded: number;
  recurringSub: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
        <p className="text-xs text-muted-foreground">Hardware purchase (one-time)</p>
        <p className="text-lg font-semibold tabular-nums">{formatUsd(oneTimeUsd)}</p>
        <p className="text-xs text-muted-foreground">
          {gpusNeeded} GPU{gpusNeeded > 1 ? "s" : ""} plus server, paid upfront
        </p>
      </div>
      <div className="rounded-md bg-muted/60 p-3">
        <p className="text-xs text-muted-foreground">Ongoing cost per month</p>
        <p className="text-lg font-semibold tabular-nums">{formatUsd(recurringMonthly)}</p>
        <p className="text-xs text-muted-foreground">{recurringSub}</p>
      </div>
    </div>
  );
}

const OWNED_FINANCING_CAVEAT =
  "Owned-hardware figures assume an upfront cash purchase with straight-line depreciation; financing or leasing costs are not modeled, so financed or leased hardware would cost more per month than shown.";

function gpuCountLabel(breakdown: SelfHostCostBreakdown): string {
  const gpus = `${breakdown.gpusNeeded} GPU${breakdown.gpusNeeded > 1 ? "s" : ""}`;
  if (breakdown.gpusNeeded === breakdown.replicas) return gpus;
  const perReplica = breakdown.gpusNeeded / breakdown.replicas;
  return `${gpus} (${breakdown.replicas} x ${perReplica}-GPU cluster${breakdown.replicas > 1 ? "s" : ""})`;
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
  depreciationYears,
  regionalBreakdowns,
}: {
  model: OpenSourceModel;
  breakdown: SelfHostCostBreakdown;
  locationLabel: string;
  isOwned: boolean;
  depreciationYears: number;
  regionalBreakdowns?: RegionalCostRow[];
}) {
  const multiRegion = (regionalBreakdowns?.length ?? 1) > 1;
  const lowUtilization = multiRegion && breakdown.utilizationPct < 30;
  const vramBound =
    breakdown.limitingFactor === "concurrency" && breakdown.concurrencyBound === "vram";

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
          {isOwned && (
            <p className="text-xs text-muted-foreground mt-1">
              Comparison figure - includes {formatUsd(breakdown.computeCostMonthly)}/mo of
              hardware spread over {yearsLabel(depreciationYears)}. See the one-time purchase
              below.
            </p>
          )}
        </div>

        {isOwned && (
          <OwnedHardwareCostSplit
            oneTimeUsd={breakdown.hardwareCostOneTimeUsd}
            recurringMonthly={breakdown.recurringMonthlyCostExclHardware}
            gpusNeeded={breakdown.gpusNeeded}
            recurringSub="electricity + ops, once the hardware is paid for"
          />
        )}

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
            <span className="font-medium text-foreground">{gpuCountLabel(breakdown)}</span> -{" "}
            {describeLimitingFactor(breakdown)}. Average load during your ~
            {formatNumber(Math.round(breakdown.activeHoursPerMonth))} active hours/month, with 20%
            planning headroom kept free.
          </p>
        </div>

        {breakdown.vramHeadroomWarning && <VramHeadroomNotice />}

        {vramBound && <VramBoundConcurrencyNotice />}

        {lowUtilization && (
          <WarningBanner>
            <span className="font-semibold">Utilization is only {breakdown.utilizationPct.toFixed(0)}%</span>{" "}
            across your selected regions - splitting volume this many ways forces a minimum of one
            full model deployment per region even at low usage. Consider fewer regions, or cloud rental with
            autoscaling, to avoid paying for idle capacity.
          </WarningBanner>
        )}

        <Separator />

        <div>
          {isOwned ? (
            <>
              <LineItem
                label="Electricity"
                sub={`~${formatNumber(Math.round(breakdown.billedHoursPerMonth))} powered hours/month`}
                value={formatUsd(breakdown.electricityCostMonthly)}
              />
              <LineItem label="Ops & maintenance" value={formatUsd(breakdown.overheadCostMonthly)} />
              <Separator className="my-2" />
              <LineItem
                label="Ongoing monthly cost"
                sub="what keeps recurring once the hardware is paid for"
                value={formatUsd(breakdown.recurringMonthlyCostExclHardware)}
              />
              <LineItem
                label="Hardware, amortized"
                sub={`${formatUsd(breakdown.hardwareCostOneTimeUsd)} one-time purchase spread over ${yearsLabel(depreciationYears)}`}
                value={formatUsd(breakdown.computeCostMonthly)}
              />
              <Separator className="my-2" />
              <LineItem
                label="Total (comparison figure)"
                sub="ongoing cost + amortized hardware"
                value={formatUsd(breakdown.totalMonthlyCost)}
              />
            </>
          ) : (
            <>
              <LineItem
                label="GPU rental"
                sub={`${breakdown.gpusNeeded} GPU${breakdown.gpusNeeded > 1 ? "s" : ""} x ~${formatNumber(Math.round(breakdown.billedHoursPerMonth))} h/month`}
                value={formatUsd(breakdown.computeCostMonthly)}
              />
              <LineItem label="Ops & maintenance" value={formatUsd(breakdown.overheadCostMonthly)} />
              <Separator className="my-2" />
              <LineItem label="Total" value={formatUsd(breakdown.totalMonthlyCost)} />
            </>
          )}
        </div>

        <p className="text-xs text-muted-foreground pt-2 border-t">
          Estimate based on public cloud list pricing and typical hardware/ops assumptions.
          Actual cost depends on region, negotiated discounts and real-world utilization.
          {isOwned && ` ${OWNED_FINANCING_CAVEAT}`}
        </p>
      </CardContent>
    </Card>
  );
}

const TIER_LABELS: Record<"high" | "medium" | "low", string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function RoutedSelfHostBreakdownPanel({
  highModel,
  mediumModel,
  lowModel,
  isOwned,
  depreciationYears,
  breakdown,
  regionalBreakdowns,
}: {
  highModel: OpenSourceModel;
  mediumModel?: OpenSourceModel | null;
  lowModel: OpenSourceModel;
  isOwned: boolean;
  depreciationYears: number;
  breakdown: RoutedSelfHostCostBreakdown;
  regionalBreakdowns?: RegionalCostRow[];
}) {
  // Owned hardware: the upfront purchase across every tier (and region), kept
  // separate from what recurs monthly - each tier's ongoing cost plus the
  // router, which is a recurring fee.
  const hardwareOneTimeUsd = breakdown.tiers.reduce(
    (sum, t) => sum + t.breakdown.hardwareCostOneTimeUsd,
    0,
  );
  const amortizedHardwareMonthly = breakdown.tiers.reduce(
    (sum, t) => sum + t.breakdown.computeCostMonthly,
    0,
  );
  const recurringMonthly =
    breakdown.tiers.reduce((sum, t) => sum + t.breakdown.recurringMonthlyCostExclHardware, 0) +
    breakdown.routerCost;
  const anyTierVramBound = breakdown.tiers.some(
    (t) => t.breakdown.limitingFactor === "concurrency" && t.breakdown.concurrencyBound === "vram",
  );
  const modelsByTier: Record<"high" | "medium" | "low", OpenSourceModel | null | undefined> = {
    high: highModel,
    medium: mediumModel,
    low: lowModel,
  };
  const totalDocs = breakdown.tiers.reduce((sum, t) => sum + t.docsPerMonth, 0);
  // Tier results are repeated per region; list each tight model once.
  const vramTightModels = Array.from(
    new Set(
      breakdown.tiers
        .filter((t) => t.breakdown.vramHeadroomWarning)
        .map((t) => modelsByTier[t.tier]?.name)
        .filter((name): name is string => !!name),
    ),
  );

  return (
    <Card className="sticky top-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Cost breakdown</CardTitle>
          <Badge variant="secondary">Smart routing</Badge>
        </div>
        <CardDescription>
          Laya routing across {lowModel.name}
          {mediumModel ? `, ${mediumModel.name}` : ""} and {highModel.name}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-3xl font-bold tabular-nums">{formatUsd(breakdown.totalMonthlyCost)}</p>
          <p className="text-sm text-muted-foreground">per month</p>
          {isOwned && (
            <p className="text-xs text-muted-foreground mt-1">
              Comparison figure - includes {formatUsd(amortizedHardwareMonthly)}/mo of hardware
              spread over {yearsLabel(depreciationYears)}. See the one-time purchase below.
            </p>
          )}
        </div>

        {isOwned && (
          <OwnedHardwareCostSplit
            oneTimeUsd={hardwareOneTimeUsd}
            recurringMonthly={recurringMonthly}
            gpusNeeded={breakdown.totalGpusNeeded}
            recurringSub="electricity, ops and router, once the hardware is paid for"
          />
        )}

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
              versus always running {highModel.name} alone ({formatUsd(breakdown.baselineCost)}/mo).
            </p>
          </div>
        ) : (
          <WarningBanner>
            <span className="font-semibold">
              This routing setup costs {formatUsd(Math.abs(breakdown.savingsAmount))}/mo more
            </span>{" "}
            than always running {highModel.name} alone ({formatUsd(breakdown.baselineCost)}/mo).
            At this volume each tier&apos;s own minimum GPU outweighs the savings - try a higher
            escalation rate, fewer tiers, or revisit once volume grows.
          </WarningBanner>
        )}

        {vramTightModels.length > 0 && <VramHeadroomNotice modelName={vramTightModels.join(", ")} />}

        {anyTierVramBound && <VramBoundConcurrencyNotice />}

        {regionalBreakdowns && <RegionalCostList rows={regionalBreakdowns} />}

        <Separator />

        <div className="space-y-1">
          {(["high", "medium", "low"] as const).map((tierKey) => {
            // Tier results repeat once per region - combine every region's
            // copy of this tier instead of showing only the first region's.
            const tierEntries = breakdown.tiers.filter((t) => t.tier === tierKey);
            const tierModel = modelsByTier[tierKey];
            if (tierEntries.length === 0 || !tierModel) return null;
            const tierDocs = tierEntries.reduce((sum, t) => sum + t.docsPerMonth, 0);
            const combined = aggregateSelfHostBreakdowns(
              tierEntries.map((t) => ({
                regionId: "us" as const,
                docsPerMonth: t.docsPerMonth,
                breakdown: t.breakdown,
              })),
            );
            return (
              <LineItem
                key={tierKey}
                label={`${tierModel.name} (${TIER_LABELS[tierKey]})`}
                sub={`${formatNumber(tierDocs)} of ${formatNumber(totalDocs)} docs/mo · ${gpuCountLabel(combined)}, ${describeLimitingFactor(combined)}`}
                value={formatUsd(combined.totalMonthlyCost)}
              />
            );
          })}
          <LineItem label="Router (Laya)" value={formatUsd(breakdown.routerCost)} />
          <Separator className="my-2" />
          <LineItem
            label={isOwned ? "Total (comparison figure)" : "Total"}
            sub={isOwned ? "ongoing cost + amortized hardware" : undefined}
            value={formatUsd(breakdown.totalMonthlyCost)}
          />
        </div>

        <p className="text-xs text-muted-foreground pt-2 border-t">
          Each tier is priced as {isOwned ? "amortized owned hardware" : "its own GPU rental"} sized
          to its share of volume. Escalation rate is a planning assumption - your actual
          complex-vs-simple split will vary by workload.
          {isOwned && ` ${OWNED_FINANCING_CAVEAT}`}
        </p>
      </CardContent>
    </Card>
  );
}
