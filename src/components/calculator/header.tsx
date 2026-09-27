"use client";

import { Badge } from "@/components/ui/badge";
import { CircleDot, Sparkles } from "lucide-react";

export function CalculatorHeader({
  pricingSource,
  lastUpdated,
}: {
  pricingSource: "live" | "fallback" | "loading";
  lastUpdated: string;
}) {
  const date = new Date(lastUpdated);
  const dateLabel = Number.isNaN(date.getTime())
    ? lastUpdated
    : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_6px_16px_-4px_var(--brand-red)]">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">AI Cost Calculator</h1>
            <p className="text-muted-foreground mt-1 max-w-2xl">
              Estimate the monthly cost of using AI to process your documents and spreadsheets -
              whether through a provider&apos;s API or on your own GPU server.
            </p>
          </div>
        </div>
        <Badge variant="outline" className="gap-1.5 text-xs">
          <CircleDot
            className={
              "h-2.5 w-2.5 " +
              (pricingSource === "live"
                ? "text-emerald-500 fill-emerald-500"
                : "text-amber-500 fill-amber-500")
            }
          />
          {pricingSource === "live" ? "Live pricing" : "Reference pricing"} &middot; {dateLabel}
        </Badge>
      </div>

      {pricingSource === "fallback" && (
        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
          Live pricing from the provider API is temporarily unavailable. Figures shown are our
          manually verified reference pricing, current as of {dateLabel}.
        </p>
      )}
    </header>
  );
}
