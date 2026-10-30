import { describe, expect, it } from 'vitest';
import { resolveClosestHistoricalCloseOnOrBefore } from '../src/routes/stocks.js';

describe('comparison historical price lookup', () => {
  const quotes = [
    { priceDate: '2025-12-31', close: 100 },
    { priceDate: '2026-01-02', close: 110 },
    { priceDate: '2026-01-05', close: 120 },
  ];

  it('finds exact closes and the latest prior close across weekends and year boundaries', () => {
    expect(resolveClosestHistoricalCloseOnOrBefore(quotes, '2026-01-02')).toBe(quotes[1]);
    expect(resolveClosestHistoricalCloseOnOrBefore(quotes, '2026-01-04')).toBe(quotes[1]);
    expect(resolveClosestHistoricalCloseOnOrBefore(quotes, '2026-01-01')).toBe(quotes[0]);
    expect(resolveClosestHistoricalCloseOnOrBefore(quotes, '2026-10-29')).toBe(quotes[2]);
  });

  it('returns no close before the first quote or when the history is empty', () => {
    expect(resolveClosestHistoricalCloseOnOrBefore(quotes, '2025-12-30')).toBeNull();
    expect(resolveClosestHistoricalCloseOnOrBefore([], '2026-01-01')).toBeNull();
  });

  it('uses logarithmic lookups rather than scanning the entire history', () => {
    let inspectedDates = 0;
    const history = Array.from({ length: 65536 }, (_, index) => {
      const priceDate = new Date(Date.UTC(1900, 0, index + 1)).toISOString().slice(0, 10);
      return {
        get priceDate() {
          inspectedDates += 1;
          return priceDate;
        },
        close: index + 1,
      };
    });

    expect(resolveClosestHistoricalCloseOnOrBefore(history, '2099-12-31')).toBe(history[history.length - 1]);
    expect(inspectedDates).toBeLessThanOrEqual(17);
  });
});
