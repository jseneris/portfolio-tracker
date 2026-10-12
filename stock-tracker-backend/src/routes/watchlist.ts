import { Router, Request, Response } from 'express';
import sql from 'mssql';
import YahooFinance from 'yahoo-finance2';
import { getPool } from '../db/connection.js';
import { parseTransactionDate } from '../services/stock-transaction-date.js';

const router = Router();
const yahoo = new YahooFinance();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type WatchlistRow = {
  id: string; ticker: string; startDate: Date; pricesThrough: Date | null; pricesUpdatedAt: Date | null;
};
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const mapItem = (row: WatchlistRow) => ({ id: row.id, ticker: row.ticker, startDate: dateOnly(row.startDate) });

router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await getPool().request().input('userId', sql.NVarChar, req.user!.id)
      .query<WatchlistRow>('SELECT id, ticker, startDate FROM WatchlistItems WHERE userId = @userId ORDER BY ticker');
    res.json(result.recordset.map(mapItem));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/', async (req: Request, res: Response) => {
  const ticker = typeof req.body?.ticker === 'string' ? req.body.ticker.trim().toUpperCase() : '';
  const startDate = parseTransactionDate(req.body?.startDate);
  if (!/^[A-Z0-9^][A-Z0-9.^=-]{0,9}$/.test(ticker) || !startDate
    || dateOnly(startDate) > dateOnly(new Date())) {
    return res.status(400).json({ error: 'Provide a ticker of 1-10 characters and a valid startDate (YYYY-MM-DD) no later than today.' });
  }
  try {
    const result = await getPool().request()
      .input('userId', sql.NVarChar, req.user!.id).input('ticker', sql.NVarChar, ticker)
      .input('startDate', sql.Date, startDate).query<WatchlistRow>(`
        INSERT INTO WatchlistItems (userId, ticker, startDate)
        OUTPUT inserted.id, inserted.ticker, inserted.startDate
        VALUES (@userId, @ticker, @startDate);
      `);
    res.status(201).json(mapItem(result.recordset[0]));
  } catch (error) {
    if (error instanceof sql.RequestError && (error.number === 2627 || error.number === 2601)) {
      return res.status(409).json({ error: 'This ticker is already on your watchlist. Remove it first to change its start date.' });
    }
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'Invalid watchlist ID.' });
  try {
    const result = await getPool().request().input('id', sql.UniqueIdentifier, req.params.id)
      .input('userId', sql.NVarChar, req.user!.id)
      .query('DELETE FROM WatchlistItems WHERE id = @id AND userId = @userId');
    if (!result.rowsAffected[0]) return res.status(404).json({ error: 'Watchlist item not found.' });
    res.sendStatus(204);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/:id/prices', async (req: Request, res: Response) => {
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'Invalid watchlist ID.' });
  try {
    const pool = getPool();
    const lookup = await pool.request().input('id', sql.UniqueIdentifier, req.params.id)
      .input('userId', sql.NVarChar, req.user!.id)
      .query<WatchlistRow>('SELECT * FROM WatchlistItems WHERE id = @id AND userId = @userId');
    const item = lookup.recordset[0];
    if (!item) return res.status(404).json({ error: 'Watchlist item not found.' });
    const today = dateOnly(new Date());
    if (!item.pricesUpdatedAt || dateOnly(item.pricesUpdatedAt) !== today || !item.pricesThrough
      || dateOnly(item.pricesThrough) < today) {
      const period2 = new Date(`${today}T00:00:00Z`);
      period2.setUTCDate(period2.getUTCDate() + 1);
      let chart;
      try {
        chart = await yahoo.chart(item.ticker, { period1: item.startDate, period2, interval: '1d' });
      } catch (error) {
        console.error(`Unable to load watchlist prices for ${item.ticker}:`, error);
        return res.status(502).json({ error: `Unable to fetch price history for ${item.ticker}. Check the ticker or try again later.` });
      }
      const prices = chart.quotes.filter((quote) => quote.close != null && Number.isFinite(quote.close) && quote.close > 0)
        .map((quote) => ({ date: dateOnly(quote.date), close: quote.close }))
        .filter((quote) => quote.date >= dateOnly(item.startDate) && quote.date <= today);
      if (!prices.length) return res.status(422).json({ error: `No price history is available for ${item.ticker} on or after its watch start date.` });
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        const owned = await new sql.Request(tx).input('id', sql.UniqueIdentifier, item.id)
          .input('userId', sql.NVarChar, req.user!.id).query(`
            SELECT id FROM WatchlistItems WITH (UPDLOCK, HOLDLOCK) WHERE id = @id AND userId = @userId;
          `);
        if (!owned.recordset.length) {
          await tx.rollback();
          return res.status(404).json({ error: 'Watchlist item not found.' });
        }
        await new sql.Request(tx).input('id', sql.UniqueIdentifier, item.id)
          .input('prices', sql.NVarChar(sql.MAX), JSON.stringify(prices)).input('today', sql.Date, today).query(`
            DELETE FROM WatchlistPrices WHERE watchlistId = @id;
            INSERT INTO WatchlistPrices (watchlistId, priceDate, closePrice)
            SELECT @id, priceDate, closePrice
            FROM OPENJSON(@prices) WITH (priceDate DATE '$.date', closePrice DECIMAL(18,8) '$.close');
            UPDATE WatchlistItems SET pricesThrough = @today, pricesUpdatedAt = GETUTCDATE() WHERE id = @id;
          `);
        await tx.commit();
      } catch (error) {
        try { await tx.rollback(); } catch (rollbackError) { console.error('Watchlist price rollback failed:', rollbackError); }
        throw error;
      }
    }
    const result = await pool.request().input('id', sql.UniqueIdentifier, item.id)
      .input('userId', sql.NVarChar, req.user!.id).query<{ priceDate: Date; closePrice: number }>(`
        SELECT price.priceDate, price.closePrice FROM WatchlistPrices price
        JOIN WatchlistItems item ON item.id = price.watchlistId
        WHERE item.id = @id AND item.userId = @userId ORDER BY price.priceDate;
      `);
    res.json(result.recordset.map((row) => ({ date: dateOnly(row.priceDate), close: row.closePrice })));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
