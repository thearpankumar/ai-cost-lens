import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/pricing/route";
import { COMMERCIAL_MODELS } from "@/lib/data/commercial-models";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("GET /api/pricing", () => {
  it("merges live OpenRouter pricing onto the curated model list when the fetch succeeds", async () => {
    const targetId = COMMERCIAL_MODELS[0].id;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: targetId,
            context_length: 999_999,
            pricing: { prompt: "0.000003", completion: "0.000015", input_cache_read: "0.0000003" },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const res = await GET();
    const body = await res.json();

    expect(body.source).toBe("live");
    const updated = body.models.find((m: { id: string }) => m.id === targetId);
    expect(updated.inputPricePerM).toBeCloseTo(3, 5);
    expect(updated.outputPricePerM).toBeCloseTo(15, 5);
    expect(updated.cachedInputPricePerM).toBeCloseTo(0.3, 5);
    expect(updated.contextWindow).toBe(999_999);
    // Curated fields not present in the live payload should be preserved
    expect(updated.intelligenceScore).toBe(COMMERCIAL_MODELS[0].intelligenceScore);
  });

  it("keeps curated pricing for models the live source doesn't have", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    }) as unknown as typeof fetch;

    const res = await GET();
    const body = await res.json();

    expect(body.models).toEqual(COMMERCIAL_MODELS);
  });

  it("falls back to the curated snapshot when the fetch fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const res = await GET();
    const body = await res.json();

    expect(body.source).toBe("fallback");
    expect(body.models).toEqual(COMMERCIAL_MODELS);
  });

  it("falls back to the curated snapshot when the response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const res = await GET();
    const body = await res.json();

    expect(body.source).toBe("fallback");
  });
});
