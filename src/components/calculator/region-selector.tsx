"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { REGIONS, DATA_RESIDENCY_PREMIUM_PCT } from "@/lib/data/regions";
import { formatPercent } from "@/lib/format";
import type { RegionId } from "@/lib/types";
import { Globe2, Info } from "lucide-react";

interface RegionSelectorProps {
  selectedRegions: RegionId[];
  onChange: (regions: RegionId[]) => void;
  showDataResidencyToggle?: boolean;
  useDataResidency?: boolean;
  onDataResidencyChange?: (value: boolean) => void;
  dataResidencyAutoApplied?: boolean;
}

export function RegionSelector({
  selectedRegions,
  onChange,
  showDataResidencyToggle = false,
  useDataResidency = false,
  onDataResidencyChange,
  dataResidencyAutoApplied = false,
}: RegionSelectorProps) {
  const handleValueChange = (value: string[]) => {
    if (value.length === 0) return; // keep at least one region selected
    onChange(value as RegionId[]);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Compliance regions</CardTitle>
        </div>
        <CardDescription>
          Select every region you need a separate deployment in for data-residency or compliance
          reasons. Your document volume is split evenly across the regions you pick, and each one
          is costed independently - compliance deployments don&apos;t share infrastructure across
          borders.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ToggleGroup
          type="multiple"
          value={selectedRegions}
          onValueChange={handleValueChange}
          className="flex-wrap justify-start"
        >
          {REGIONS.map((region) => (
            <Tooltip key={region.id}>
              <TooltipTrigger asChild>
                <ToggleGroupItem value={region.id} className="px-3 text-xs">
                  {region.label}
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent className="max-w-56">
                <p>
                  {region.exampleLocations}. {region.blurb}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>

        <ul className="space-y-1 text-xs text-muted-foreground">
          {REGIONS.filter((r) => selectedRegions.includes(r.id)).map((region) => (
            <li key={region.id}>
              <span className="font-medium text-foreground">{region.label}:</span>{" "}
              {region.exampleLocations}. {region.blurb}
            </li>
          ))}
        </ul>

        {selectedRegions.length > 1 && (
          <p className="text-xs text-muted-foreground">
            Deploying to {selectedRegions.length} regions - volume and cost are shown per region
            below, with a combined total in the summary panel. Not every model is available in
            every region on enterprise routes (e.g. AWS Bedrock, Azure OpenAI, Vertex AI) - confirm
            availability with your provider before committing.
          </p>
        )}

        {showDataResidencyToggle && (
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <Label htmlFor="data-residency" className="text-sm flex items-center gap-1.5">
                Route through regional data-residency endpoints
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    <p>
                      Direct provider APIs are priced the same worldwide. Enterprise
                      data-residency deployments (e.g. Azure OpenAI Data Zone, or a provider&apos;s
                      own regional residency option) carry a confirmed pricing premium instead.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <p className="text-xs text-muted-foreground">
                {dataResidencyAutoApplied ? (
                  <>
                    Automatically applied because you&apos;re deploying to multiple compliance
                    regions - a genuine multi-region deployment implies you need guaranteed data
                    residency, not just geographic convenience.
                  </>
                ) : (
                  <>
                    Adds a {formatPercent(DATA_RESIDENCY_PREMIUM_PCT * 100)} premium per region for
                    guaranteed data residency. Off by default - most providers price direct API
                    access the same globally.
                  </>
                )}
              </p>
            </div>
            <Switch
              id="data-residency"
              checked={useDataResidency}
              disabled={dataResidencyAutoApplied}
              onCheckedChange={onDataResidencyChange}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
