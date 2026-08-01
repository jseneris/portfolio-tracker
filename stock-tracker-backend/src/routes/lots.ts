import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/connection.js';
import sql from 'mssql';

const router = Router();
const SPLIT_TOLERANCE = 1e-6;


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

// APPLY stock split event and activate it for the current user.
// Split effects are applied dynamically in metrics/projections and are not persisted by mutating
// StockTransactions or PurchaseLots in this endpoint.
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

    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, uuidv4())
      .input('userId', sql.NVarChar, actorUserId)
      .input('splitId', sql.UniqueIdentifier, splitId)
      .input('activatedBy', sql.NVarChar, 'manual')
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM UserSplitActivations WHERE userId = @userId AND splitId = @splitId
        )
        INSERT INTO UserSplitActivations (id, userId, splitId, activatedBy)
        VALUES (@id, @userId, @splitId, @activatedBy)
      `);

    await transaction.commit();
    began = false;

    res.json({
      splitId,
      message: 'Stock split recorded and activated for user',
      ticker: normalizedTicker,
      ratioNumerator: Number(ratioNumerator),
      ratioDenominator: Number(ratioDenominator),
      multiplier,
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
