import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { getPool } from '../db/connection.js';

const router = Router();

type TickerPreferenceRow = {
  ticker: string;
  buyOnDip: boolean;
  buyRestricted: boolean;
  buyRestrictedUntil: Date | string | null;
};

function normalizeTicker(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function normalizeDateOnly(value: unknown): string | null {
  if (value == null || value === '') {
    return null;
  }

  const text = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return null;
  }

  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

function toDateOnly(value: Date | string | null): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function mapPreference(row: TickerPreferenceRow, today: string) {
  const buyRestrictedUntil = toDateOnly(row.buyRestrictedUntil);
  const buyRestricted = Boolean(row.buyRestricted);
  return {
    ticker: String(row.ticker).toUpperCase(),
    buyOnDip: Boolean(row.buyOnDip),
    buyRestricted,
    buyRestrictedUntil,
    isBuyRestricted: buyRestricted && buyRestrictedUntil != null && today <= buyRestrictedUntil,
  };
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const today = new Date().toISOString().slice(0, 10);
    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT ticker, buyOnDip, buyRestricted, buyRestrictedUntil
        FROM UserTickerPreferences
        WHERE userId = @userId
        ORDER BY ticker
      `);

    res.json((result.recordset as TickerPreferenceRow[]).map((row) => mapPreference(row, today)));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/:ticker', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const ticker = normalizeTicker(req.params.ticker);
    if (!ticker || ticker.length > 10) {
      return res.status(400).json({ error: 'ticker must be between 1 and 10 characters' });
    }

    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker)
      .query(`
        SELECT TOP 1 ticker, buyOnDip, buyRestricted, buyRestrictedUntil
        FROM UserTickerPreferences
        WHERE userId = @userId AND ticker = @ticker
      `);

    const row = result.recordset[0] as TickerPreferenceRow | undefined;
    res.json(row
      ? mapPreference(row, new Date().toISOString().slice(0, 10))
      : { ticker, buyOnDip: false, buyRestricted: false, buyRestrictedUntil: null, isBuyRestricted: false });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/:ticker', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const ticker = normalizeTicker(req.params.ticker);
    const buyOnDip = req.body?.buyOnDip;
    const buyRestricted = req.body?.buyRestricted;
    const buyRestrictedUntil = normalizeDateOnly(req.body?.buyRestrictedUntil);

    if (!ticker || ticker.length > 10) {
      return res.status(400).json({ error: 'ticker must be between 1 and 10 characters' });
    }
    if (typeof buyOnDip !== 'boolean' || typeof buyRestricted !== 'boolean') {
      return res.status(400).json({ error: 'buyOnDip and buyRestricted must be boolean values' });
    }
    if (buyRestricted && buyRestrictedUntil == null) {
      return res.status(400).json({ error: 'buyRestrictedUntil is required when buyRestricted is enabled' });
    }
    if (req.body?.buyRestrictedUntil != null && req.body.buyRestrictedUntil !== '' && buyRestrictedUntil == null) {
      return res.status(400).json({ error: 'buyRestrictedUntil must be a valid YYYY-MM-DD date' });
    }

    const storedRestrictionDate = buyRestricted ? buyRestrictedUntil : null;
    await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker)
      .input('buyOnDip', sql.Bit, buyOnDip)
      .input('buyRestricted', sql.Bit, buyRestricted)
      .input('buyRestrictedUntil', sql.Date, storedRestrictionDate)
      .query(`
        MERGE UserTickerPreferences AS target
        USING (SELECT @userId AS userId, @ticker AS ticker) AS source
          ON target.userId = source.userId AND target.ticker = source.ticker
        WHEN MATCHED THEN
          UPDATE SET buyOnDip = @buyOnDip,
                     buyRestricted = @buyRestricted,
                     buyRestrictedUntil = @buyRestrictedUntil,
                     updatedAt = GETUTCDATE()
        WHEN NOT MATCHED THEN
          INSERT (id, userId, ticker, buyOnDip, buyRestricted, buyRestrictedUntil)
          VALUES (NEWID(), @userId, @ticker, @buyOnDip, @buyRestricted, @buyRestrictedUntil);
      `);

    res.json({
      ticker,
      buyOnDip,
      buyRestricted,
      buyRestrictedUntil: storedRestrictionDate,
      isBuyRestricted: buyRestricted && storedRestrictionDate != null && new Date().toISOString().slice(0, 10) <= storedRestrictionDate,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
