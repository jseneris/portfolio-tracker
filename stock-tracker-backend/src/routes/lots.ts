import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/connection.js';
import sql from 'mssql';

const router = Router();

// GET all lots for user
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const request = getPool().request();
    
    const result = await request
      .input('userId', sql.NVarChar, userId)
      .query('SELECT * FROM Lots WHERE userId = @userId ORDER BY purchaseDate ASC');
    
    res.json(result.recordset);
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
      SELECT * FROM Lots 
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
        UPDATE Lots 
        SET remainingQuantity = @remainingQuantity, updatedAt = GETUTCDATE()
        WHERE id = @id AND userId = @userId
      `);
    
    res.json({ id, remainingQuantity });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// APPLY stock split (multiplies all quantities for a ticker retroactively, preserving cost basis)
router.post('/:ticker/split', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const { multiplier, splitDate } = req.body;
    const userId = req.user?.id!;
    
    if (!multiplier || !splitDate) {
      return res.status(400).json({ error: 'Missing multiplier or splitDate' });
    }

    const normalizedTicker = ticker.toUpperCase();
    const pool = getPool();

    // Record the split event for auditability/idempotency
    const splitId = uuidv4();
    await pool.request()
      .input('splitId', sql.UniqueIdentifier, splitId)
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, new Date(splitDate))
      .query(`
        INSERT INTO StockSplits (id, userId, ticker, multiplier, splitDate)
        VALUES (@splitId, @userId, @ticker, @multiplier, @splitDate)
      `);
    
    // Update all lots for this ticker with purchaseDate <= splitDate.
    // Quantities multiply and unitCost divides by the same factor so cost basis (qty * unitCost) is unchanged.
    await pool.request()
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, new Date(splitDate))
      .input('splitId', sql.UniqueIdentifier, splitId)
      .query(`
        UPDATE Lots
        SET originalQuantity = originalQuantity * @multiplier,
            remainingQuantity = remainingQuantity * @multiplier,
            unitCost = unitCost / @multiplier,
            splitAdjusted = 1,
            lastSplitId = @splitId,
            updatedAt = GETUTCDATE()
        WHERE userId = @userId AND ticker = @ticker AND purchaseDate <= @splitDate
      `);
    
    // Update stock transactions for this ticker so historical buy/sell records reflect the split too
    await pool.request()
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, new Date(splitDate))
      .input('splitId', sql.UniqueIdentifier, splitId)
      .query(`
        UPDATE StockTransactions
        SET quantity = CASE WHEN quantity IS NOT NULL THEN quantity * @multiplier ELSE NULL END,
            price = CASE WHEN price IS NOT NULL AND quantity IS NOT NULL THEN price / @multiplier ELSE price END,
            splitAdjusted = 1,
            lastSplitId = @splitId,
            updatedAt = GETUTCDATE()
        WHERE userId = @userId AND ticker = @ticker AND transactionDate <= @splitDate AND type IN ('buy', 'sell')
      `);
    
    res.json({ splitId, message: 'Stock split applied', ticker: normalizedTicker, multiplier });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
