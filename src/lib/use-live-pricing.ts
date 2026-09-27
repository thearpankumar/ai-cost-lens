"use client";

import { useEffect, useState } from "react";
import { COMMERCIAL_MODELS, PRICING_LAST_VERIFIED } from "@/lib/data/commercial-models";
import type { CommercialModel } from "@/lib/types";

interface PricingState {
  models: CommercialModel[];
  source: "live" | "fallback" | "loading";
  lastUpdated: string;
}

export function useLivePricing(): PricingState {
  const [state, setState] = useState<PricingState>({
    models: COMMERCIAL_MODELS,
    source: "loading",
    lastUpdated: PRICING_LAST_VERIFIED,
  });

  useEffect(() => {
    let cancelled = false;

    fetch("/api/pricing")
      .then((res) => {
        if (!res.ok) throw new Error("pricing fetch failed");
        return res.json();
      })
      .then((data: { models: CommercialModel[]; source: "live" | "fallback"; lastUpdated: string }) => {
        if (cancelled) return;
        setState({ models: data.models, source: data.source, lastUpdated: data.lastUpdated });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ models: COMMERCIAL_MODELS, source: "fallback", lastUpdated: PRICING_LAST_VERIFIED });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
