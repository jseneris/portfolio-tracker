import { Router } from 'express';
import YahooFinance from 'yahoo-finance2';

const router = Router();
const yahooFinance = new YahooFinance();
const DAY = 86400000;

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

router.post('/prices', async (req, res) => {
  const { tickers, startDate, endDate } = req.body ?? {};
  const today = new Date().toISOString().slice(0, 10);
  if (!Array.isArray(tickers) || !tickers.length || tickers.length > 200
    || !tickers.every((ticker): ticker is string => typeof ticker === 'string' && /^[A-Z0-9.^=-]{1,20}$/.test(ticker))
    || !validDate(startDate) || !validDate(endDate) || startDate > endDate || endDate >= today
    || Date.parse(endDate) - Date.parse(startDate) > 400 * DAY) {
    return res.status(400).json({ error: 'Supply up to 200 tickers and a valid date range of at most 400 days ending before today.' });
  }
  try {
    const bars: Array<{ ticker: string; date: string; open: number; high: number; low: number; close: number }> = [];
    const marketSplits: Array<{ ticker: string; date: string; multiplier: number }> = [];
    const warnings: string[] = [];
    for (const ticker of new Set<string>(tickers)) {
      const chart = await yahooFinance.chart(ticker, {
        period1: new Date(Date.parse(startDate) - 14 * DAY),
        period2: new Date(),
        interval: '1d',
        events: 'split',
      });
      if (chart.meta.currency !== 'USD') {
        throw new Error(`${ticker}: simulation currently supports USD quotes only.`);
      }
      const splits = chart.events?.splits ?? [];
      for (const split of splits) {
        const date = split.date.toISOString().slice(0, 10);
        const multiplier = split.numerator / split.denominator;
        if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error(`${ticker}: invalid market split data.`);
        if (date > startDate && date <= endDate) marketSplits.push({ ticker, date, multiplier });
      }
      let invalidBars = 0;
      for (const quote of chart.quotes) {
        const date = quote.date.toISOString().slice(0, 10);
        if (date > endDate) continue;
        const multiplier = splits.filter((split) => split.date.toISOString().slice(0, 10) > date)
          .reduce((product, split) => product * split.numerator / split.denominator, 1);
        const open = Number(quote.open) * multiplier;
        const high = Number(quote.high) * multiplier;
        const low = Number(quote.low) * multiplier;
        const close = Number(quote.close) * multiplier;
        if (![open, high, low, close].every((price) => Number.isFinite(price) && price > 0)
          || low > Math.min(open, close) || high < Math.max(open, close)) {
          invalidBars += 1;
          continue;
        }
        bars.push({ ticker, date, open, high, low, close });
      }
      if (!bars.some((bar) => bar.ticker === ticker)) {
        throw new Error(`${ticker}: no valid OHLC history. Review unavailable/delisted ticker data.`);
      }
      if (invalidBars) warnings.push(`${ticker}: ${invalidBars} invalid OHLC bar(s) omitted. No trades execute on those dates; valuation uses the last available close.`);
    }
    res.json({ bars, marketSplits, warnings });
  } catch (error) {
    console.error('[simulation] Unable to load OHLC history:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to load simulation price history.' });
  }
});

export default router;
