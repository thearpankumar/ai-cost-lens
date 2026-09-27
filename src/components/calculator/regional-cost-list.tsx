import { REGIONS } from "@/lib/data/regions";
import { formatNumber, formatUsd } from "@/lib/format";
import type { RegionId } from "@/lib/types";

export interface RegionalCostRow {
  regionId: RegionId;
  docsPerMonth: number;
  totalMonthlyCost: number;
}

export function RegionalCostList({ rows }: { rows: RegionalCostRow[] }) {
  if (rows.length <= 1) return null;

  return (
    <div className="space-y-1.5 rounded-md border p-3">
      <p className="text-xs font-medium text-muted-foreground">By region</p>
      {rows.map((row) => {
        const region = REGIONS.find((r) => r.id === row.regionId);
        return (
          <div key={row.regionId} className="flex items-center justify-between text-sm">
            <span>
              {region?.label ?? row.regionId}{" "}
              <span className="text-xs text-muted-foreground">
                ({formatNumber(row.docsPerMonth)} docs/mo)
              </span>
            </span>
            <span className="tabular-nums font-medium">{formatUsd(row.totalMonthlyCost)}</span>
          </div>
        );
      })}
    </div>
  );
}
