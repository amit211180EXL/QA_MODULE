/**
 * Estimates LLM call cost in US cents based on provider, model, and token counts.
 * Prices reflect public list pricing as of 2024-Q4.
 * Custom/self-hosted providers return 0 (cost unknown).
 */

interface ModelPricing {
  /** Cents per 1 million input tokens */
  inputCentsPerM: number;
  /** Cents per 1 million output tokens */
  outputCentsPerM: number;
}

/**
 * Prefix-matched pricing table. Keys are matched against the model name
 * using startsWith(), so `gpt-4o-2024-08-06` matches the `gpt-4o` entry.
 * Order matters — more specific prefixes must appear before generic ones.
 */
const PRICING_TABLE: Array<[prefix: string, pricing: ModelPricing]> = [
  // OpenAI GPT-4o family
  ['gpt-4o-mini', { inputCentsPerM: 15, outputCentsPerM: 60 }],
  ['gpt-4o', { inputCentsPerM: 500, outputCentsPerM: 1500 }],
  // OpenAI GPT-4 Turbo family
  ['gpt-4-turbo', { inputCentsPerM: 1000, outputCentsPerM: 3000 }],
  ['gpt-4-32k', { inputCentsPerM: 6000, outputCentsPerM: 12000 }],
  ['gpt-4', { inputCentsPerM: 3000, outputCentsPerM: 6000 }],
  // OpenAI GPT-3.5
  ['gpt-3.5-turbo', { inputCentsPerM: 50, outputCentsPerM: 150 }],
  // Anthropic Claude 3.5
  ['claude-3-5-sonnet', { inputCentsPerM: 300, outputCentsPerM: 1500 }],
  ['claude-3-5-haiku', { inputCentsPerM: 80, outputCentsPerM: 400 }],
  // Anthropic Claude 3
  ['claude-3-opus', { inputCentsPerM: 1500, outputCentsPerM: 7500 }],
  ['claude-3-sonnet', { inputCentsPerM: 300, outputCentsPerM: 1500 }],
  ['claude-3-haiku', { inputCentsPerM: 25, outputCentsPerM: 125 }],
];

/**
 * Returns the estimated cost in US cents (integer, rounded up).
 * Returns 0 for unknown models or custom/self-hosted providers.
 */
export function estimateCostCents(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  if (!model || (promptTokens === 0 && completionTokens === 0)) return 0;

  const lowerModel = model.toLowerCase();
  const pricing = PRICING_TABLE.find(([prefix]) => lowerModel.startsWith(prefix))?.[1];
  if (!pricing) return 0;

  const inputCost = (promptTokens / 1_000_000) * pricing.inputCentsPerM;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputCentsPerM;

  // Round up to the nearest cent so we never under-bill
  return Math.ceil(inputCost + outputCost);
}
