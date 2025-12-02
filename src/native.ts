/**
 * Native module loader with TypeScript fallback
 * 
 * Attempts to load the native Rust core module, falls back to
 * pure TypeScript implementation if not available.
 */

import type {
  TokenContributionData,
  GraphOptions as TSGraphOptions,
} from "./graph-types.js";

// Types from native module
interface NativeGraphOptions {
  homeDir?: string;
  sources?: string[];
  since?: string;
  until?: string;
  year?: string;
  threads?: number;
}

interface NativeScanStats {
  opencodeFiles: number;
  claudeFiles: number;
  codexFiles: number;
  geminiFiles: number;
  totalFiles: number;
}

interface NativeTokenBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
}

interface NativeDailyTotals {
  tokens: number;
  cost: number;
  messages: number;
}

interface NativeSourceContribution {
  source: string;
  modelId: string;
  providerId: string;
  tokens: NativeTokenBreakdown;
  cost: number;
  messages: number;
}

interface NativeDailyContribution {
  date: string;
  totals: NativeDailyTotals;
  intensity: number;
  tokenBreakdown: NativeTokenBreakdown;
  sources: NativeSourceContribution[];
}

interface NativeYearSummary {
  year: string;
  totalTokens: number;
  totalCost: number;
  rangeStart: string;
  rangeEnd: string;
}

interface NativeDataSummary {
  totalTokens: number;
  totalCost: number;
  totalDays: number;
  activeDays: number;
  averagePerDay: number;
  maxCostInSingleDay: number;
  sources: string[];
  models: string[];
}

interface NativeGraphMeta {
  generatedAt: string;
  version: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  processingTimeMs: number;
}

interface NativeGraphResult {
  meta: NativeGraphMeta;
  summary: NativeDataSummary;
  years: NativeYearSummary[];
  contributions: NativeDailyContribution[];
}

interface NativeCore {
  version(): string;
  healthCheck(): string;
  generateGraph(options: NativeGraphOptions): NativeGraphResult;
  scanSessions(homeDir?: string, sources?: string[]): NativeScanStats;
}

// Try to load native module
let nativeCore: NativeCore | null = null;
let loadError: Error | null = null;

try {
  // Try to load from the core directory (development)
  const corePath = new URL("../core/index.js", import.meta.url);
  nativeCore = await import(corePath.href).then((m) => m.default || m);
} catch (e) {
  try {
    // Try to load from node_modules (production)
    // @ts-ignore - optional dependency
    nativeCore = await import("@token-tracker/core").then((m) => m.default || m);
  } catch (e2) {
    loadError = e2 as Error;
  }
}

/**
 * Check if native module is available
 */
export function isNativeAvailable(): boolean {
  return nativeCore !== null;
}

/**
 * Get native module load error (if any)
 */
export function getNativeLoadError(): Error | null {
  return loadError;
}

/**
 * Get native module version
 */
export function getNativeVersion(): string | null {
  return nativeCore?.version() ?? null;
}

/**
 * Convert TypeScript graph options to native format
 */
function toNativeOptions(options: TSGraphOptions): NativeGraphOptions {
  return {
    homeDir: undefined, // Use default
    sources: options.sources,
    since: options.since,
    until: options.until,
    year: options.year,
  };
}

/**
 * Convert native result to TypeScript format
 */
function fromNativeResult(result: NativeGraphResult): TokenContributionData {
  return {
    meta: {
      generatedAt: result.meta.generatedAt,
      version: result.meta.version,
      dateRange: {
        start: result.meta.dateRangeStart,
        end: result.meta.dateRangeEnd,
      },
    },
    summary: {
      totalTokens: result.summary.totalTokens,
      totalCost: result.summary.totalCost,
      totalDays: result.summary.totalDays,
      activeDays: result.summary.activeDays,
      averagePerDay: result.summary.averagePerDay,
      maxCostInSingleDay: result.summary.maxCostInSingleDay,
      sources: result.summary.sources as any[],
      models: result.summary.models,
    },
    years: result.years.map((y) => ({
      year: y.year,
      totalTokens: y.totalTokens,
      totalCost: y.totalCost,
      range: {
        start: y.rangeStart,
        end: y.rangeEnd,
      },
    })),
    contributions: result.contributions.map((c) => ({
      date: c.date,
      totals: {
        tokens: c.totals.tokens,
        cost: c.totals.cost,
        messages: c.totals.messages,
      },
      intensity: c.intensity as 0 | 1 | 2 | 3 | 4,
      tokenBreakdown: {
        input: c.tokenBreakdown.input,
        output: c.tokenBreakdown.output,
        cacheRead: c.tokenBreakdown.cacheRead,
        cacheWrite: c.tokenBreakdown.cacheWrite,
        reasoning: c.tokenBreakdown.reasoning,
      },
      sources: c.sources.map((s) => ({
        source: s.source as any,
        modelId: s.modelId,
        providerId: s.providerId,
        tokens: {
          input: s.tokens.input,
          output: s.tokens.output,
          cacheRead: s.tokens.cacheRead,
          cacheWrite: s.tokens.cacheWrite,
          reasoning: s.tokens.reasoning,
        },
        cost: s.cost,
        messages: s.messages,
      })),
    })),
  };
}

/**
 * Generate graph data using native module
 * Throws if native module is not available
 */
export function generateGraphNative(options: TSGraphOptions = {}): TokenContributionData {
  if (!nativeCore) {
    throw new Error("Native module not available: " + (loadError?.message || "unknown error"));
  }
  
  const nativeOptions = toNativeOptions(options);
  const result = nativeCore.generateGraph(nativeOptions);
  return fromNativeResult(result);
}

/**
 * Get processing time from last native call (in milliseconds)
 */
export function getLastProcessingTimeMs(result: TokenContributionData): number | null {
  // The native module adds processingTimeMs but we don't expose it in the TS type
  // This is a helper to get it if needed
  return (result.meta as any).processingTimeMs ?? null;
}

/**
 * Scan sessions using native module
 */
export function scanSessionsNative(homeDir?: string, sources?: string[]): NativeScanStats | null {
  if (!nativeCore) {
    return null;
  }
  return nativeCore.scanSessions(homeDir, sources);
}
