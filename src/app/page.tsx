"use client";

import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalculatorHeader } from "@/components/calculator/header";
import { WorkloadPanel } from "@/components/calculator/workload-panel";
import { CommercialModelCatalog } from "@/components/calculator/commercial-model-catalog";
import { OpenSourceModelCatalog } from "@/components/calculator/opensource-model-catalog";
import { HostingSelector, type SelfHostConfig } from "@/components/calculator/hosting-selector";
import { SmartRoutingPanel } from "@/components/calculator/smart-routing-panel";
import { SelfHostRoutingPanel } from "@/components/calculator/self-host-routing-panel";
import { RegionSelector } from "@/components/calculator/region-selector";
import {
  ApiBreakdownPanel,
  RoutedApiBreakdownPanel,
  RoutedSelfHostBreakdownPanel,
  SelfHostBreakdownPanel,
} from "@/components/calculator/breakdown-panel";
import { useLivePricing } from "@/lib/use-live-pricing";
import { OPEN_SOURCE_MODELS } from "@/lib/data/opensource-models";
import { GPU_INSTANCES, OWNED_GPU_SPECS, CLOUD_OPS_OVERHEAD_DEFAULT_PCT } from "@/lib/data/gpu-instances";
import { ROUTER_OPTIONS, DEFAULT_ESCALATION_RATE_PCT } from "@/lib/data/routing";
import { REGIONS, DATA_RESIDENCY_PREMIUM_PCT } from "@/lib/data/regions";
import {
  aggregateApiBreakdowns,
  aggregateRoutedApiBreakdowns,
  aggregateRoutedSelfHostBreakdowns,
  aggregateSelfHostBreakdowns,
  calculateApiCost,
  calculateRoutedApiCost,
  calculateRoutedSelfHostCost,
  calculateSelfHostCost,
  checkContextWindowFit,
  estimateSelfHostMonthlyCost,
  getModelsCheaperThan,
  getOpenSourceModelsCheaperThan,
  scaleRoutedSelfHostBreakdown,
  scaleSelfHostBreakdown,
  splitDocsAcrossRegions,
  withDataResidencyPremium,
  type HostParams,
} from "@/lib/calculations";
import { COMMERCIAL_MODELS } from "@/lib/data/commercial-models";
import type { ContextWindowWarning } from "@/components/calculator/breakdown-panel";
import type { CalcMode, RegionAllocation, RegionId, RoutingConfig, WorkloadInputs } from "@/lib/types";

const DEFAULT_WORKLOAD: WorkloadInputs = {
  docsPerMonth: 1000,
  docSizePresetId: "medium",
  customPages: 8,
  taskType: "extraction",
  callsPerDoc: 1,
  useCaching: true,
};

const DEFAULT_COMMERCIAL_MODEL_ID = "anthropic/claude-sonnet-5";
const DEFAULT_OPEN_SOURCE_MODEL_ID = "llama-3.3-70b";

// Pick the cheapest model in the static catalog (excluding the default main
// model) as the default "Low" routing tier, so routing decreases cost out of
// the box rather than depending on a hardcoded id that might not be cheaper.
const DEFAULT_SMALL_MODEL_ID = [...COMMERCIAL_MODELS]
  .filter((m) => m.id !== DEFAULT_COMMERCIAL_MODEL_ID)
  .sort((a, b) => a.inputPricePerM - b.inputPricePerM)[0].id;

const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  enabled: false,
  router: "laya",
  escalationRatePct: DEFAULT_ESCALATION_RATE_PCT,
  smallModelId: DEFAULT_SMALL_MODEL_ID,
  mediumModelId: null,
  mediumRatePct: 0,
};

// Smallest-parameter open-source model (excluding the default main model) as
// a reasonable static default Low tier for self-hosted routing.
const DEFAULT_SELF_HOST_SMALL_MODEL_ID = [...OPEN_SOURCE_MODELS]
  .filter((m) => m.id !== DEFAULT_OPEN_SOURCE_MODEL_ID)
  .sort((a, b) => a.paramsB - b.paramsB)[0].id;

const DEFAULT_SELF_HOST_ROUTING_CONFIG: RoutingConfig = {
  enabled: false,
  router: "laya",
  escalationRatePct: DEFAULT_ESCALATION_RATE_PCT,
  smallModelId: DEFAULT_SELF_HOST_SMALL_MODEL_ID,
  mediumModelId: null,
  mediumRatePct: 0,
};

function defaultHostConfig(): SelfHostConfig {
  const model = OPEN_SOURCE_MODELS.find((m) => m.id === DEFAULT_OPEN_SOURCE_MODEL_ID)!;
  const awsMatch = GPU_INSTANCES.find((i) => i.cloud === "AWS" && i.gpuType === model.minGpuType);
  const awsFallback = GPU_INSTANCES.find((i) => i.cloud === "AWS");
  return {
    location: "cloud",
    cloudProvider: "AWS",
    gpuInstanceId: (awsMatch ?? awsFallback)!.id,
    useReservedPricing: false,
    ownedGpuType: model.minGpuType,
    hoursPerDay: 24,
    depreciationYears: 3,
    opsOverheadPct: CLOUD_OPS_OVERHEAD_DEFAULT_PCT,
  };
}

export default function Home() {
  const { models: commercialModels, source, lastUpdated } = useLivePricing();

  const [mode, setMode] = useState<CalcMode>("self-host");
  const [workload, setWorkload] = useState<WorkloadInputs>(DEFAULT_WORKLOAD);
  const [selectedCommercialId, setSelectedCommercialId] = useState(DEFAULT_COMMERCIAL_MODEL_ID);
  const [selectedOpenSourceId, setSelectedOpenSourceId] = useState(DEFAULT_OPEN_SOURCE_MODEL_ID);
  const [hostConfig, setHostConfig] = useState<SelfHostConfig>(defaultHostConfig);
  const [routingConfig, setRoutingConfig] = useState<RoutingConfig>(DEFAULT_ROUTING_CONFIG);
  const [selfHostRoutingConfig, setSelfHostRoutingConfig] = useState<RoutingConfig>(
    DEFAULT_SELF_HOST_ROUTING_CONFIG,
  );
  const [selectedRegions, setSelectedRegions] = useState<RegionId[]>(["us"]);
  const [useDataResidency, setUseDataResidency] = useState(false);

  // A multi-region compliance deployment implies you need guaranteed data
  // residency, not just geographic routing - so once more than one region is
  // selected, the residency premium applies automatically rather than
  // requiring the user to separately remember to flip a second switch.
  const dataResidencyAutoApplied = selectedRegions.length > 1;
  const effectiveDataResidency = useDataResidency || dataResidencyAutoApplied;

  const regionDocsSplit = useMemo(
    () => splitDocsAcrossRegions(workload.docsPerMonth, selectedRegions.length),
    [workload.docsPerMonth, selectedRegions.length],
  );

  const selectedCommercialModel =
    commercialModels.find((m) => m.id === selectedCommercialId) ?? commercialModels[0];

  const selectedOpenSourceModel =
    OPEN_SOURCE_MODELS.find((m) => m.id === selectedOpenSourceId) ?? OPEN_SOURCE_MODELS[0];

  const selectedSmallModel =
    commercialModels.find((m) => m.id === routingConfig.smallModelId) ?? commercialModels[0];

  const selectedMediumModel = routingConfig.mediumModelId
    ? (commercialModels.find((m) => m.id === routingConfig.mediumModelId) ?? null)
    : null;

  const selectedRouter =
    ROUTER_OPTIONS.find((r) => r.id === routingConfig.router) ?? ROUTER_OPTIONS[0];

  const selectedSelfHostSmallModel =
    OPEN_SOURCE_MODELS.find((m) => m.id === selfHostRoutingConfig.smallModelId) ?? OPEN_SOURCE_MODELS[0];

  const selectedSelfHostMediumModel = selfHostRoutingConfig.mediumModelId
    ? (OPEN_SOURCE_MODELS.find((m) => m.id === selfHostRoutingConfig.mediumModelId) ?? null)
    : null;

  const layaRouter = ROUTER_OPTIONS.find((r) => r.id === "laya")!;

  // Structural guardrail: if the main model changes such that the current
  // Low/Medium routing tier is no longer cheaper than it, auto-correct to a
  // valid selection instead of silently allowing routing to cost more.
  // Adjusted synchronously during render (React's recommended pattern for
  // "reset state when a dependency changes") rather than in an effect, so the
  // correction lands in the same commit instead of an extra render pass.
  const cheaperThanBig = useMemo(
    () => getModelsCheaperThan(workload, commercialModels, selectedCommercialModel),
    [workload, commercialModels, selectedCommercialModel],
  );
  const cheaperThanBigKey = cheaperThanBig
    .map((m) => m.id)
    .sort()
    .join("|");
  const [lastCheaperKey, setLastCheaperKey] = useState(cheaperThanBigKey);

  if (cheaperThanBigKey !== lastCheaperKey) {
    setLastCheaperKey(cheaperThanBigKey);
    if (cheaperThanBig.length === 0) {
      if (routingConfig.enabled) {
        setRoutingConfig({ ...routingConfig, enabled: false });
      }
    } else {
      const cheapestId = [...cheaperThanBig].sort((a, b) => a.inputPricePerM - b.inputPricePerM)[0].id;
      let next = routingConfig;
      if (!cheaperThanBig.some((m) => m.id === next.smallModelId)) {
        next = { ...next, smallModelId: cheapestId };
      }
      if (next.mediumModelId && !cheaperThanBig.some((m) => m.id === next.mediumModelId)) {
        next = { ...next, mediumModelId: null, mediumRatePct: 0 };
      }
      if (next !== routingConfig) setRoutingConfig(next);
    }
  }

  // Same structural guardrail, for self-hosted routing: only open-source
  // models genuinely cheaper to self-host than the selected "High" model are
  // valid Low/Medium tiers.
  const cheaperOssThanHigh = useMemo(
    () => getOpenSourceModelsCheaperThan(workload, OPEN_SOURCE_MODELS, selectedOpenSourceModel),
    [workload, selectedOpenSourceModel],
  );
  const cheaperOssKey = cheaperOssThanHigh
    .map((m) => m.id)
    .sort()
    .join("|");
  const [lastCheaperOssKey, setLastCheaperOssKey] = useState(cheaperOssKey);

  if (cheaperOssKey !== lastCheaperOssKey) {
    setLastCheaperOssKey(cheaperOssKey);
    if (cheaperOssThanHigh.length === 0) {
      if (selfHostRoutingConfig.enabled) {
        setSelfHostRoutingConfig({ ...selfHostRoutingConfig, enabled: false });
      }
    } else {
      const cheapestId = [...cheaperOssThanHigh].sort(
        (a, b) => estimateSelfHostMonthlyCost(workload, a) - estimateSelfHostMonthlyCost(workload, b),
      )[0].id;
      let next = selfHostRoutingConfig;
      if (!cheaperOssThanHigh.some((m) => m.id === next.smallModelId)) {
        next = { ...next, smallModelId: cheapestId };
      }
      if (next.mediumModelId && !cheaperOssThanHigh.some((m) => m.id === next.mediumModelId)) {
        next = { ...next, mediumModelId: null, mediumRatePct: 0 };
      }
      if (next !== selfHostRoutingConfig) setSelfHostRoutingConfig(next);
    }
  }

  const apiAllocations = useMemo<RegionAllocation<ReturnType<typeof calculateApiCost>>[]>(
    () =>
      selectedRegions.map((regionId, i) => {
        const docsPerMonth = regionDocsSplit[i];
        const regionalWorkload = { ...workload, docsPerMonth };
        const model = effectiveDataResidency
          ? withDataResidencyPremium(selectedCommercialModel, DATA_RESIDENCY_PREMIUM_PCT)
          : selectedCommercialModel;
        return { regionId, docsPerMonth, breakdown: calculateApiCost(regionalWorkload, model) };
      }),
    [selectedRegions, regionDocsSplit, workload, selectedCommercialModel, effectiveDataResidency],
  );

  const apiBreakdown = useMemo(() => aggregateApiBreakdowns(apiAllocations), [apiAllocations]);

  const routedAllocations = useMemo<RegionAllocation<ReturnType<typeof calculateRoutedApiCost>>[]>(
    () =>
      selectedRegions.map((regionId, i) => {
        const docsPerMonth = regionDocsSplit[i];
        const regionalWorkload = { ...workload, docsPerMonth };
        const big = effectiveDataResidency
          ? withDataResidencyPremium(selectedCommercialModel, DATA_RESIDENCY_PREMIUM_PCT)
          : selectedCommercialModel;
        const small = effectiveDataResidency
          ? withDataResidencyPremium(selectedSmallModel, DATA_RESIDENCY_PREMIUM_PCT)
          : selectedSmallModel;
        const medium = selectedMediumModel
          ? effectiveDataResidency
            ? withDataResidencyPremium(selectedMediumModel, DATA_RESIDENCY_PREMIUM_PCT)
            : selectedMediumModel
          : null;
        return {
          regionId,
          docsPerMonth,
          breakdown: calculateRoutedApiCost(
            regionalWorkload,
            big,
            small,
            selectedRouter,
            routingConfig.escalationRatePct,
            medium,
            routingConfig.mediumRatePct,
          ),
        };
      }),
    [
      selectedRegions,
      regionDocsSplit,
      workload,
      selectedCommercialModel,
      selectedSmallModel,
      selectedMediumModel,
      selectedRouter,
      routingConfig.escalationRatePct,
      routingConfig.mediumRatePct,
      effectiveDataResidency,
    ],
  );

  const routedBreakdown = useMemo(
    () => aggregateRoutedApiBreakdowns(routedAllocations),
    [routedAllocations],
  );

  const regionalApiRows = useMemo(
    () => apiAllocations.map((a) => ({ regionId: a.regionId, docsPerMonth: a.docsPerMonth, totalMonthlyCost: a.breakdown.totalMonthlyCost })),
    [apiAllocations],
  );

  const regionalRoutedRows = useMemo(
    () => routedAllocations.map((a) => ({ regionId: a.regionId, docsPerMonth: a.docsPerMonth, totalMonthlyCost: a.breakdown.totalMonthlyCost })),
    [routedAllocations],
  );

  const selectedGpuInstance = GPU_INSTANCES.find((i) => i.id === hostConfig.gpuInstanceId)!;

  const hostParams: HostParams = useMemo(() => {
    if (hostConfig.location === "cloud") {
      return {
        kind: "cloud",
        gpuInstance: selectedGpuInstance,
        useReservedPricing: hostConfig.useReservedPricing,
        opsOverheadPct: hostConfig.opsOverheadPct,
      };
    }
    const ownedSpec = OWNED_GPU_SPECS.find((s) => s.gpuType === hostConfig.ownedGpuType)!;
    return {
      kind: "owned",
      ownedGpu: ownedSpec,
      hoursPerMonth: hostConfig.hoursPerDay * 30,
      opsOverheadPct: hostConfig.opsOverheadPct,
      depreciationYears: hostConfig.depreciationYears,
    };
  }, [hostConfig, selectedGpuInstance]);

  const selfHostAllocations = useMemo<RegionAllocation<ReturnType<typeof calculateSelfHostCost>>[]>(
    () =>
      selectedRegions.map((regionId, i) => {
        const docsPerMonth = regionDocsSplit[i];
        const regionalWorkload = { ...workload, docsPerMonth };
        const base = calculateSelfHostCost(regionalWorkload, selectedOpenSourceModel, hostParams);
        const multiplier = REGIONS.find((r) => r.id === regionId)?.gpuPriceMultiplier ?? 1;
        const breakdown = scaleSelfHostBreakdown(base, multiplier, docsPerMonth);
        return { regionId, docsPerMonth, breakdown };
      }),
    [selectedRegions, regionDocsSplit, workload, selectedOpenSourceModel, hostParams],
  );

  const selfHostBreakdown = useMemo(
    () => aggregateSelfHostBreakdowns(selfHostAllocations),
    [selfHostAllocations],
  );

  const regionalSelfHostRows = useMemo(
    () => selfHostAllocations.map((a) => ({ regionId: a.regionId, docsPerMonth: a.docsPerMonth, totalMonthlyCost: a.breakdown.totalMonthlyCost })),
    [selfHostAllocations],
  );

  // Derives hosting for a routing tier's model using the same cloud/pricing
  // settings as the main HostingSelector, but matched to that tier's own
  // recommended GPU type rather than the main model's.
  function hostParamsForModel(model: (typeof OPEN_SOURCE_MODELS)[number]): HostParams {
    if (hostConfig.location === "cloud") {
      const match = GPU_INSTANCES.find(
        (i) => i.cloud === hostConfig.cloudProvider && i.gpuType === model.minGpuType,
      );
      const fallback = GPU_INSTANCES.find((i) => i.gpuType === model.minGpuType) ?? selectedGpuInstance;
      return {
        kind: "cloud",
        gpuInstance: match ?? fallback,
        useReservedPricing: hostConfig.useReservedPricing,
        opsOverheadPct: hostConfig.opsOverheadPct,
      };
    }
    const ownedSpec =
      OWNED_GPU_SPECS.find((s) => s.gpuType === model.minGpuType) ??
      OWNED_GPU_SPECS.find((s) => s.gpuType === hostConfig.ownedGpuType)!;
    return {
      kind: "owned",
      ownedGpu: ownedSpec,
      hoursPerMonth: hostConfig.hoursPerDay * 30,
      opsOverheadPct: hostConfig.opsOverheadPct,
      depreciationYears: hostConfig.depreciationYears,
    };
  }

  const selfHostRoutedAllocations = useMemo<RegionAllocation<ReturnType<typeof calculateRoutedSelfHostCost>>[]>(
    () =>
      selectedRegions.map((regionId, i) => {
        const docsPerMonth = regionDocsSplit[i];
        const regionalWorkload = { ...workload, docsPerMonth };
        const highTier = { model: selectedOpenSourceModel, hostParams: hostParamsForModel(selectedOpenSourceModel) };
        const lowTier = {
          model: selectedSelfHostSmallModel,
          hostParams: hostParamsForModel(selectedSelfHostSmallModel),
        };
        const mediumTier = selectedSelfHostMediumModel
          ? { model: selectedSelfHostMediumModel, hostParams: hostParamsForModel(selectedSelfHostMediumModel) }
          : null;
        const base = calculateRoutedSelfHostCost(
          regionalWorkload,
          highTier,
          lowTier,
          layaRouter,
          selfHostRoutingConfig.escalationRatePct,
          mediumTier,
          selfHostRoutingConfig.mediumRatePct,
        );
        const multiplier = REGIONS.find((r) => r.id === regionId)?.gpuPriceMultiplier ?? 1;
        const breakdown = scaleRoutedSelfHostBreakdown(base, multiplier, docsPerMonth);
        return { regionId, docsPerMonth, breakdown };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hostParamsForModel closes over hostConfig, already a dep
    [
      selectedRegions,
      regionDocsSplit,
      workload,
      selectedOpenSourceModel,
      selectedSelfHostSmallModel,
      selectedSelfHostMediumModel,
      layaRouter,
      selfHostRoutingConfig.escalationRatePct,
      selfHostRoutingConfig.mediumRatePct,
      hostConfig,
    ],
  );

  const selfHostRoutedBreakdown = useMemo(
    () => aggregateRoutedSelfHostBreakdowns(selfHostRoutedAllocations),
    [selfHostRoutedAllocations],
  );

  const regionalSelfHostRoutedRows = useMemo(
    () =>
      selfHostRoutedAllocations.map((a) => ({
        regionId: a.regionId,
        docsPerMonth: a.docsPerMonth,
        totalMonthlyCost: a.breakdown.totalMonthlyCost,
      })),
    [selfHostRoutedAllocations],
  );

  const apiContextWarning: ContextWindowWarning | undefined = useMemo(() => {
    const check = checkContextWindowFit(workload, selectedCommercialModel.contextWindow);
    if (check.fits && !check.nearLimit) return undefined;
    return {
      modelName: selectedCommercialModel.name,
      inputTokensPerCall: check.inputTokensPerCall,
      contextWindow: selectedCommercialModel.contextWindow,
      exceeds: !check.fits,
    };
  }, [workload, selectedCommercialModel]);

  const routedContextWarning: ContextWindowWarning | undefined = useMemo(() => {
    const tightest =
      selectedSmallModel.contextWindow < selectedCommercialModel.contextWindow
        ? selectedSmallModel
        : selectedCommercialModel;
    const check = checkContextWindowFit(workload, tightest.contextWindow);
    if (check.fits && !check.nearLimit) return undefined;
    return {
      modelName: tightest.name,
      inputTokensPerCall: check.inputTokensPerCall,
      contextWindow: tightest.contextWindow,
      exceeds: !check.fits,
    };
  }, [workload, selectedCommercialModel, selectedSmallModel]);

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <CalculatorHeader pricingSource={source} lastUpdated={lastUpdated} />

      <Tabs value={mode} onValueChange={(v) => setMode(v as CalcMode)}>
        <TabsList>
          <TabsTrigger value="self-host">Self-hosted GPU server</TabsTrigger>
          <TabsTrigger value="api">Pay-per-use API</TabsTrigger>
        </TabsList>

        <TabsContent value="self-host" className="mt-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <WorkloadPanel workload={workload} onChange={setWorkload} showCaching={false} />
              <RegionSelector selectedRegions={selectedRegions} onChange={setSelectedRegions} />
              <OpenSourceModelCatalog
                models={OPEN_SOURCE_MODELS}
                workload={workload}
                selectedId={selectedOpenSourceModel.id}
                onSelect={setSelectedOpenSourceId}
              />
              <HostingSelector
                config={hostConfig}
                onChange={setHostConfig}
                model={selectedOpenSourceModel}
              />
              <SelfHostRoutingPanel
                config={selfHostRoutingConfig}
                onChange={setSelfHostRoutingConfig}
                models={OPEN_SOURCE_MODELS}
                workload={workload}
                highModel={selectedOpenSourceModel}
              />
            </div>
            <div className="lg:col-span-1">
              {selfHostRoutingConfig.enabled ? (
                <RoutedSelfHostBreakdownPanel
                  highModel={selectedOpenSourceModel}
                  mediumModel={selectedSelfHostMediumModel}
                  lowModel={selectedSelfHostSmallModel}
                  isOwned={hostConfig.location === "owned"}
                  breakdown={selfHostRoutedBreakdown}
                  regionalBreakdowns={regionalSelfHostRoutedRows}
                />
              ) : (
                <SelfHostBreakdownPanel
                  model={selectedOpenSourceModel}
                  breakdown={selfHostBreakdown}
                  isOwned={hostConfig.location === "owned"}
                  locationLabel={
                    hostConfig.location === "cloud"
                      ? `${hostConfig.cloudProvider} (${selectedGpuInstance.gpuType})`
                      : `your own ${hostConfig.ownedGpuType} server`
                  }
                  regionalBreakdowns={regionalSelfHostRows}
                />
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="api" className="mt-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <WorkloadPanel workload={workload} onChange={setWorkload} showCaching />
              <RegionSelector
                selectedRegions={selectedRegions}
                onChange={setSelectedRegions}
                showDataResidencyToggle
                useDataResidency={effectiveDataResidency}
                onDataResidencyChange={setUseDataResidency}
                dataResidencyAutoApplied={dataResidencyAutoApplied}
              />
              <CommercialModelCatalog
                models={commercialModels}
                workload={workload}
                selectedId={selectedCommercialModel.id}
                onSelect={setSelectedCommercialId}
              />
              <SmartRoutingPanel
                config={routingConfig}
                onChange={setRoutingConfig}
                models={commercialModels}
                workload={workload}
                bigModel={selectedCommercialModel}
              />
            </div>
            <div className="lg:col-span-1">
              {routingConfig.enabled ? (
                <RoutedApiBreakdownPanel
                  bigModel={selectedCommercialModel}
                  mediumModel={selectedMediumModel}
                  smallModel={selectedSmallModel}
                  routerName={selectedRouter.name}
                  breakdown={routedBreakdown}
                  regionalBreakdowns={regionalRoutedRows}
                  contextWarning={routedContextWarning}
                />
              ) : (
                <ApiBreakdownPanel
                  model={selectedCommercialModel}
                  breakdown={apiBreakdown}
                  regionalBreakdowns={regionalApiRows}
                  contextWarning={apiContextWarning}
                />
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <footer className="text-xs text-muted-foreground border-t pt-4 pb-2 space-y-1">
        <p>
          All figures are planning estimates, not quotes. They are based on public list pricing,
          published hardware specs, and standard industry assumptions, and do not include taxes,
          data transfer, storage, negotiated enterprise discounts, or provider-specific fees.
        </p>
        <p>Commercial API pricing updates automatically when available; open-source model and GPU pricing is a periodically refreshed snapshot.</p>
        <p>
          Regional GPU price multipliers are representative estimates derived from published Azure
          pricing and applied across clouds for planning purposes - actual regional premiums vary
          by provider. Not every model is available in every compliance region on enterprise routes
          (e.g. AWS Bedrock, Azure OpenAI, Vertex AI); confirm availability with your provider.
        </p>
        <p>
          Provider and model-family logos are trademarks of their respective owners, shown solely
          to identify which company a listed model belongs to.
        </p>
      </footer>
    </div>
  );
}
