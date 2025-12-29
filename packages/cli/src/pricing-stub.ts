import type { PricingEntry, PricingLookupResult as NativePricingLookupResult } from "@tokscale/core";

export interface ModelPricing {
  input_cost_per_token: number | null;
  output_cost_per_token: number | null;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
}

export interface PricingLookupResult {
  matchedKey: string;
  source: "litellm" | "openrouter";
  pricing: ModelPricing;
}

export class PricingFetcher {
  private pricingData: Map<string, ModelPricing> = new Map();

  async fetchPricing(): Promise<void> {
    try {
      await import("@tokscale/core");
    } catch {}
  }

  toPricingEntries(): PricingEntry[] {
    const entries: PricingEntry[] = [];
    for (const [modelId, pricing] of this.pricingData) {
      entries.push({
        modelId,
        pricing: {
          inputCostPerToken: pricing.input_cost_per_token ?? 0,
          outputCostPerToken: pricing.output_cost_per_token ?? 0,
          cacheReadInputTokenCost: pricing.cache_read_input_token_cost,
          cacheCreationInputTokenCost: pricing.cache_creation_input_token_cost,
        },
      });
    }
    return entries;
  }

  getModelPricingWithSource(modelId: string): PricingLookupResult | null {
    const pricing = this.pricingData.get(modelId);
    if (pricing) {
      return { matchedKey: modelId, source: "litellm", pricing };
    }
    return null;
  }

  getModelPricingFromProvider(
    modelId: string,
    provider: "litellm" | "openrouter"
  ): PricingLookupResult | null {
    return this.getModelPricingWithSource(modelId);
  }
}
