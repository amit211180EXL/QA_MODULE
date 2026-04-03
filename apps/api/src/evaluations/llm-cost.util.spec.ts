// Unit tests for estimateCostCents — pure function, no mocks needed.

import { estimateCostCents } from './llm-cost.util';

describe('estimateCostCents', () => {
  // ─── Zero cases ────────────────────────────────────────────────────────────

  it('returns 0 for empty model string', () => {
    expect(estimateCostCents('OPENAI', '', 1000, 200)).toBe(0);
  });

  it('returns 0 when promptTokens is 0', () => {
    expect(estimateCostCents('OPENAI', 'gpt-4o', 0, 0)).toBe(0);
  });

  it('returns 0 for unknown model', () => {
    expect(estimateCostCents('CUSTOM', 'llama-3-custom', 1_000_000, 1_000_000)).toBe(0);
  });

  // ─── GPT-4o-mini ───────────────────────────────────────────────────────────

  describe('gpt-4o-mini', () => {
    it('calculates cost at $0.15/M input + $0.60/M output', () => {
      // 1M input + 1M output at 15¢/M input and 60¢/M output = 75¢
      const cost = estimateCostCents('OPENAI', 'gpt-4o-mini', 1_000_000, 1_000_000);
      expect(cost).toBe(75);
    });

    it('handles small token counts without returning negative values', () => {
      const cost = estimateCostCents('OPENAI', 'gpt-4o-mini', 100, 50);
      expect(cost).toBeGreaterThanOrEqual(0);
    });

    it('rounds up fractional cents', () => {
      // 1 token at $0.15/M = 0.000015¢ → rounds up to 1¢
      const cost = estimateCostCents('OPENAI', 'gpt-4o-mini', 1, 0);
      expect(cost).toBe(1);
    });
  });

  // ─── GPT-4o ────────────────────────────────────────────────────────────────

  describe('gpt-4o', () => {
    it('calculates at $5.00/M input + $15.00/M output', () => {
      // 1M input + 1M output = 500 + 1500 = 2000¢
      expect(estimateCostCents('OPENAI', 'gpt-4o', 1_000_000, 1_000_000)).toBe(2000);
    });

    it('gpt-4o-2024-08-06 matches gpt-4o prefix', () => {
      // model names with date suffix still match gpt-4o pricing
      expect(estimateCostCents('OPENAI', 'gpt-4o-2024-08-06', 500_000, 500_000)).toBe(1000);
    });

    it('gpt-4o-mini prefix takes priority over gpt-4o', () => {
      // gpt-4o-mini should use the cheaper pricing, not gpt-4o
      const miniCost = estimateCostCents('OPENAI', 'gpt-4o-mini', 1_000_000, 0);
      const fullCost = estimateCostCents('OPENAI', 'gpt-4o', 1_000_000, 0);
      expect(miniCost).toBeLessThan(fullCost);
    });
  });

  // ─── GPT-4 Turbo ───────────────────────────────────────────────────────────

  describe('gpt-4-turbo', () => {
    it('returns correct cost at $10/M input + $30/M output', () => {
      expect(estimateCostCents('OPENAI', 'gpt-4-turbo', 1_000_000, 1_000_000)).toBe(4000);
    });
  });

  // ─── GPT-3.5 ───────────────────────────────────────────────────────────────

  describe('gpt-3.5-turbo', () => {
    it('calculates at $0.50/M input + $1.50/M output', () => {
      expect(estimateCostCents('OPENAI', 'gpt-3.5-turbo', 1_000_000, 1_000_000)).toBe(200);
    });
  });

  // ─── Claude models ─────────────────────────────────────────────────────────

  describe('claude-3-5-sonnet', () => {
    it('calculates at $3.00/M input + $15.00/M output', () => {
      expect(estimateCostCents('ANTHROPIC', 'claude-3-5-sonnet-20241022', 1_000_000, 1_000_000)).toBe(1800);
    });
  });

  describe('claude-3-haiku', () => {
    it('is cheaper than claude-3-sonnet', () => {
      const haiku = estimateCostCents('ANTHROPIC', 'claude-3-haiku-20240307', 500_000, 500_000);
      const sonnet = estimateCostCents('ANTHROPIC', 'claude-3-sonnet-20240229', 500_000, 500_000);
      expect(haiku).toBeLessThan(sonnet);
    });
  });

  // ─── Case insensitivity ────────────────────────────────────────────────────

  it('matches model names case-insensitively', () => {
    const lower = estimateCostCents('OPENAI', 'gpt-4o-mini', 100_000, 10_000);
    const upper = estimateCostCents('OPENAI', 'GPT-4O-MINI', 100_000, 10_000);
    expect(lower).toBe(upper);
  });

  // ─── Only completion tokens ────────────────────────────────────────────────

  it('accounts for completion-only tokens', () => {
    const withCompletion = estimateCostCents('OPENAI', 'gpt-4o', 0, 1_000_000);
    expect(withCompletion).toBe(1500);
  });
});
