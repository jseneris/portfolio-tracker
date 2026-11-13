import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { getPool } from '../db/connection.js';

const router = Router();

type TickerPreferenceRow = {
  ticker: string;
  baseSize: number;
  buyOnDip: boolean;
  buyOnDipPrice: number | null;
  buyRestricted: boolean;
  buyRestrictedUntil: Date | string | null;
  restrictionSalePrice: number | null;
  note: string | null;
  targetBuyPriceOverride: number | null;
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
    baseSize: Number(row.baseSize),
    buyOnDip: Boolean(row.buyOnDip),
    buyOnDipPrice: row.buyOnDipPrice == null ? null : Number(row.buyOnDipPrice),
    buyRestricted,
    buyRestrictedUntil,
    isBuyRestricted: buyRestricted && buyRestrictedUntil != null && today <= buyRestrictedUntil,
    restrictionSalePrice: row.restrictionSalePrice == null ? null : Number(row.restrictionSalePrice),
    note: row.note ?? null,
    targetBuyPriceOverride: row.targetBuyPriceOverride == null ? null : Number(row.targetBuyPriceOverride),
  };
}

const preferenceSelect = `
  SELECT preference.ticker, preference.baseSize, preference.buyOnDip, preference.buyOnDipPrice,
    preference.buyRestricted, preference.buyRestrictedUntil, preference.note, preference.targetBuyPriceOverride,
    restrictionSale.price AS restrictionSalePrice
  FROM UserTickerPreferences preference
  OUTER APPLY (
    SELECT TOP 1 sale.price
    FROM StockTransactions sale
    WHERE sale.userId = preference.userId
      AND sale.ticker = preference.ticker
      AND sale.type = 'sell'
      AND DATEADD(day, 31, CONVERT(date, sale.transactionDate)) = preference.buyRestrictedUntil
      AND EXISTS (
        SELECT 1
        FROM PurchaseLotAllocations allocation
        INNER JOIN PurchaseLots lot ON lot.id = allocation.purchaseLotId AND lot.userId = preference.userId
        WHERE allocation.saleTransactionId = sale.id AND allocation.userId = preference.userId
          AND allocation.quantityConsumed > 0 AND lot.unitCost > sale.price
      )
    ORDER BY sale.transactionDate DESC, sale.createdAt DESC, sale.id DESC
  ) restrictionSale
`;

router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const today = new Date().toISOString().slice(0, 10);
    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query(`${preferenceSelect} WHERE preference.userId = @userId ORDER BY preference.ticker`);

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
      .query(`${preferenceSelect} WHERE preference.userId = @userId AND preference.ticker = @ticker`);

    const row = result.recordset[0] as TickerPreferenceRow | undefined;
    res.json(row
      ? mapPreference(row, new Date().toISOString().slice(0, 10))
      : { ticker, baseSize: 3, buyOnDip: false, buyOnDipPrice: null, buyRestricted: false, buyRestrictedUntil: null, isBuyRestricted: false, restrictionSalePrice: null, note: null, targetBuyPriceOverride: null });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/:ticker', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const ticker = normalizeTicker(req.params.ticker);
    const baseSize = req.body?.baseSize;
    const buyOnDip = req.body?.buyOnDip;
    const buyOnDipPrice = req.body?.buyOnDipPrice;
    const buyRestricted = req.body?.buyRestricted;
    const buyRestrictedUntil = normalizeDateOnly(req.body?.buyRestrictedUntil);
    const note = typeof req.body?.note === 'string' ? (req.body.note.trim() || null) : null;
    const targetBuyPriceOverride = req.body?.targetBuyPriceOverride;
    const hasTargetBuyPriceOverride = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'targetBuyPriceOverride');

    if (!ticker || ticker.length > 10) {
      return res.status(400).json({ error: 'ticker must be between 1 and 10 characters' });
    }
    if (baseSize != null && (!Number.isSafeInteger(baseSize) || baseSize < 0 || baseSize > 2147483647)) {
      return res.status(400).json({ error: 'baseSize must be a non-negative integer' });
    }
    if (typeof buyOnDip !== 'boolean' || typeof buyRestricted !== 'boolean') {
      return res.status(400).json({ error: 'buyOnDip and buyRestricted must be boolean values' });
    }
    if (buyOnDipPrice != null && (typeof buyOnDipPrice !== 'number' || !Number.isFinite(buyOnDipPrice) || buyOnDipPrice < 0.00000001 || buyOnDipPrice >= 10000000000)) {
      return res.status(400).json({ error: 'buyOnDipPrice must be a positive price within the supported range' });
    }
    if (targetBuyPriceOverride != null && (typeof targetBuyPriceOverride !== 'number' || !Number.isFinite(targetBuyPriceOverride) || targetBuyPriceOverride < 0.00000001 || targetBuyPriceOverride >= 10000000000)) {
      return res.status(400).json({ error: 'targetBuyPriceOverride must be a positive price within the supported range' });
    }
    if (buyRestricted && buyRestrictedUntil == null) {
      return res.status(400).json({ error: 'buyRestrictedUntil is required when buyRestricted is enabled' });
    }
    if (req.body?.buyRestrictedUntil != null && req.body.buyRestrictedUntil !== '' && buyRestrictedUntil == null) {
      return res.status(400).json({ error: 'buyRestrictedUntil must be a valid YYYY-MM-DD date' });
    }

    const storedRestrictionDate = buyRestricted ? buyRestrictedUntil : null;
    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker)
      .input('baseSize', sql.Int, baseSize ?? null)
      .input('buyOnDip', sql.Bit, buyOnDip)
      .input('buyOnDipPrice', sql.Decimal(18, 8), buyOnDipPrice ?? null)
      .input('buyRestricted', sql.Bit, buyRestricted)
      .input('buyRestrictedUntil', sql.Date, storedRestrictionDate)
      .input('note', sql.NVarChar(sql.MAX), note)
      .input('targetBuyPriceOverride', sql.Decimal(18, 8), targetBuyPriceOverride ?? null)
      .input('hasTargetBuyPriceOverride', sql.Bit, hasTargetBuyPriceOverride)
      .query(`
        MERGE UserTickerPreferences AS target
        USING (SELECT @userId AS userId, @ticker AS ticker) AS source
          ON target.userId = source.userId AND target.ticker = source.ticker
        WHEN MATCHED THEN
          UPDATE SET baseSize = COALESCE(@baseSize, target.baseSize),
                     buyOnDip = @buyOnDip,
                     buyOnDipPrice = CASE WHEN @buyOnDip = 0 THEN NULL ELSE COALESCE(@buyOnDipPrice, target.buyOnDipPrice) END,
                     buyRestricted = @buyRestricted,
                     buyRestrictedUntil = @buyRestrictedUntil,
                     note = @note,
                     targetBuyPriceOverride = CASE WHEN @hasTargetBuyPriceOverride = 1 THEN @targetBuyPriceOverride ELSE target.targetBuyPriceOverride END,
                     updatedAt = GETUTCDATE()
        WHEN NOT MATCHED THEN
          INSERT (id, userId, ticker, baseSize, buyOnDip, buyOnDipPrice, buyRestricted, buyRestrictedUntil, note, targetBuyPriceOverride)
          VALUES (NEWID(), @userId, @ticker, COALESCE(@baseSize, 3), @buyOnDip, CASE WHEN @buyOnDip = 1 THEN @buyOnDipPrice ELSE NULL END, @buyRestricted, @buyRestrictedUntil, @note, @targetBuyPriceOverride);
        ${preferenceSelect}
        WHERE preference.userId = @userId AND preference.ticker = @ticker;
      `);

    res.json(mapPreference(result.recordset[0] as TickerPreferenceRow, new Date().toISOString().slice(0, 10)));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
