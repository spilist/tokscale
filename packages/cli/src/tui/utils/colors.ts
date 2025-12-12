export const PROVIDER_COLORS = {
  anthropic: "#FF6B35",
  openai: "#10B981",
  google: "#3B82F6",
  cursor: "#8B5CF6",
  opencode: "#6B7280",
  deepseek: "#06B6D4",
  xai: "#EAB308",
  meta: "#6366F1",
  unknown: "#FFFFFF",
} as const;

export type ProviderType = keyof typeof PROVIDER_COLORS;

export function getProviderFromModel(modelId: string): ProviderType {
  const lower = modelId.toLowerCase();
  if (/claude|sonnet|opus|haiku/.test(lower)) return "anthropic";
  if (/gpt|^o1|^o3|codex|text-embedding|dall-e|whisper|tts/.test(lower)) return "openai";
  if (/gemini/.test(lower)) return "google";
  if (/deepseek/.test(lower)) return "deepseek";
  if (/grok/.test(lower)) return "xai";
  if (/llama|mixtral/.test(lower)) return "meta";
  if (/^auto$|cursor/.test(lower)) return "cursor";
  return "unknown";
}

export function getModelColor(modelId: string): string {
  return PROVIDER_COLORS[getProviderFromModel(modelId)];
}
