"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { DOC_SIZE_PRESETS, TASK_PRESETS } from "@/lib/data/constants";
import { formatNumber } from "@/lib/format";
import { getDocTokens } from "@/lib/calculations";
import type { WorkloadInputs } from "@/lib/types";

const QUICK_VOLUMES = [100, 1000, 10000, 50000];

interface WorkloadPanelProps {
  workload: WorkloadInputs;
  onChange: (next: WorkloadInputs) => void;
  showCaching: boolean;
  showBatchApi?: boolean;
}

export function WorkloadPanel({ workload, onChange, showCaching, showBatchApi = false }: WorkloadPanelProps) {
  const docTokens = getDocTokens(workload);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your workload</CardTitle>
        <CardDescription>
          Tell us what you&apos;re processing. Every estimate below updates instantly as you
          change this.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="docs-per-month">Documents per month</Label>
          <div className="flex items-center gap-2">
            <Input
              id="docs-per-month"
              type="number"
              min={1}
              value={workload.docsPerMonth}
              onChange={(e) =>
                onChange({ ...workload, docsPerMonth: Math.max(1, Number(e.target.value) || 0) })
              }
              className="max-w-[160px] tabular-nums"
            />
            <div className="flex flex-wrap gap-1.5">
              {QUICK_VOLUMES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onChange({ ...workload, docsPerMonth: v })}
                  className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  {formatNumber(v)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Typical document size</Label>
          <ToggleGroup
            type="single"
            value={workload.docSizePresetId}
            onValueChange={(v) => v && onChange({ ...workload, docSizePresetId: v })}
            className="flex-wrap justify-start"
          >
            {DOC_SIZE_PRESETS.map((preset) => (
              <ToggleGroupItem key={preset.id} value={preset.id} className="text-xs px-3">
                {preset.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            {DOC_SIZE_PRESETS.find((p) => p.id === workload.docSizePresetId)?.description}
            {workload.docSizePresetId === "custom" ? "" : ` · ~${formatNumber(docTokens)} tokens/document`}
          </p>
          {workload.docSizePresetId === "custom" && (
            <div className="space-y-1.5 pt-1">
              <Label htmlFor="custom-pages">Page count</Label>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Slider
                  id="custom-pages"
                  aria-label="Page count"
                  min={1}
                  max={200}
                  step={1}
                  value={[workload.customPages]}
                  onValueChange={([v]) => onChange({ ...workload, customPages: v })}
                  className="max-w-xs min-w-[120px] flex-1"
                />
                <span className="text-sm tabular-nums text-muted-foreground w-32 shrink-0">
                  {workload.customPages} pages (~{formatNumber(docTokens)} tokens)
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>What are you doing with each document?</Label>
          <Select
            value={workload.taskType}
            onValueChange={(v) => onChange({ ...workload, taskType: v as WorkloadInputs["taskType"] })}
          >
            <SelectTrigger className="w-full sm:w-[320px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_PRESETS.map((task) => (
                <SelectItem key={task.id} value={task.id}>
                  {task.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {TASK_PRESETS.find((t) => t.id === workload.taskType)?.description}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="calls-per-doc">AI calls per document</Label>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Slider
              id="calls-per-doc"
              aria-label="AI calls per document"
              min={1}
              max={5}
              step={1}
              value={[workload.callsPerDoc]}
              onValueChange={([v]) => onChange({ ...workload, callsPerDoc: v })}
              className="max-w-xs min-w-[120px] flex-1"
            />
            <span className="text-sm tabular-nums text-muted-foreground w-8 shrink-0 whitespace-nowrap">
              {workload.callsPerDoc}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Increase this if your workflow calls the model more than once per document (e.g.
            extract, then validate, then summarize).
          </p>
        </div>

        {showCaching && (
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <Label htmlFor="use-caching" className="text-sm">
                Use prompt caching
              </Label>
              <p className="text-xs text-muted-foreground">
                Reuse repeated instructions/templates at a discounted rate, where the provider
                supports it.
              </p>
            </div>
            <Switch
              id="use-caching"
              checked={workload.useCaching}
              onCheckedChange={(checked) => onChange({ ...workload, useCaching: checked })}
            />
          </div>
        )}

        {showBatchApi && (
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="use-batch-api" className="text-sm">
                  Use Batch API pricing (~50% off, results within 24h)
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    <p>
                      OpenAI, Anthropic and AWS Bedrock offer asynchronous batch endpoints at
                      roughly half the normal per-token price, in exchange for results within
                      24 hours instead of immediately. Not every model or provider supports a
                      batch endpoint - check yours before relying on this.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="text-xs text-muted-foreground">
                A good fit for overnight or back-office document pipelines that don&apos;t need
                instant answers.
              </p>
            </div>
            <Switch
              id="use-batch-api"
              checked={workload.useBatchApi}
              onCheckedChange={(checked) => onChange({ ...workload, useBatchApi: checked })}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
