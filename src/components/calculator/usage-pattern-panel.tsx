"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TOK_PER_SEC_PER_USER_PRESETS } from "@/lib/data/constants";
import { getActiveHoursPerMonth } from "@/lib/calculations";
import { formatNumber } from "@/lib/format";
import type { CapacityProfile, ServingPattern } from "@/lib/types";

interface UsagePatternPanelProps {
  capacity: CapacityProfile;
  onChange: (next: CapacityProfile) => void;
}

export function UsagePatternPanel({ capacity, onChange }: UsagePatternPanelProps) {
  const isInteractive = capacity.pattern === "interactive";
  const isAlwaysOn = capacity.activeHoursPerDay === 24 && capacity.activeDaysPerWeek === 7;
  const activeHoursPerMonth = getActiveHoursPerMonth(capacity);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage pattern</CardTitle>
        <CardDescription>
          When does the model need to be working? GPUs are sized so your volume gets done inside
          this window (not spread evenly across every hour of the month) - by default, business
          hours: 10 hours a day, 5 days a week.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>How is it used?</Label>
          <ToggleGroup
            type="single"
            value={capacity.pattern}
            onValueChange={(v) => v && onChange({ ...capacity, pattern: v as ServingPattern })}
            className="w-full"
          >
            <ToggleGroupItem value="batch" className="flex-1">
              Batch pipeline
            </ToggleGroupItem>
            <ToggleGroupItem value="interactive" className="flex-1">
              Live users
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            {isInteractive
              ? "People are waiting on answers (e.g. an internal AI assistant) - sized for your busiest moment, so everyone gets a responsive experience."
              : "Documents are processed in the background - sized to finish your monthly volume within the active hours below."}
          </p>
        </div>

        <div className="space-y-2">
          <Label>Active hours per day</Label>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Slider
              aria-label="Active hours per day"
              min={1}
              max={24}
              step={1}
              value={[capacity.activeHoursPerDay]}
              onValueChange={([v]) => onChange({ ...capacity, activeHoursPerDay: v })}
              className="max-w-xs min-w-[120px] flex-1"
            />
            <span className="text-sm tabular-nums text-muted-foreground w-24 shrink-0 whitespace-nowrap">
              {capacity.activeHoursPerDay}h/day
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Active days per week</Label>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Slider
              aria-label="Active days per week"
              min={1}
              max={7}
              step={1}
              value={[capacity.activeDaysPerWeek]}
              onValueChange={([v]) => onChange({ ...capacity, activeDaysPerWeek: v })}
              className="max-w-xs min-w-[120px] flex-1"
            />
            <span className="text-sm tabular-nums text-muted-foreground w-24 shrink-0 whitespace-nowrap">
              {capacity.activeDaysPerWeek} day{capacity.activeDaysPerWeek > 1 ? "s" : ""}/wk
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onChange({ ...capacity, activeHoursPerDay: 10, activeDaysPerWeek: 5 })}
            className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            Business hours (10h x 5 days)
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...capacity, activeHoursPerDay: 24, activeDaysPerWeek: 7 })}
            aria-pressed={isAlwaysOn}
            className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            24/7 always-on
          </button>
          <span className="text-xs text-muted-foreground tabular-nums">
            ~{formatNumber(Math.round(activeHoursPerMonth))} active hours/month
          </span>
        </div>

        {isInteractive && (
          <div className="space-y-4 rounded-md border p-3">
            <div className="space-y-2">
              <Label htmlFor="peak-concurrent-users">People using it at the same time (peak)</Label>
              <Input
                id="peak-concurrent-users"
                type="number"
                min={1}
                value={capacity.peakConcurrentUsers}
                onChange={(e) =>
                  onChange({
                    ...capacity,
                    peakConcurrentUsers: Math.max(1, Math.round(Number(e.target.value) || 0)),
                  })
                }
                className="max-w-[160px] tabular-nums"
              />
              <p className="text-xs text-muted-foreground">
                Simultaneously waiting on a response at your busiest moment - usually a small
                fraction of total users.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Response speed per person</Label>
              <ToggleGroup
                type="single"
                value={String(capacity.targetTokPerSecPerUser)}
                onValueChange={(v) => v && onChange({ ...capacity, targetTokPerSecPerUser: Number(v) })}
                className="flex-wrap justify-start"
              >
                {TOK_PER_SEC_PER_USER_PRESETS.map((preset) => (
                  <ToggleGroupItem key={preset.value} value={String(preset.value)} className="text-xs px-3">
                    {preset.label} ({preset.value} tok/s)
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
