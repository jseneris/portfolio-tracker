import { describe, expect, it } from 'vitest';
import { calculateRecommendedLotAmount, getLotPurchase, MINIMUM_LOT_AMOUNT } from '../src/services/recommended-lot-amount.js';

describe('recommended lot amount', () => {
  it('buys one share above X and the fewest whole shares reaching X below it', () => {
    expect(getLotPurchase(400, 300)).toEqual({ shares: 1, cost: 400 });
    expect(getLotPurchase(300, 300)).toEqual({ shares: 1, cost: 300 });
    expect(getLotPurchase(40, 300)).toEqual({ shares: 8, cost: 320 });
    expect(getLotPurchase(50, 300)).toEqual({ shares: 6, cost: 300 });
  });

  it('finds the largest $50 step that buys every holding up to +1 weight', () => {
    const result = calculateRecommendedLotAmount([
      { ticker: 'OVER', closePrice: 10, displayLotCount: 4, baseSize: 3 }, // +1: none
      { ticker: 'ZERO', closePrice: 40, displayLotCount: 3, baseSize: 3 }, // 0: one lot
      { ticker: 'MINUS', closePrice: 500, displayLotCount: 2, baseSize: 3 }, // -1: two lots
    ], 2000);
    // X=500: ZERO 13 x $40 = $520, MINUS 2 lots x 1 share x $500 = $1000 -> $1520
    // X=550: ZERO 14 x $40 = $560, MINUS 2 lots x 2 shares x $500 = $2000 -> $2560 > $2000
    expect(result.lotAmount).toBe(500);
    expect(result.totalCost).toBe(1520);
    expect(result.nextSteps).toEqual([
      { lotAmount: 550, totalCost: 2560, shortfall: 560 },
      { lotAmount: 600, totalCost: 2600, shortfall: 600 },
      { lotAmount: 650, totalCost: 2680, shortfall: 680 },
      { lotAmount: 700, totalCost: 2720, shortfall: 720 },
      { lotAmount: 750, totalCost: 2760, shortfall: 760 },
    ]);
    expect(result.holdings.map((holding) => [holding.ticker, holding.weight, holding.lotsNeeded, holding.totalCost])).toEqual([
      ['MINUS', -1, 2, 1000], ['ZERO', 0, 1, 520], ['OVER', 1, 0, 0],
    ]);
  });

  it('returns no amount when nothing is needed or cash cannot cover the first step', () => {
    expect(calculateRecommendedLotAmount([{ ticker: 'A', closePrice: 10, displayLotCount: 5, baseSize: 3 }], 1000).lotAmount).toBeNull();
    expect(calculateRecommendedLotAmount([{ ticker: 'A', closePrice: 10, displayLotCount: 5, baseSize: 3 }], 1000).nextSteps).toEqual([]);
    const short = calculateRecommendedLotAmount([{ ticker: 'A', closePrice: 10, displayLotCount: 3, baseSize: 3 }], 40);
    expect(short.lotAmount).toBeNull();
    expect(short.nextSteps.map((step) => step.lotAmount)).toEqual([250, 300, 350, 400, 450]);
    expect(short.nextSteps[0]).toEqual({ lotAmount: 250, totalCost: 250, shortfall: 210 });
  });

  it('starts the recommended amount at $250 and counts only lots above +1 base', () => {
    expect(MINIMUM_LOT_AMOUNT).toBe(250);
    const result = calculateRecommendedLotAmount([
      { ticker: 'TWO', closePrice: 10, displayLotCount: 5, baseSize: 3 },
      { ticker: 'THREE', closePrice: 10, displayLotCount: 6, baseSize: 3 },
      { ticker: 'ONE', closePrice: 10, displayLotCount: 4, baseSize: 3 },
      { ticker: 'ZERO', closePrice: 10, displayLotCount: 3, baseSize: 3 },
    ], 1000);
    expect(result.lotAmount).toBe(1000);
    expect(result.totalLotsAbovePlusOne).toBe(3);
    expect(result.holdings.map(({ ticker, weight, lotsAbovePlusOne }) => [ticker, weight, lotsAbovePlusOne])).toEqual([
      ['ZERO', 0, 0], ['ONE', 1, 0], ['TWO', 2, 1], ['THREE', 3, 2],
    ]);
  });

  it('does not recommend amounts below $250 even when cash covers a smaller amount', () => {
    const result = calculateRecommendedLotAmount([{ ticker: 'A', closePrice: 10, displayLotCount: 3, baseSize: 3 }], 200);
    expect(result.lotAmount).toBeNull();
    expect(result.nextSteps[0]).toEqual({ lotAmount: 250, totalCost: 250, shortfall: 50 });
  });

  it('reports unpriced holdings that need lots without blocking the others', () => {
    const result = calculateRecommendedLotAmount([
      { ticker: 'NOPRICE', closePrice: null, displayLotCount: 0, baseSize: 3 },
      { ticker: 'A', closePrice: 25, displayLotCount: 3, baseSize: 3 },
    ], 300);
    expect(result.unpricedTickers).toEqual(['NOPRICE']);
    expect(result.lotAmount).toBe(300);
    expect(result.holdings.find((holding) => holding.ticker === 'NOPRICE')?.totalCost).toBeNull();
  });
});
