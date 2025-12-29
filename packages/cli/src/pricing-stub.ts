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
  private lookupResults: Map<string, PricingLookupResult> = new Map();

  /** @deprecated Use fetchPricingForModels() instead */
  async fetchPricing(): Promise<void> {}

  async fetchPricingForModels(modelIds: string[]): Promise<void> {
    if (modelIds.length === 0) return;

    const uniqueModels = [...new Set(modelIds)];
    
    try {
      const core = await import("@tokscale/core");
      
      const results = await Promise.allSettled(
        uniqueModels.map(async (modelId) => {
          try {
            const result = await core.lookupPricing(modelId);
            return { modelId, result };
          } catch {
            return { modelId, result: null };
          }
        })
      );

      for (const settledResult of results) {
        if (settledResult.status === "fulfilled") {
          const { modelId, result } = settledResult.value;
          if (result) {
            const pricing: ModelPricing = {
              input_cost_per_token: result.pricing.inputCostPerToken,
              output_cost_per_token: result.pricing.outputCostPerToken,
              cache_read_input_token_cost: result.pricing.cacheReadInputTokenCost,
              cache_creation_input_token_cost: result.pricing.cacheCreationInputTokenCost,
            };
            this.pricingData.set(modelId, pricing);
            this.lookupResults.set(modelId, {
              matchedKey: result.matchedKey,
              source: result.source as "litellm" | "openrouter",
              pricing,
            });
          }
        }
      }
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
    return this.lookupResults.get(modelId) ?? null;
  }

  getModelPricingFromProvider(
    modelId: string,
    provider: "litellm" | "openrouter"
  ): PricingLookupResult | null {
    const result = this.lookupResults.get(modelId);
    if (result && (provider === result.source || provider === "litellm")) {
      return result;
    }
    return null;
  }
}
