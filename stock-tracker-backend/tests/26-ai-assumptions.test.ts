import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildHoldingReviewContext } from '../src/services/holding-review-context.js';
import { SEEDED_AI_ASSUMPTIONS } from '../src/services/ai-preferences.js';
import settingsRouter from '../src/routes/user-settings.js';
import { buildPortfolioInsightsFacts } from '../src/routes/portfolio-insights.js';
import { buildPortfolioSnapshot } from '../src/services/portfolio-snapshot.js';

const mocks = vi.hoisted(() => ({ query: vi.fn(), input: vi.fn() }));
vi.mock('../src/db/connection.js', () => ({
  getPool: () => ({ request: () => ({ input: mocks.input, query: mocks.query }) }),
}));
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const id = req.header('x-user-id');
  if (id) req.user = { id };
  next();
});
app.use('/settings', settingsRouter);

const context = {
  ticker: 'TEST', lotsCsv: '1,2,3,4', yearEndClose: 10,
  yearEndPriceDate: '2025-12-31', lastAcquisitionDate: '2026-09-25',
  lastDividendDate: '2026-09-25',
};
const purchase = {
  ticker: 'TEST', type: 'buy', quantity: 10, amount: 100,
  transactionDate: '2025-01-01', exchangeSourceQuantity: 0,
};

describe('holding loss-review context', () => {
  it('uses holding Yearly Gain/Loss, accounting for current-year buys, sells and reinvested dividends', () => {
    const rows = buildHoldingReviewContext([{ ticker: 'TEST', marketValue: 90 }], [
      purchase,
      { ...purchase, quantity: 5, amount: 50, transactionDate: '2026-01-01' },
      { ...purchase, type: 'sell', quantity: 2, amount: 30, transactionDate: '2026-02-01' },
      { ...purchase, type: 'div', quantity: 1, amount: 10, transactionDate: '2026-09-25' },
    ], [], [context], '2026-10-06');
    expect(rows[0]).toMatchObject({
      yearEndMarketValue: 100, netCurrentYearInvested: 30, yearlyGainLoss: -40,
      displayLotCount: 4, matchesLossReviewFilter: true,
      priorAcquisitionWindowClearsOn: '2026-10-26', daysUntilPriorAcquisitionWindowClears: 20,
      lastTrackedDividendDate: '2026-09-25', nextDeclaredDividendDate: null, daysUntilNextDividend: null,
      daysSinceLastDividend: 11,
    });
    expect(rows[0].washSaleEligibility).toContain('Cannot be established');
  });

  it('requires strictly more than three display lots and strictly negative YTD, not a stock price loss', () => {
    for (const [lotsCsv, value, matches] of [
      ['1,2,3', 90, false], ['1,2,3,4', 90, true],
      ['1,2,3,4', 100, false], ['1,2,3,4', 110, false],
      ['1,0,-1,invalid,2,3', 90, false],
    ] as const) {
      expect(buildHoldingReviewContext([{ ticker: 'TEST', marketValue: value }], [purchase], [],
        [{ ...context, lotsCsv }], '2026-10-06')[0].matchesLossReviewFilter).toBe(matches);
    }
  });

  it('keeps missing baseline/current values unknown and handles newly acquired holdings without a baseline', () => {
    const missing = buildHoldingReviewContext([{ ticker: 'TEST', marketValue: 90 }], [purchase], [],
      [{ ...context, yearEndClose: null }], '2026-10-06')[0];
    expect(missing.yearlyGainLoss).toBeNull();
    expect(missing.matchesLossReviewFilter).toBeNull();
    const newHolding = buildHoldingReviewContext([{ ticker: 'TEST', marketValue: 90 }],
      [{ ...purchase, transactionDate: '2026-01-01' }], [],
      [{ ...context, yearEndClose: null }], '2026-10-06')[0];
    expect(newHolding.yearlyGainLoss).toBe(-10);
    expect(buildHoldingReviewContext([{ ticker: 'TEST', marketValue: null }], [purchase], [],
      [context], '2026-10-06')[0].matchesLossReviewFilter).toBeNull();
  });

  it('uses active splits only through prior year-end and subtracts exchanged source shares', () => {
    const result = buildHoldingReviewContext([{ ticker: 'TEST', marketValue: 90 }], [
      purchase,
      { ...purchase, type: 'exchange', quantity: null, amount: null, exchangeSourceQuantity: 2, transactionDate: '2025-06-01' },
    ], [
      { ticker: 'TEST', splitDate: '2025-03-01', multiplier: 2 },
      { ticker: 'TEST', splitDate: '2026-03-01', multiplier: 5 },
    ], [context], '2026-10-06')[0];
    expect(result.yearEndMarketValue).toBe(180);
    expect(result.yearlyGainLoss).toBe(-90);
  });

  it('clears the prior acquisition window after day 30, not on day 30, without asserting eligibility', () => {
    const row = { ...context, lastAcquisitionDate: '2026-09-06' };
    expect(buildHoldingReviewContext([{ ticker: 'TEST', marketValue: 90 }], [purchase], [],
      [row], '2026-10-06')[0].daysUntilPriorAcquisitionWindowClears).toBe(1);
    expect(buildHoldingReviewContext([{ ticker: 'TEST', marketValue: 90 }], [purchase], [],
      [row], '2026-10-07')[0].daysUntilPriorAcquisitionWindowClears).toBe(0);
  });

  it('handles today, old and missing dividends and prefers a verified future date over the fallback', () => {
    const build = (row: typeof context & { nextDeclaredDividendDate?: string | null }) =>
      buildHoldingReviewContext([{ ticker: 'TEST', marketValue: 90 }], [purchase], [], [row], '2026-10-06')[0];
    expect(build({ ...context, lastDividendDate: '2026-10-06', lastAcquisitionDate: '2026-10-06' }))
      .toMatchObject({ daysSinceLastDividend: 0, daysUntilPriorAcquisitionWindowClears: 31 });
    expect(build({ ...context, lastDividendDate: '2025-10-06', lastAcquisitionDate: '2025-10-06' }))
      .toMatchObject({ daysSinceLastDividend: 365, daysUntilPriorAcquisitionWindowClears: 0 });
    expect(build({ ...context, lastDividendDate: null, lastAcquisitionDate: null }))
      .toMatchObject({ daysSinceLastDividend: null, daysUntilPriorAcquisitionWindowClears: null });
    expect(build({ ...context, nextDeclaredDividendDate: '2026-10-11' }))
      .toMatchObject({ daysUntilNextDividend: 5, daysSinceLastDividend: 11 });
    expect(build({ ...context, nextDeclaredDividendDate: '2026-10-05' }).daysUntilNextDividend).toBeNull();
  });

  it('filters loss facts before their eight-item cap while preserving full holdings and concentration facts', () => {
    const rows = [
      ...Array.from({ length: 9 }, () => ({
        ticker: 'EXCLUDED', sourceType: 'purchase', purchaseDate: '2025-01-01',
        remainingQuantity: 1, unitCost: 1000, closePrice: 10, marketDate: '2026-10-06', recentAcquisitionCount: 0,
      })),
      { ticker: 'TEST', sourceType: 'purchase', purchaseDate: '2025-01-01',
        remainingQuantity: 10, unitCost: 10, closePrice: 9, marketDate: '2026-10-06', recentAcquisitionCount: 0 },
    ];
    const snapshot = {
      ...buildPortfolioSnapshot(rows, {
        deposits: 0, withdrawals: 0, interest: 0, fees: 0, buys: 0, sells: 0,
        availableCash: 0, costBasis: 0, adjustments: 0,
      }, '2026-10-06'),
      assumptions: SEEDED_AI_ASSUMPTIONS,
      holdingReviewContext: buildHoldingReviewContext([{ ticker: 'TEST', marketValue: 90 }], [purchase], [], [context], '2026-10-06'),
    };
    const facts = buildPortfolioInsightsFacts(rows, new Date('2026-10-06'), snapshot);
    expect(snapshot.holdings).toHaveLength(2);
    expect(facts.filter((fact) => fact.type === 'unrealized_loss_lot').map((fact) => fact.ticker)).toEqual(['TEST']);
    expect(facts.some((fact) => fact.type === 'concentration' && fact.ticker === 'EXCLUDED')).toBe(true);
  });
});

describe('per-user saved assumptions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.input.mockImplementation(() => ({ input: mocks.input, query: mocks.query }));
  });

  it('loads the user-scoped seed, which includes horizon, scope and display-lot criteria', async () => {
    mocks.query.mockResolvedValueOnce({ recordset: [{ aiAssumptionsEnabled: true }] });
    const response = await request(app).get('/settings/ai-assumptions').set('x-user-id', 'owner').expect(200);
    expect(response.body.assumptions).toEqual(SEEDED_AI_ASSUMPTIONS);
    expect(response.body.assumptions.investmentHorizonYears).toBe(10);
    expect(response.body.assumptions.lossReview.minimumDisplayLots).toBe(4);
    expect(mocks.input.mock.calls[0][2]).toBe('owner');
  });

  it('enables and disables assumptions only for the authenticated insights-enabled user', async () => {
    mocks.query.mockResolvedValueOnce({ rowsAffected: [1] });
    const response = await request(app).put('/settings/ai-assumptions').set('x-user-id', 'owner')
      .send({ enabled: true, userId: 'someone-else' }).expect(200);
    expect(response.body.assumptions).toEqual(SEEDED_AI_ASSUMPTIONS);
    expect(mocks.query.mock.calls[0][0]).toContain('WHERE id = @userId AND aiInsightsEnabled = 1');
    expect(mocks.input.mock.calls[0][2]).toBe('owner');
    mocks.query.mockResolvedValueOnce({ rowsAffected: [1] });
    const disabled = await request(app).put('/settings/ai-assumptions').set('x-user-id', 'owner')
      .send({ enabled: false }).expect(200);
    expect(disabled.body.assumptions).toBeNull();
  });

  it('rejects anonymous, invalid and insights-disabled requests', async () => {
    await request(app).put('/settings/ai-assumptions').send({ enabled: true }).expect(401);
    await request(app).put('/settings/ai-assumptions').set('x-user-id', 'owner').send({ enabled: 'true' }).expect(400);
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.query.mockResolvedValueOnce({ rowsAffected: [0] });
    await request(app).put('/settings/ai-assumptions').set('x-user-id', 'owner').send({ enabled: true }).expect(403);
  });
});
