import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommercialModelCatalog } from "@/components/calculator/commercial-model-catalog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { COMMERCIAL_MODELS } from "@/lib/data/commercial-models";
import { DEFAULT_CAPACITY_PROFILE } from "@/lib/data/constants";
import { DATA_RESIDENCY_PREMIUM_PCT } from "@/lib/data/regions";
import type { CommercialModel, WorkloadInputs } from "@/lib/types";

const workload: WorkloadInputs = {
  docsPerMonth: 1000,
  docSizePresetId: "medium", // 8 pages
  customPages: 8,
  taskType: "extraction",
  callsPerDoc: 1,
  useCaching: false,
  useBatchApi: false,
  capacity: DEFAULT_CAPACITY_PROFILE,
};

const model: CommercialModel = {
  ...COMMERCIAL_MODELS[0],
  id: "test/catalog-model",
  name: "Catalog Test Model",
  inputPricePerM: 2,
  outputPricePerM: 10,
  cachedInputPricePerM: undefined,
  tokenizerMultiplier: undefined,
  goodFor: ["extraction"],
};

function renderCatalog(dataResidencyPremiumPct?: number) {
  return render(
    <TooltipProvider>
      <CommercialModelCatalog
        models={[model]}
        workload={workload}
        selectedId={model.id}
        onSelect={() => {}}
        dataResidencyPremiumPct={dataResidencyPremiumPct}
      />
    </TooltipProvider>,
  );
}

describe("CommercialModelCatalog - data residency premium (regression)", () => {
  it("prices cards without the premium when data residency is off", () => {
    renderCatalog(0);
    // 1000 calls * 5,950 input tokens = 5.95M * $2/M = $11.90
    // 1000 calls * 672 output tokens = 0.672M * $10/M = $6.72 -> $18.62/mo, $0.0186/doc
    expect(screen.getByText("$19")).toBeInTheDocument();
    expect(screen.getByText("$0.0186 per document")).toBeInTheDocument();
  });

  it("applies the same data-residency premium as the real breakdown when it is active", () => {
    expect(DATA_RESIDENCY_PREMIUM_PCT).toBe(0.1);
    renderCatalog(DATA_RESIDENCY_PREMIUM_PCT);
    // $18.62 * 1.10 = $20.482/mo -> "$20"; $0.020482/doc -> "$0.0205"
    // (previously the card kept showing $19 / $0.0186 regardless)
    expect(screen.getByText("$20")).toBeInTheDocument();
    expect(screen.getByText("$0.0205 per document")).toBeInTheDocument();
  });
});
