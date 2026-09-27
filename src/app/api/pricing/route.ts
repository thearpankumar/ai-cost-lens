import { NextResponse } from "next/server";
import { COMMERCIAL_MODELS, PRICING_LAST_VERIFIED } from "@/lib/data/commercial-models";
import type { CommercialModel } from "@/lib/types";

export const revalidate = 3600; // re-check OpenRouter at most once per hour

interface OpenRouterModel {
  id: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
  };
}

interface PricingResponse {
  models: CommercialModel[];
  source: "live" | "fallback";
  lastUpdated: string;
}

export async function GET() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      next: { revalidate: 3600 },
      headers: { Accept: "application/json" },
    });

    if (!res.ok) throw new Error(`OpenRouter responded ${res.status}`);

    const json = (await res.json()) as { data?: OpenRouterModel[] };
    const rows = json.data ?? [];
    const byId = new Map(rows.map((r) => [r.id, r]));

    const merged: CommercialModel[] = COMMERCIAL_MODELS.map((curated) => {
      const live = byId.get(curated.id);
      if (!live?.pricing?.prompt || !live?.pricing?.completion) return curated;

      const inputPricePerM = Number(live.pricing.prompt) * 1_000_000;
      const outputPricePerM = Number(live.pricing.completion) * 1_000_000;
      if (!Number.isFinite(inputPricePerM) || !Number.isFinite(outputPricePerM)) return curated;

      return {
        ...curated,
        inputPricePerM,
        outputPricePerM,
        cachedInputPricePerM: live.pricing.input_cache_read
          ? Number(live.pricing.input_cache_read) * 1_000_000
          : curated.cachedInputPricePerM,
        contextWindow: live.context_length ?? curated.contextWindow,
      };
    });

    const body: PricingResponse = {
      models: merged,
      source: "live",
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json(body, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=3600" },
    });
  } catch {
    const body: PricingResponse = {
      models: COMMERCIAL_MODELS,
      source: "fallback",
      lastUpdated: PRICING_LAST_VERIFIED,
    };
    return NextResponse.json(body);
  }
}
