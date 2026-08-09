import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/connection.js';
import sql from 'mssql';

const router = Router();
const SPLIT_TOLERANCE = 1e-6;

type DisplayLotsRow = {
  id: string;
  userId: string;
  ticker: string;
  lotsCsv: string;
};

function parseDisplayLotsCsv(lotsCsv: string): number[] {
  if (!lotsCsv || !lotsCsv.trim()) {
    return [];
  }

  return lotsCsv
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > SPLIT_TOLERANCE);
}

function serializeDisplayLotsCsv(lots: number[]): string {
  return lots.map((value) => Number(value.toFixed(8))).join(',');
}

async function getDisplayLotsRowByTicker(
  tx: sql.Transaction,
  userId: string,
  ticker: string
): Promise<DisplayLotsRow | null> {
  const result = await new sql.Request(tx)
    .input('userId', sql.NVarChar, userId)
    .input('ticker', sql.NVarChar, ticker)
    .query(`
      SELECT TOP 1 id, userId, ticker, lotsCsv
      FROM DisplayLots
      WHERE userId = @userId AND ticker = @ticker
    `);

  if (result.recordset.length === 0) {
    return null;
  }

  return result.recordset[0] as DisplayLotsRow;
}

async function persistDisplayLotsCsvForTicker(
  tx: sql.Transaction,
  userId: string,
  ticker: string,
  lots: number[]
): Promise<void> {
  const existing = await getDisplayLotsRowByTicker(tx, userId, ticker);
  const normalizedLots = lots.filter((value) => value > SPLIT_TOLERANCE);

  if (normalizedLots.length === 0) {
    if (existing) {
      await new sql.Request(tx)
        .input('id', sql.UniqueIdentifier, existing.id)
        .input('userId', sql.NVarChar, userId)
        .query('DELETE FROM DisplayLots WHERE id = @id AND userId = @userId');
    }
    return;
  }

  const lotsCsv = serializeDisplayLotsCsv(normalizedLots);
  if (existing) {
    await new sql.Request(tx)
      .input('id', sql.UniqueIdentifier, existing.id)
      .input('userId', sql.NVarChar, userId)
      .input('lotsCsv', sql.NVarChar(sql.MAX), lotsCsv)
      .query(`
        UPDATE DisplayLots
        SET lotsCsv = @lotsCsv, updatedAt = GETUTCDATE()
        WHERE id = @id AND userId = @userId
      `);
    return;
  }

  await new sql.Request(tx)
    .input('id', sql.UniqueIdentifier, uuidv4())
    .input('userId', sql.NVarChar, userId)
    .input('ticker', sql.NVarChar, ticker)
    .input('lotsCsv', sql.NVarChar(sql.MAX), lotsCsv)
    .query(`
      INSERT INTO DisplayLots (id, userId, ticker, lotsCsv)
      VALUES (@id, @userId, @ticker, @lotsCsv)
    `);
}

async function appendDisplayLotQuantity(
  tx: sql.Transaction,
  userId: string,
  ticker: string,
  quantity: number
): Promise<void> {
  if (!Number.isFinite(quantity) || quantity <= SPLIT_TOLERANCE) {
    return;
  }

  const existing = await getDisplayLotsRowByTicker(tx, userId, ticker);
  const currentLots = existing ? parseDisplayLotsCsv(existing.lotsCsv) : [];
  currentLots.push(Number(quantity.toFixed(8)));
  await persistDisplayLotsCsvForTicker(tx, userId, ticker, currentLots);
}

async function consumeDisplayLotQuantitySmallestFirst(
  tx: sql.Transaction,
  userId: string,
  ticker: string,
  quantityToConsume: number
): Promise<void> {
  if (!Number.isFinite(quantityToConsume) || quantityToConsume <= SPLIT_TOLERANCE) {
    return;
  }

  const existing = await getDisplayLotsRowByTicker(tx, userId, ticker);
  if (!existing) {
    return;
  }

  const lots = parseDisplayLotsCsv(existing.lotsCsv).sort((a, b) => a - b);
  let remaining = quantityToConsume;
  const nextLots: number[] = [];

  for (const lot of lots) {
    if (remaining <= SPLIT_TOLERANCE) {
      nextLots.push(lot);
      continue;
    }

    const consumed = Math.min(lot, remaining);
    const leftover = lot - consumed;
    remaining -= consumed;
    if (leftover > SPLIT_TOLERANCE) {
      nextLots.push(Number(leftover.toFixed(8)));
    }
  }

  await persistDisplayLotsCsvForTicker(tx, userId, ticker, nextLots);
}

async function reconcileDisplayLotsAfterSplit(tx: sql.Transaction, userId: string, ticker: string): Promise<void> {
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
  const existing = await getDisplayLotsRowByTicker(tx, userId, ticker);
  const displayTotal = parseDisplayLotsCsv(String(existing?.lotsCsv || '')).reduce((sum, qty) => sum + qty, 0);
  const delta = targetTotal - displayTotal;

  if (delta > SPLIT_TOLERANCE) {
    await appendDisplayLotQuantity(tx, userId, ticker, delta);
    return;
  }

  if (delta < -SPLIT_TOLERANCE) {
    await consumeDisplayLotQuantitySmallestFirst(tx, userId, ticker, Math.abs(delta));
  }
}

async function isSplitEligibleForUser(
  db: sql.ConnectionPool | sql.Transaction,
  userId: string,
  ticker: string,
  splitDate: Date
): Promise<boolean> {
  const result = await db.request()
    .input('userId', sql.NVarChar, userId)
    .input('ticker', sql.NVarChar, ticker)
    .input('splitDate', sql.DateTime2, splitDate)
    .query(`
      SELECT CASE
        WHEN EXISTS (
          SELECT 1
          FROM StockTransactions st
          WHERE st.userId = @userId
            AND st.ticker = @ticker
            AND st.transactionDate >= @splitDate
        ) OR EXISTS (
          SELECT 1
          FROM HistoricalPrices hp
          WHERE hp.ticker = @ticker
            AND hp.priceDate >= CONVERT(date, @splitDate)
        )
        THEN 1 ELSE 0 END AS isEligible
    `);

  return Number(result.recordset[0]?.isEligible || 0) === 1;
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
    const userId = req.user?.id!;

    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .query(`
        SELECT
          ss.id,
          ss.ticker,
          ss.ratioNumerator,
          ss.ratioDenominator,
          ss.multiplier,
          ss.splitDate,
          ss.createdAt,
          CASE WHEN EXISTS (
            SELECT 1
            FROM UserSplitActivations usa
            WHERE usa.userId = @userId
              AND usa.splitId = ss.id
          ) THEN 1 ELSE 0 END AS isActive,
          1 AS canActivate
        FROM StockSplits ss
        WHERE ss.ticker = @ticker
        ORDER BY ss.splitDate DESC, ss.createdAt DESC
      `);

    res.json(result.recordset.map((row: any) => ({
      id: row.id,
      ticker: row.ticker,
      ratioNumerator: Number(row.ratioNumerator),
      ratioDenominator: Number(row.ratioDenominator),
      multiplier: Number(row.multiplier),
      splitDate: row.splitDate,
      createdAt: row.createdAt,
      isActive: Number(row.isActive || 0) === 1,
      canActivate: Number(row.canActivate || 0) === 1,
    })));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET all split history records (global)
router.get('/splits', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT
          ss.id,
          ss.ticker,
          ss.ratioNumerator,
          ss.ratioDenominator,
          ss.multiplier,
          ss.splitDate,
          ss.createdAt,
          CASE WHEN EXISTS (
            SELECT 1 FROM UserSplitActivations usa
            WHERE usa.userId = @userId AND usa.splitId = ss.id
          ) THEN 1 ELSE 0 END AS isActive,
          1 AS canActivate
        FROM StockSplits ss
        ORDER BY ss.splitDate DESC, ss.createdAt DESC
      `);

    res.json(result.recordset.map((row: any) => ({
      id: row.id,
      ticker: row.ticker,
      ratioNumerator: Number(row.ratioNumerator),
      ratioDenominator: Number(row.ratioDenominator),
      multiplier: Number(row.multiplier),
      splitDate: row.splitDate,
      createdAt: row.createdAt,
      isActive: Number(row.isActive || 0) === 1,
      canActivate: Number(row.canActivate || 0) === 1,
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

// RECORD stock split event globally. User activation is a separate step.
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
    let splitId = '';
    if (dupeCheck.recordset.length > 0) {
      splitId = String(dupeCheck.recordset[0].id);
    } else {
      const insertSplit = await new sql.Request(transaction)
        .input('id', sql.UniqueIdentifier, uuidv4())
        .input('ticker', sql.NVarChar, normalizedTicker)
        .input('ratioNumerator', sql.Decimal(18, 8), ratioNumerator)
        .input('ratioDenominator', sql.Decimal(18, 8), ratioDenominator)
        .input('multiplier', sql.Decimal(18, 8), multiplier)
        .input('splitDate', sql.DateTime2, parsedSplitDate)
        .query(`
          INSERT INTO StockSplits (id, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate)
          OUTPUT INSERTED.id
          VALUES (@id, @ticker, @ratioNumerator, @ratioDenominator, @multiplier, @splitDate)
        `);
      splitId = String(insertSplit.recordset[0]?.id || '');
    }

    await transaction.commit();
    began = false;

    res.json({
      splitId,
      message: 'Stock split recorded.',
      ticker: normalizedTicker,
      ratioNumerator: Number(ratioNumerator),
      ratioDenominator: Number(ratioDenominator),
      multiplier,
      isActive: false,
      canActivate: true,
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

router.post('/splits/:splitId/activate', async (req: Request, res: Response) => {
  const pool = getPool();
  const transaction = new sql.Transaction(pool);
  let began = false;

  try {
    const { splitId } = req.params;
    const actorUserId = req.user?.id!;

    await transaction.begin();
    began = true;

    const splitResult = await new sql.Request(transaction)
      .input('splitId', sql.UniqueIdentifier, splitId)
      .query(`
        SELECT id, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate
        FROM StockSplits
        WHERE id = @splitId
      `);

    if (splitResult.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Split not found' });
    }

    const splitRow = splitResult.recordset[0] as any;
    const ticker = String(splitRow.ticker || '').toUpperCase();
    const splitDate = new Date(splitRow.splitDate);
    const multiplier = Number(splitRow.multiplier || 0);

    const alreadyActive = await new sql.Request(transaction)
      .input('userId', sql.NVarChar, actorUserId)
      .input('splitId', sql.UniqueIdentifier, splitId)
      .query(`
        SELECT TOP 1 id
        FROM UserSplitActivations
        WHERE userId = @userId AND splitId = @splitId
      `);

    if (alreadyActive.recordset.length > 0) {
      await transaction.commit();
      began = false;
      return res.json({
        splitId,
        message: 'Stock split already active for user.',
        ticker,
        ratioNumerator: Number(splitRow.ratioNumerator || 0),
        ratioDenominator: Number(splitRow.ratioDenominator || 0),
        multiplier,
        isActive: true,
        canActivate: true,
      });
    }

    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, uuidv4())
      .input('userId', sql.NVarChar, actorUserId)
      .input('splitId', sql.UniqueIdentifier, splitId)
      .input('activatedBy', sql.NVarChar, 'manual')
      .query(`
        INSERT INTO UserSplitActivations (id, userId, splitId, activatedBy)
        VALUES (@id, @userId, @splitId, @activatedBy)
      `);

    await new sql.Request(transaction)
      .input('userId', sql.NVarChar, actorUserId)
      .input('ticker', sql.NVarChar, ticker)
      .input('splitId', sql.UniqueIdentifier, splitId)
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, splitDate)
      .query(`
        UPDATE PurchaseLots
        SET originalQuantity = originalQuantity * @multiplier,
            remainingQuantity = remainingQuantity * @multiplier,
            unitCost = unitCost / @multiplier,
            splitAdjusted = 1,
            lastSplitId = @splitId,
            updatedAt = GETUTCDATE()
        WHERE userId = @userId
          AND ticker = @ticker
          AND purchaseDate <= @splitDate
          AND remainingQuantity > 0
      `);

    await reconcileDisplayLotsAfterSplit(transaction, actorUserId, ticker);

    await transaction.commit();
    began = false;

    res.json({
      splitId,
      message: 'Stock split activated for user.',
      ticker,
      ratioNumerator: Number(splitRow.ratioNumerator || 0),
      ratioDenominator: Number(splitRow.ratioDenominator || 0),
      multiplier,
      isActive: true,
      canActivate: true,
    });
  } catch (error) {
    if (began) {
      try {
        await transaction.rollback();
      } catch {
        // ignore nested rollback failures
      }
    }
    res.status(500).json({ error: String(error) });
  }
});

export default router;
