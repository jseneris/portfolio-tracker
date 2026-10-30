import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPriceTargetAlertCycle } from '../src/services/price-target-alerts.js';

const mocks = vi.hoisted(() => ({ query: vi.fn(), input: vi.fn() }));
vi.mock('../src/db/connection.js', () => ({
  getPool: () => ({ request: () => ({ input: mocks.input, query: mocks.query }) }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.input.mockImplementation(() => ({ input: mocks.input, query: mocks.query }));
});

type CycleOptions = {
  buyOnDip?: boolean;
  lots?: string;
  baseSize?: number;
  restrictedUntil?: string | null;
  merges?: Array<{ ticker: string }[]>;
  inserted?: boolean;
  purchaseLots?: Array<{ remainingQuantity: number; unitCost: number }>;
};

function queueCycle({
  buyOnDip = false,
  lots = '1,2,3',
  baseSize = 3,
  restrictedUntil = null,
  merges = [],
  inserted = true,
  purchaseLots = [],
}: CycleOptions = {}) {
  mocks.query
    .mockResolvedValueOnce({ recordset: [{ userId: 'u', ticker: 'TEST' }] })
    .mockResolvedValueOnce({ recordset: [] })
    .mockResolvedValueOnce({
      recordset: [{
        userId: 'u', ticker: 'TEST', baseSize, buyOnDip, buyOnDipPrice: buyOnDip ? 100 : null,
        buyRestricted: restrictedUntil != null, buyRestrictedUntil: restrictedUntil,
      }],
    })
    .mockResolvedValueOnce({ recordset: [{ userId: 'u', ticker: 'TEST', lotsCsv: lots }] })
    .mockResolvedValueOnce({ recordset: [{ userId: 'u', ticker: 'TEST', price: 100, transactionDate: '2026-01-02' }] })
    .mockResolvedValueOnce({ recordset: [] })
    .mockResolvedValueOnce({ recordset: purchaseLots.map((lot) => ({ userId: 'u', ticker: 'TEST', ...lot })) });
  for (const merge of merges) {
    mocks.query.mockResolvedValueOnce({ recordset: merge });
  }
  mocks.query.mockResolvedValue({ rowsAffected: [inserted ? 1 : 0] });
}

async function runCycle() {
  const notify = vi.fn().mockResolvedValue(1);
  const result = await runPriceTargetAlertCycle({
    now: new Date('2026-10-27T15:00:00Z'),
    ignoreMarketHours: true,
    getPrices: async () => ({ TEST: 121 }),
    sendNotification: notify,
  });
  return { result, notify };
}

function mergeCalls(): string[] {
  return mocks.query.mock.calls.map(([query]) => String(query)).filter((query) => query.includes('MERGE UserTickerPreferences'));
}

describe('Buy on Dip capture', () => {
  it('captures the trigger price at the sell target for an even holding', async () => {
    queueCycle({ merges: [[{ ticker: 'TEST' }]] });
    const { result, notify } = await runCycle();
    expect(result.created).toBe(1);
    expect(mocks.input).toHaveBeenCalledWith('price', expect.anything(), 121);
    const [merge] = mergeCalls();
    expect(merge).toContain('UPDATE SET buyOnDip = 1, buyOnDipPrice = @price');
    expect(merge).not.toContain('target.buyOnDip = 0');
    expect(merge).toContain('target.buyRestricted = 1 AND target.buyRestrictedUntil >= @today');
    expect(notify).toHaveBeenCalledWith('u', expect.objectContaining({
      body: expect.stringContaining('Buy on Dip was automatically enabled at 121.0000'),
    }));
  });

  it('never recaptures the price for an already-enabled even holding', async () => {
    queueCycle({ buyOnDip: true });
    const { result, notify } = await runCycle();
    expect(result.created).toBe(1);
    expect(mergeCalls()).toHaveLength(0);
    expect(notify.mock.calls[0][1].body).not.toContain('automatically enabled');
  });

  it('automatically enables below the base size anchored at the last buy/sell price', async () => {
    queueCycle({ lots: '10', merges: [[{ ticker: 'TEST' }]] });
    const { result, notify } = await runCycle();
    expect(mergeCalls()).toHaveLength(1);
    expect(mocks.input).toHaveBeenCalledWith('price', expect.anything(), 100);
    expect(result.created).toBe(1);
    expect(notify.mock.calls[0][1].body).toContain('hit its sell target of 110.0000');
    expect(notify.mock.calls[0][1].body).not.toContain('automatically enabled');
  });

  it('uses the custom base size when determining even weight', async () => {
    queueCycle({ lots: '10,10', baseSize: 2, merges: [[{ ticker: 'TEST' }]] });
    const { notify } = await runCycle();
    expect(mocks.input).toHaveBeenCalledWith('price', expect.anything(), 121);
    expect(notify.mock.calls[0][1].body).toContain('automatically enabled');
  });

  it('does not enable above the base size when profitable shares cover the smallest display lot', async () => {
    queueCycle({ lots: '1,2,3,4', purchaseLots: [{ remainingQuantity: 10, unitCost: 100 }] });
    const { notify } = await runCycle();
    expect(mergeCalls()).toHaveLength(0);
    expect(notify.mock.calls[0][1].body).not.toContain('automatically enabled');
  });

  it('suppresses automatic activation below the base size while buying is restricted', async () => {
    queueCycle({ lots: '10', restrictedUntil: '2026-12-31', merges: [[]] });
    const { result } = await runCycle();
    expect(mocks.input).not.toHaveBeenCalledWith('price', expect.anything(), 100);
    expect(result.created).toBe(1);
  });

  it('captures the price even when an unread alert suppresses a duplicate notification', async () => {
    queueCycle({ merges: [[{ ticker: 'TEST' }]], inserted: false });
    const { result, notify } = await runCycle();
    expect(mocks.input).toHaveBeenCalledWith('price', expect.anything(), 121);
    expect(result.created).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});
