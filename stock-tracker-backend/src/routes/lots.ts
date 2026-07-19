import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/connection.js';
import sql from 'mssql';

const router = Router();
const SPLIT_TOLERANCE = 1e-6;

interface CombineLotsRequestBody {
  lotIds?: string[];
}

interface DisplayLotReconciliationUserSummary {
  userId: string;
  createdLots: number;
  createdShares: number;
  trimmedShares: number;
}

interface DisplayLotReconciliationSummary {
  usersProcessed: number;
  usersWithForwardFill: number;
  usersWithReverseTrim: number;
  totalCreatedLots: number;
  totalCreatedShares: number;
  totalTrimmedShares: number;
  users: DisplayLotReconciliationUserSummary[];
}

async function reconcileDisplayLotsAfterSplit(
  tx: sql.Transaction,
  ticker: string
): Promise<DisplayLotReconciliationSummary> {
  const summary: DisplayLotReconciliationSummary = {
    usersProcessed: 0,
    usersWithForwardFill: 0,
    usersWithReverseTrim: 0,
    totalCreatedLots: 0,
    totalCreatedShares: 0,
    totalTrimmedShares: 0,
    users: [],
  };

  const userRows = await new sql.Request(tx)
    .input('ticker', sql.NVarChar, ticker)
    .query(`
      SELECT DISTINCT userId
      FROM PurchaseLots
      WHERE ticker = @ticker AND sourceType = 'purchase'
      UNION
      SELECT DISTINCT userId
      FROM DisplayLots
      WHERE ticker = @ticker
    `);

  for (const userRow of userRows.recordset as any[]) {
    const userId = String(userRow.userId || '');
    if (!userId) {
      continue;
    }

    summary.usersProcessed += 1;
    const userSummary: DisplayLotReconciliationUserSummary = {
      userId,
      createdLots: 0,
      createdShares: 0,
      trimmedShares: 0,
    };

    const openPurchaseTotalRow = await new sql.Request(tx)
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker)
      .query(`
        SELECT COALESCE(SUM(remainingQuantity), 0) AS total
        FROM PurchaseLots
        WHERE userId = @userId
          AND ticker = @ticker
          AND sourceType = 'purchase'
          AND remainingQuantity > 0
      `);

    const targetTotal = Number(openPurchaseTotalRow.recordset[0]?.total || 0);

    const displayLotsResult = await new sql.Request(tx)
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker)
      .query(`
        SELECT id, totalQuantity
        FROM DisplayLots
        WHERE userId = @userId
          AND ticker = @ticker
          AND totalQuantity > 0
        ORDER BY totalQuantity ASC, createdAt ASC
      `);

    const displayRows = displayLotsResult.recordset as any[];
    const displayTotal = displayRows.reduce((sum, row) => {
      const qty = Number(row.totalQuantity);
      return Number.isFinite(qty) ? sum + qty : sum;
    }, 0);

    const delta = targetTotal - displayTotal;

    // Forward split behavior: add a single synthetic display lot for any missing shares.
    if (delta > SPLIT_TOLERANCE) {
      await new sql.Request(tx)
        .input('id', sql.UniqueIdentifier, uuidv4())
        .input('userId', sql.NVarChar, userId)
        .input('ticker', sql.NVarChar, ticker)
        .input('totalQuantity', sql.Decimal(18, 8), delta)
        .query(`
          INSERT INTO DisplayLots (id, userId, ticker, totalQuantity)
          VALUES (@id, @userId, @ticker, @totalQuantity)
        `);

      userSummary.createdLots = 1;
      userSummary.createdShares = delta;
      summary.usersWithForwardFill += 1;
      summary.totalCreatedLots += 1;
      summary.totalCreatedShares += delta;
      summary.users.push(userSummary);
      continue;
    }

    // Reverse split behavior: consume display lots from smallest to largest.
    if (delta < -SPLIT_TOLERANCE) {
      let toExhaust = Math.abs(delta);

      for (const row of displayRows) {
        if (toExhaust <= SPLIT_TOLERANCE) {
          break;
        }

        const lotId = String(row.id);
        const lotQty = Number(row.totalQuantity);
        if (!Number.isFinite(lotQty) || lotQty <= SPLIT_TOLERANCE) {
          continue;
        }

        const reduceBy = Math.min(lotQty, toExhaust);
        toExhaust -= reduceBy;
        userSummary.trimmedShares += reduceBy;

        await new sql.Request(tx)
          .input('displayLotId', sql.UniqueIdentifier, lotId)
          .input('userId', sql.NVarChar, userId)
          .input('reduceBy', sql.Decimal(18, 8), reduceBy)
          .query(`
            UPDATE DisplayLots
            SET totalQuantity = CASE
              WHEN totalQuantity - @reduceBy < 0 THEN 0
              ELSE totalQuantity - @reduceBy
            END,
            updatedAt = GETUTCDATE()
            WHERE id = @displayLotId AND userId = @userId
          `);
      }

      if (userSummary.trimmedShares > SPLIT_TOLERANCE) {
        summary.usersWithReverseTrim += 1;
        summary.totalTrimmedShares += userSummary.trimmedShares;
      }
      summary.users.push(userSummary);
      continue;
    }

    summary.users.push(userSummary);
  }

  return summary;
}

// GET all purchase-lot attribution rows for user
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const request = getPool().request();
    
    const result = await request
      .input('userId', sql.NVarChar, userId)
      .query('SELECT * FROM PurchaseLots WHERE userId = @userId AND remainingQuantity > 0 ORDER BY purchaseDate ASC');
    
    res.json(result.recordset);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET split history for a ticker (global splits)
router.get('/ticker/:ticker/splits', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;

    const result = await getPool().request()
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .query(`
        SELECT id, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate, createdAt
        FROM StockSplits
        WHERE ticker = @ticker
        ORDER BY splitDate DESC, createdAt DESC
      `);

    res.json(result.recordset.map((row: any) => ({
      id: row.id,
      ticker: row.ticker,
      ratioNumerator: Number(row.ratioNumerator),
      ratioDenominator: Number(row.ratioDenominator),
      multiplier: Number(row.multiplier),
      splitDate: row.splitDate,
      createdAt: row.createdAt,
    })));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET all split history records (global)
router.get('/splits', async (_req: Request, res: Response) => {
  try {
    const result = await getPool().request()
      .query(`
        SELECT id, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate, createdAt
        FROM StockSplits
        ORDER BY splitDate DESC, createdAt DESC
      `);

    res.json(result.recordset.map((row: any) => ({
      id: row.id,
      ticker: row.ticker,
      ratioNumerator: Number(row.ratioNumerator),
      ratioDenominator: Number(row.ratioDenominator),
      multiplier: Number(row.multiplier),
      splitDate: row.splitDate,
      createdAt: row.createdAt,
    })));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET lots for specific ticker (optionally filtered by sourceType, e.g. ?sourceType=purchase)
router.get('/:ticker', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const { sourceType } = req.query as { sourceType?: string };
    const userId = req.user?.id!;
    const request = getPool().request();

    request
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker.toUpperCase());

    let query = `
      SELECT * FROM PurchaseLots 
      WHERE userId = @userId AND ticker = @ticker AND remainingQuantity > 0
    `;

    if (sourceType) {
      request.input('sourceType', sql.NVarChar, sourceType);
      query += ' AND sourceType = @sourceType';
    }

    query += ' ORDER BY purchaseDate ASC';

    const result = await request.query(query);
    
    res.json(result.recordset);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET open (unconsumed) purchase lots for ticker — excludes dividend lots, only remainingQuantity > 0
router.get('/:ticker/open', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const userId = req.user?.id!;

    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .query(`
        SELECT * FROM PurchaseLots
        WHERE userId = @userId AND ticker = @ticker
          AND sourceType = 'purchase'
          AND remainingQuantity > 0
        ORDER BY purchaseDate ASC
      `);

    res.json(result.recordset);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// UPDATE lot (used when selling shares)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { remainingQuantity } = req.body;
    const userId = req.user?.id!;
    
    const request = getPool().request();
    
    await request
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.NVarChar, userId)
      .input('remainingQuantity', sql.Decimal(18, 8), remainingQuantity)
      .query(`
        UPDATE PurchaseLots 
        SET remainingQuantity = @remainingQuantity, updatedAt = GETUTCDATE()
        WHERE id = @id AND userId = @userId
      `);
    
    res.json({ id, remainingQuantity });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// COMBINE multiple open lots into a single open lot for the same ticker.
// Preserves cost basis by using weighted average unit cost of remaining shares.
// Combine functionality moved to Display Lots API (/api/display-lots/:id/combine)

// Split functionality moved to Display Lots API (/api/display-lots/:id/split)

// APPLY stock split (multiplies all quantities for a ticker retroactively, preserving cost basis)
// Runs as a single DB transaction across all four writes (StockSplits, Lots, StockTransactions,
// LotAllocations) so a mid-way failure can never leave the ticker half-adjusted. Every lot,
// transaction, and lot-allocation touched is also logged to SplitAdjustments so the full split
// history survives multiple sequential splits on the same ticker (not just the most recent one).
router.post('/ticker/:ticker/split', async (req: Request, res: Response) => {
  const pool = getPool();
  const transaction = new sql.Transaction(pool);
  let began = false;
  try {
    const { ticker } = req.params;
    const { ratioNumerator, ratioDenominator, splitDate } = req.body;
    const actorUserId = req.user?.id!;

    // Splits are specified as a ratio (e.g. "2-for-1" -> ratioNumerator=2, ratioDenominator=1;
    // "5-for-3" -> ratioNumerator=5, ratioDenominator=3), matching how splits are actually
    // announced, rather than requiring the caller to pre-compute a single decimal multiplier.
    if (ratioNumerator == null || ratioDenominator == null || !splitDate) {
      return res.status(400).json({ error: 'Missing ratioNumerator, ratioDenominator, or splitDate' });
    }
    if (Number(ratioNumerator) <= 0 || Number(ratioDenominator) <= 0) {
      return res.status(400).json({ error: 'ratioNumerator and ratioDenominator must both be positive numbers' });
    }

    const normalizedTicker = ticker.toUpperCase();
    const parsedSplitDate = new Date(splitDate);
    const multiplier = Number(ratioNumerator) / Number(ratioDenominator);

    await transaction.begin();
    began = true;

    // Idempotency guard: reject re-applying the exact same split (same ticker/ratio/date) twice.
    // Split events are global to the ticker, so this check is intentionally not scoped to userId.
    const dupeCheck = await new sql.Request(transaction)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('ratioNumerator', sql.Decimal(18, 8), ratioNumerator)
      .input('ratioDenominator', sql.Decimal(18, 8), ratioDenominator)
      .input('splitDate', sql.DateTime2, parsedSplitDate)
      .query(`
        SELECT id FROM StockSplits
        WHERE ticker = @ticker
          AND ratioNumerator = @ratioNumerator AND ratioDenominator = @ratioDenominator
          AND splitDate = @splitDate
      `);
    if (dupeCheck.recordset.length > 0) {
      await transaction.rollback();
      began = false;
      return res.status(409).json({ error: 'This split has already been applied' });
    }

    // Record the split event for auditability/idempotency
    const splitId = uuidv4();

    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, splitId)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('ratioNumerator', sql.Decimal(18, 8), ratioNumerator)
      .input('ratioDenominator', sql.Decimal(18, 8), ratioDenominator)
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, parsedSplitDate)
      .query(`
         INSERT INTO StockSplits (id, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate)
         VALUES (@id, @ticker, @ratioNumerator, @ratioDenominator, @multiplier, @splitDate)
         `);

    const lotTargets = await new sql.Request(transaction)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('splitDate', sql.DateTime2, parsedSplitDate)
      .query(`
        SELECT id, userId
        FROM PurchaseLots
        WHERE ticker = @ticker AND purchaseDate <= @splitDate
      `);

    await new sql.Request(transaction)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, parsedSplitDate)
      .input('splitId', sql.UniqueIdentifier, splitId)
      .query(`
        UPDATE PurchaseLots
        SET originalQuantity = originalQuantity * @multiplier,
            remainingQuantity = remainingQuantity * @multiplier,
            unitCost = unitCost / @multiplier,
            splitAdjusted = 1,
            lastSplitId = @splitId,
            updatedAt = GETUTCDATE()
        WHERE ticker = @ticker AND purchaseDate <= @splitDate
      `);

    // Update all purchase lots affected by this split.
    // Quantities multiply and unitCost divides by the same factor so cost basis (qty * unitCost) is unchanged.
    // Every affected lot is also logged into SplitAdjustments to preserve full multi-split history.
    await new sql.Request(transaction)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, parsedSplitDate)
      .input('splitId', sql.UniqueIdentifier, splitId)
      .query(`
        UPDATE PurchaseLots
        SET originalQuantity = originalQuantity * @multiplier,
            remainingQuantity = remainingQuantity * @multiplier,
            unitCost = unitCost / @multiplier,
            splitAdjusted = 1,
            lastSplitId = @splitId,
            updatedAt = GETUTCDATE()
        WHERE ticker = @ticker AND purchaseDate <= @splitDate
      `);

    for (const lot of lotTargets.recordset) {
      await new sql.Request(transaction)
        .input('id', sql.UniqueIdentifier, uuidv4())
        .input('splitId', sql.UniqueIdentifier, splitId)
        .input('userId', sql.NVarChar, lot.userId)
        .input('entityType', sql.NVarChar, 'lot')
        .input('entityId', sql.UniqueIdentifier, lot.id)
        .input('multiplier', sql.Decimal(18, 8), multiplier)
        .query(`
          INSERT INTO SplitAdjustments (id, splitId, userId, entityType, entityId, multiplier)
          VALUES (@id, @splitId, @userId, @entityType, @entityId, @multiplier)
        `);
    }

    const transactionTargets = await new sql.Request(transaction)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('splitDate', sql.DateTime2, parsedSplitDate)
      .query(`
        SELECT id, userId
        FROM StockTransactions
        WHERE ticker = @ticker AND transactionDate <= @splitDate AND type IN ('buy', 'sell', 'div')
      `);

    // Update stock transactions for this ticker so historical buy/sell/div records reflect the split too.
    // Dividend ('div') rows are included so reinvested-dividend lots and their originating
    // transaction stay consistent with each other after any number of splits.
    await new sql.Request(transaction)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, parsedSplitDate)
      .input('splitId', sql.UniqueIdentifier, splitId)
      .query(`
        UPDATE StockTransactions
        SET quantity = CASE WHEN quantity IS NOT NULL THEN quantity * @multiplier ELSE NULL END,
            price = CASE WHEN price IS NOT NULL AND quantity IS NOT NULL THEN price / @multiplier ELSE price END,
            splitAdjusted = 1,
            lastSplitId = @splitId,
            updatedAt = GETUTCDATE()
        WHERE ticker = @ticker AND transactionDate <= @splitDate AND type IN ('buy', 'sell', 'div')
      `);

    for (const stockTx of transactionTargets.recordset) {
      await new sql.Request(transaction)
        .input('id', sql.UniqueIdentifier, uuidv4())
        .input('splitId', sql.UniqueIdentifier, splitId)
        .input('userId', sql.NVarChar, stockTx.userId)
        .input('entityType', sql.NVarChar, 'transaction')
        .input('entityId', sql.UniqueIdentifier, stockTx.id)
        .input('multiplier', sql.Decimal(18, 8), multiplier)
        .query(`
          INSERT INTO SplitAdjustments (id, splitId, userId, entityType, entityId, multiplier)
          VALUES (@id, @splitId, @userId, @entityType, @entityId, @multiplier)
        `);
    }

    const allocationTargets = await new sql.Request(transaction)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('splitDate', sql.DateTime2, parsedSplitDate)
      .query(`
        SELECT pla.id, pla.userId
        FROM PurchaseLotAllocations pla
        JOIN StockTransactions st ON pla.saleTransactionId = st.id
        WHERE st.ticker = @ticker AND st.transactionDate <= @splitDate
      `);

    await new sql.Request(transaction)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, parsedSplitDate)
      .query(`
        UPDATE pla
        SET pla.quantityConsumed = pla.quantityConsumed * @multiplier,
            pla.updatedAt = GETUTCDATE()
        FROM PurchaseLotAllocations pla
        JOIN StockTransactions st ON pla.saleTransactionId = st.id
        WHERE st.ticker = @ticker AND st.transactionDate <= @splitDate
      `);

    // Rescale historical PurchaseLotAllocations rows for sales that happened on or before the split date.
    // Those rows recorded "shares consumed" in pre-split terms; without rescaling them they'd
    // permanently drift out of sync with the now-split-adjusted PurchaseLots.remainingQuantity.
    // Note: LotAllocations table is deprecated and no longer used.
    await new sql.Request(transaction)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, parsedSplitDate)
      .input('splitId', sql.UniqueIdentifier, splitId)
      .query(`
        UPDATE pla
        SET pla.quantityConsumed = pla.quantityConsumed * @multiplier,
            pla.updatedAt = GETUTCDATE()
        FROM PurchaseLotAllocations pla
        JOIN StockTransactions st ON pla.saleTransactionId = st.id
        WHERE st.ticker = @ticker AND st.transactionDate <= @splitDate
      `);

    for (const allocation of allocationTargets.recordset) {
      await new sql.Request(transaction)
        .input('id', sql.UniqueIdentifier, uuidv4())
        .input('splitId', sql.UniqueIdentifier, splitId)
        .input('userId', sql.NVarChar, allocation.userId)
        .input('entityType', sql.NVarChar, 'allocation')
        .input('entityId', sql.UniqueIdentifier, allocation.id)
        .input('multiplier', sql.Decimal(18, 8), multiplier)
        .query(`
          INSERT INTO SplitAdjustments (id, splitId, userId, entityType, entityId, multiplier)
          VALUES (@id, @splitId, @userId, @entityType, @entityId, @multiplier)
        `);
    }

      const displayLotReconciliation = await reconcileDisplayLotsAfterSplit(transaction, normalizedTicker);

    await transaction.commit();
    began = false;

    res.json({
      splitId,
      message: 'Stock split applied',
      ticker: normalizedTicker,
      ratioNumerator: Number(ratioNumerator),
      ratioDenominator: Number(ratioDenominator),
      multiplier,
      displayLotReconciliation,
    });
  } catch (error) {
    if (began) {
      try {
        await transaction.rollback();
      } catch {
        // transaction may already be aborted by the driver after the original error; ignore
      }
    }
    res.status(500).json({ error: String(error) });
  }
});

export default router;
