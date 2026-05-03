export type ModelProvider = 'deepseek' | 'gemini';

export interface ModelOption {
  id: string;
  label: string;
  provider: ModelProvider;
  tier?: 'free' | 'paid' | 'preview';
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'deepseek', tier: 'paid' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'deepseek', tier: 'paid' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (Free)', provider: 'gemini', tier: 'free' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Free)', provider: 'gemini', tier: 'free' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini', tier: 'paid' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Free)', provider: 'gemini', tier: 'free' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite (Free)', provider: 'gemini', tier: 'free' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Free)', provider: 'gemini', tier: 'free' },
  { id: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash-8B (Free)', provider: 'gemini', tier: 'free' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', provider: 'gemini', tier: 'paid' },
];

export const DEFAULT_MODEL_ID = 'deepseek-v4-pro';
export const DEFAULT_FALLBACK_MODEL_ID = 'deepseek-v4-flash';
export const PROVIDER_FALLBACK_MODEL_IDS: Record<ModelProvider, string[]> = {
  deepseek: ['deepseek-v4-flash'],
  gemini: ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash-8b'],
};

export function resolveModelOption(modelId: string | undefined | null): ModelOption {
  return MODEL_OPTIONS.find((option) => option.id === modelId) ?? MODEL_OPTIONS[0];
}

export function isSupportedModel(modelId: string): boolean {
  return MODEL_OPTIONS.some((option) => option.id === modelId);
}

export function resolveModelId(modelId: string | undefined | null): string {
  return resolveModelOption(modelId).id;
}

export function getFallbackModelIds(modelId: string): string[] {
  const option = resolveModelOption(modelId);
  return PROVIDER_FALLBACK_MODEL_IDS[option.provider].filter((id) => id !== option.id);
}
