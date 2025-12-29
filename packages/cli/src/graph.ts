/**
 * Graph data generation module
 * Aggregates token usage data by date for contribution graph visualization
 *
 * Key design: intensity is calculated based on COST ($), not tokens
 * 
 * Native Rust implementation required - no TypeScript fallback
 */

import type {
  TokenContributionData,
  GraphOptions,
} from "./graph-types.js";

let nativeModule: typeof import("./native.js") | null = null;
try {
  nativeModule = await import("./native.js");
} catch {}

export function isNativeAvailable(): boolean {
  return nativeModule?.isNativeAvailable() ?? false;
}

export async function generateGraphData(
  options: GraphOptions = {}
): Promise<TokenContributionData> {
  if (!nativeModule?.isNativeAvailable()) {
    throw new Error("Native module required. Run: bun run build:core");
  }
  return nativeModule.generateGraphNative(options);
}
