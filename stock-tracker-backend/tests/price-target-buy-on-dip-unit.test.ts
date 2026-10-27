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

function queueCycle(buyOnDip: boolean, lots = '1,2,3', updated = true, inserted = true, baseSize = 3) {
  mocks.query
    .mockResolvedValueOnce({ recordset: [{ userId: 'u', ticker: 'TEST' }] })
    .mockResolvedValueOnce({ recordset: [] })
    .mockResolvedValueOnce({ recordset: [{ userId: 'u', ticker: 'TEST', baseSize, buyOnDip, buyOnDipPrice: buyOnDip ? 100 : null }] })
    .mockResolvedValueOnce({ recordset: [{ userId: 'u', ticker: 'TEST', lotsCsv: lots }] })
    .mockResolvedValueOnce({ recordset: [{ userId: 'u', ticker: 'TEST', price: 100, transactionDate: '2026-01-02' }] })
    .mockResolvedValueOnce({ recordset: [] });
  if (lots.split(',').length === baseSize) {
    mocks.query.mockResolvedValueOnce({ recordset: updated ? [{ ticker: 'TEST' }] : [] });
  }
  mocks.query.mockResolvedValueOnce({ rowsAffected: [inserted ? 1 : 0] });
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

describe('sell-target Buy on Dip capture', () => {
  it.each([false, true])('sets the current price for an even holding when Buy on Dip is %s', async (enabled) => {
    queueCycle(enabled);
    const { result, notify } = await runCycle();
    expect(result.created).toBe(1);
    expect(mocks.input).toHaveBeenCalledWith('price', expect.anything(), 121);
    const merge = mocks.query.mock.calls[6][0];
    expect(merge).toContain('UPDATE SET buyOnDip = 1, buyOnDipPrice = @price');
    expect(merge).not.toContain('target.buyOnDip = 0');
    expect(merge).toContain('target.buyRestricted = 1 AND target.buyRestrictedUntil >= @today');
    expect(notify).toHaveBeenCalledWith('u', expect.objectContaining({
      body: expect.stringContaining('Buy on Dip was set at 121.0000'),
    }));
  });

  it('uses the custom base size when determining even weight', async () => {
    queueCycle(true, '10,10', true, true, 2);
    const { notify } = await runCycle();
    expect(mocks.query.mock.calls[6][0]).toContain('MERGE UserTickerPreferences');
    expect(notify.mock.calls[0][1].body).toContain('Buy on Dip was set');
  });

  it('does not reset Buy on Dip for an uneven holding', async () => {
    queueCycle(true, '10,10');
    const { notify } = await runCycle();
    expect(mocks.query.mock.calls.some(([query]) => query.includes('MERGE UserTickerPreferences'))).toBe(false);
    expect(notify.mock.calls[0][1].body).not.toContain('Buy on Dip was set');
  });

  it('does not claim Buy on Dip was set when the update is blocked', async () => {
    queueCycle(true, '1,2,3', false);
    const { notify } = await runCycle();
    expect(notify.mock.calls[0][1].body).not.toContain('Buy on Dip was set');
  });

  it('resets the captured price even when an unread alert suppresses a duplicate notification', async () => {
    queueCycle(true, '1,2,3', true, false);
    const { result, notify } = await runCycle();
    expect(mocks.input).toHaveBeenCalledWith('price', expect.anything(), 121);
    expect(result.created).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});
