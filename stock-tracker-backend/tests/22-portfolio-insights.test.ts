import { describe, expect, it } from 'vitest';
import { buildPortfolioInsightsFacts } from '../src/routes/portfolio-insights.js';

describe('portfolio insights fact construction', () => {
  it('reports concentrated positions, open-lot losses, and holdings without stored prices', () => {
    const facts = buildPortfolioInsightsFacts([
      {
        ticker: 'AAPL',
        sourceType: 'purchase',
        purchaseDate: '2026-08-27T00:00:00.000Z',
        remainingQuantity: 1,
        unitCost: 200,
        closePrice: 100,
        marketDate: '2026-09-25',
        recentAcquisitionCount: 1,
      },
      {
        ticker: 'MSFT',
        sourceType: 'purchase',
        purchaseDate: '2025-09-26T00:00:00.000Z',
        remainingQuantity: 3,
        unitCost: 50,
        closePrice: 100,
        marketDate: '2026-09-25',
        recentAcquisitionCount: 0,
      },
      {
        ticker: 'NOQ',
        sourceType: 'purchase',
        purchaseDate: '2026-01-01T00:00:00.000Z',
        remainingQuantity: 2,
        unitCost: 10,
        closePrice: null,
        marketDate: null,
        recentAcquisitionCount: 0,
      },
    ], new Date('2026-09-26T00:00:00.000Z'));

    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'concentration-MSFT',
        type: 'concentration',
        percentOfEquities: 75,
        marketValue: 300,
      }),
      expect.objectContaining({
        id: 'loss-lot-1',
        type: 'unrealized_loss_lot',
        ticker: 'AAPL',
        unrealizedLoss: 100,
        recentAcquisitionCount: 1,
      }),
      expect.objectContaining({
        id: 'missing-price-NOQ',
        type: 'missing_price',
      }),
    ]));
  });
});