import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import insightsRouter from '../src/routes/portfolio-insights.js';
import cashRouter from '../src/routes/cash.js';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  input: vi.fn(),
  generate: vi.fn(),
  chat: vi.fn(),
}));
vi.mock('../src/db/connection.js', () => ({
  getPool: () => ({
    request: () => ({
      input: mocks.input,
      query: mocks.query,
    }),
  }),
}));
vi.mock('../src/services/copilot-insights.js', () => ({
  generateCopilotInsights: mocks.generate,
  askCopilotAboutInsights: mocks.chat,
}));

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const id = req.header('x-user-id');
  if (id) req.user = { id };
  next();
});
app.use('/insights', insightsRouter);
app.use('/cash', cashRouter);
const lots = [
  {
    ticker: 'BIG', sourceType: 'purchase', purchaseDate: '2026-01-01',
    remainingQuantity: 100, unitCost: 5, closePrice: 10, marketDate: '2026-09-25',
    recentAcquisitionCount: 0,
  },
  {
    ticker: 'SMALL', sourceType: 'dividend', purchaseDate: '2026-01-01',
    remainingQuantity: 1, unitCost: 0, closePrice: 10, marketDate: '2026-09-25',
    recentAcquisitionCount: 0, sector: 'Technology',
  },
];
let userSequence = 0;
function user() {
  return `snapshot-user-${++userSequence}`;
}
function queueCash() {
  mocks.query.mockResolvedValueOnce({ recordset: [{ deposits: 2000, withdrawals: 100, interest: 20, fees: 5 }] });
  mocks.query.mockResolvedValueOnce({ recordset: [{ buys: 500, sells: 50 }] });
}
function queueReview(rows = lots, assumptionsEnabled = false) {
  mocks.query.mockResolvedValueOnce({ recordset: [{ aiInsightsEnabled: true }] });
  mocks.query.mockResolvedValueOnce({ recordset: rows });
  queueCash();
  mocks.query.mockResolvedValueOnce({ recordset: [{ aiAssumptionsEnabled: assumptionsEnabled }] });
  mocks.query.mockResolvedValueOnce({ recordsets: [[{ ticker: 'BIG', lotsCsv: '1,2,3' }], [{ ticker: 'BIG', baseSize: 3 }]] });
}

describe('read-only portfolio snapshot routing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.input.mockImplementation(() => ({ input: mocks.input, query: mocks.query }));
    mocks.generate.mockResolvedValue('{"explanations":[]}');
    mocks.chat.mockResolvedValue('The SMALL holding is included.');
  });

  it('sends all holdings and cash to review and chat, using user-scoped SELECT queries only', async () => {
    const id = user();
    queueReview();
    const response = await request(app).post('/insights').set('x-user-id', id).expect(200);
    expect(response.body.snapshot.holdings.map((holding: { ticker: string }) => holding.ticker)).toEqual(['BIG', 'SMALL']);
    expect(response.body.snapshot.cash.availableCash).toBe(1465);
    expect(response.body.snapshot.recommendedLotAmount.holdings.map((holding: { ticker: string; weight: number }) => [holding.ticker, holding.weight]))
      .toEqual([['SMALL', -3], ['BIG', 0]]);
    const reviewPrompt = mocks.generate.mock.calls[0][0];
    expect(reviewPrompt).toContain('"ticker":"SMALL"');
    expect(reviewPrompt).toContain('"availableCash":1465');
    expect(reviewPrompt).not.toContain(id);
    expect(mocks.input.mock.calls.every(([name, _type, value]) => name === 'userId' && value === id)).toBe(true);
    for (const [query] of mocks.query.mock.calls) {
      expect(query).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE)\b/i);
      expect(query).toContain('@userId');
    }
    expect(mocks.query.mock.calls[2][0]).toContain('FROM CashTransactions');
    expect(mocks.query.mock.calls[3][0]).toContain("st.type = 'buy' AND e.targetTransactionId IS NULL");

    mocks.query.mockResolvedValueOnce({ recordset: [{ aiInsightsEnabled: true }] });
    await request(app).post('/insights/chat').set('x-user-id', id)
      .send({ reportId: response.body.reportId, question: 'Tell me about SMALL and my cash', history: [] }).expect(200);
    expect(mocks.chat.mock.calls[0][0]).toContain(JSON.stringify(response.body.snapshot));
    // Chat checks access but does not reload or mutate the cached snapshot.
    expect(mocks.query).toHaveBeenCalledTimes(7);

    mocks.query.mockResolvedValueOnce({ recordset: [{ aiInsightsEnabled: true }] });
    await request(app).post('/insights/chat').set('x-user-id', user())
      .send({ reportId: response.body.reportId, question: 'Show the snapshot', history: [] }).expect(404);
    expect(mocks.chat).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing cash-summary response shape and arithmetic', async () => {
    queueCash();
    const response = await request(app).get('/cash/summary').set('x-user-id', user()).expect(200);
    expect(response.body).toEqual({
      deposits: 2000, withdrawals: 100, interest: 20, fees: 5,
      buys: 500, sells: 50, availableCash: 1465, costBasis: 1900, adjustments: 15,
    });
  });

  it('returns full 8000-character answers and accepts them on the next follow-up', async () => {
    const id = user();
    queueReview();
    const review = await request(app).post('/insights').set('x-user-id', id).expect(200);
    const question = 'q'.repeat(2000);
    const answer = 'a'.repeat(8000);
    mocks.chat.mockResolvedValueOnce(answer);
    mocks.query.mockResolvedValueOnce({ recordset: [{ aiInsightsEnabled: true }] });
    const first = await request(app).post('/insights/chat').set('x-user-id', id)
      .send({ reportId: review.body.reportId, question, history: [] }).expect(200);
    expect(first.body.answer).toBe(answer);
    mocks.query.mockResolvedValueOnce({ recordset: [{ aiInsightsEnabled: true }] });
    await request(app).post('/insights/chat').set('x-user-id', id)
      .send({
        reportId: review.body.reportId, question: 'Explain further',
        history: [{ role: 'user', content: question }, { role: 'assistant', content: first.body.answer }],
      }).expect(200);
    expect(mocks.chat.mock.calls[1][0]).toContain(answer);
    expect(mocks.chat.mock.calls[1][0]).toContain('within 8000 characters');
  });

  it('includes saved assumptions and calculated filter/timing context in review and follow-up prompts', async () => {
    const id = user();
    queueReview(lots, true);
    mocks.query.mockResolvedValueOnce({ recordsets: [
      [{ ticker: 'BIG', type: 'buy', quantity: 100, amount: 500, transactionDate: '2025-01-01', exchangeSourceQuantity: 0 }],
      [],
      [
        { ticker: 'BIG', lotsCsv: '1,2,3,4', yearEndClose: 11, yearEndPriceDate: '2025-12-31',
          lastAcquisitionDate: '2026-10-01', lastDividendDate: '2026-10-01' },
        { ticker: 'SMALL', lotsCsv: '1,2,3', yearEndClose: null, yearEndPriceDate: null,
          lastAcquisitionDate: '2026-01-01', lastDividendDate: null },
      ],
    ] });
    const response = await request(app).post('/insights').set('x-user-id', id).expect(200);
    expect(response.body.snapshot.assumptions.investmentHorizonYears).toBe(10);
    expect(response.body.snapshot.holdingReviewContext[0]).toMatchObject({
      ticker: 'BIG', yearlyGainLoss: -100, displayLotCount: 4, matchesLossReviewFilter: true,
      priorAcquisitionWindowClearsOn: '2026-11-01', daysUntilNextDividend: null,
    });
    expect(response.body.snapshot.holdings).toHaveLength(2);
    expect(mocks.generate.mock.calls[0][0]).toContain('tracked stocks only');
    expect(mocks.generate.mock.calls[0][0]).toContain('"yearlyGainLoss":-100');
    mocks.query.mockResolvedValueOnce({ recordset: [{ aiInsightsEnabled: true }] });
    await request(app).post('/insights/chat').set('x-user-id', id)
      .send({ reportId: response.body.reportId, question: 'Explain my risk and loss timing', history: [] }).expect(200);
    expect(mocks.chat.mock.calls[0][0]).toContain('10-year investment horizon');
    expect(mocks.chat.mock.calls[0][0]).toContain(JSON.stringify(response.body.snapshot));
    expect(mocks.chat.mock.calls[0][0]).toContain('not confirmed tax eligibility');
    expect(mocks.chat.mock.calls[0][0]).toContain('once per ticker, not individual lots');
    expect(mocks.chat.mock.calls[0][0]).toContain('otherwise daysSinceLastDividend');
  });

  it('gives specific validation errors without calling AI', async () => {
    for (const [payload, error] of [
      [{ question: 'q', history: [] }, 'A report ID is required. Generate a review before asking a question.'],
      [{ reportId: 'report', question: '', history: [] }, 'A non-empty question is required.'],
      [{ reportId: 'report', question: 'q'.repeat(2001), history: [] }, 'Your question exceeds 2000 characters.'],
    ] as const) {
      mocks.query.mockResolvedValueOnce({ recordset: [{ aiInsightsEnabled: true }] });
      const response = await request(app).post('/insights/chat').set('x-user-id', user()).send(payload).expect(400);
      expect(response.body.error).toBe(error);
    }
    mocks.query.mockResolvedValueOnce({ recordset: [{ aiInsightsEnabled: true }] });
    const response = await request(app).post('/insights/chat').set('x-user-id', user())
      .send({ reportId: 'report', question: 'q', history: [{ role: 'assistant', content: 'a'.repeat(8001) }] }).expect(400);
    expect(response.body.error).toContain('Invalid chat history');
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it('reports oversized answers explicitly instead of silently truncating', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const id = user();
      queueReview();
      const review = await request(app).post('/insights').set('x-user-id', id).expect(200);
      mocks.chat.mockResolvedValueOnce('a'.repeat(8001));
      mocks.query.mockResolvedValueOnce({ recordset: [{ aiInsightsEnabled: true }] });
      const response = await request(app).post('/insights/chat').set('x-user-id', id)
        .send({ reportId: review.body.reportId, question: 'q', history: [] }).expect(502);
      expect(response.body.error).toContain('was not truncated');
      expect(response.body.answer).toBeUndefined();
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('makes a cash-only snapshot available to chat even without flagged facts', async () => {
    const id = user();
    queueReview([]);
    const response = await request(app).post('/insights').set('x-user-id', id).expect(200);
    expect(response.body.facts).toEqual([]);
    expect(response.body.snapshot.totals.portfolioValue).toBe(1465);
    expect(mocks.generate).not.toHaveBeenCalled();
    mocks.query.mockResolvedValueOnce({ recordset: [{ aiInsightsEnabled: true }] });
    await request(app).post('/insights/chat').set('x-user-id', id)
      .send({ reportId: response.body.reportId, question: 'How much cash?', history: [] }).expect(200);
    expect(mocks.chat.mock.calls[0][0]).toContain('"availableCash":1465');
  });

  it('requires authentication and enabled access before loading portfolio data', async () => {
    await request(app).post('/insights').expect(401);
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.query.mockResolvedValueOnce({ recordset: [{ aiInsightsEnabled: false }] });
    await request(app).post('/insights').set('x-user-id', user()).expect(403);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('fails explicitly instead of generating an incomplete snapshot after a query failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mocks.query.mockResolvedValueOnce({ recordset: [{ aiInsightsEnabled: true }] });
      mocks.query.mockRejectedValueOnce(new Error('snapshot query failed'));
      await request(app).post('/insights').set('x-user-id', user()).expect(502);
      expect(mocks.generate).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('Copilot portfolio inspection failed:', 'snapshot query failed');
    } finally {
      log.mockRestore();
    }
  });
});
