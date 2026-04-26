// Pricing per million tokens [inputUSD, outputUSD]
export const MODEL_PRICING: Record<string, [number, number]> = {
  'claude-opus-4-5':    [15,   75],
  'claude-sonnet-4-5':  [3,    15],
  'claude-sonnet-4-6':  [3,    15],
  'claude-haiku-4-5':   [0.25, 1.25],
}
export const DEFAULT_PRICING: [number, number] = [3, 15]

export function tokenCostUSD(inputTokens: number, outputTokens: number, model: string): number {
  const [priceIn, priceOut] = MODEL_PRICING[model] ?? DEFAULT_PRICING
  return (inputTokens / 1_000_000) * priceIn + (outputTokens / 1_000_000) * priceOut
}
