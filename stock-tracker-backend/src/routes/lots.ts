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

// GET lots for specific ticker
router.get('/:ticker', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const userId = req.user?.id!;
    const request = getPool().request();
    
    const result = await request
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .query(`
        SELECT * FROM Lots 
        WHERE userId = @userId AND ticker = @ticker AND remainingQuantity > 0
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
        UPDATE Lots 
        SET remainingQuantity = @remainingQuantity, updatedAt = GETUTCDATE()
        WHERE id = @id AND userId = @userId
      `);
    
    res.json({ id, remainingQuantity });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// APPLY stock split (multiplies all quantities for a ticker retroactively)
router.post('/:ticker/split', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const { multiplier, splitDate } = req.body;
    const userId = req.user?.id!;
    
    if (!multiplier || !splitDate) {
      return res.status(400).json({ error: 'Missing multiplier or splitDate' });
    }
    
    const request = getPool().request();
    
    // Update all lots for this ticker with transactionDate <= splitDate
    await request
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, new Date(splitDate))
      .query(`
        UPDATE Lots
        SET originalQuantity = originalQuantity * @multiplier,
            remainingQuantity = remainingQuantity * @multiplier,
            updatedAt = GETUTCDATE()
        WHERE userId = @userId AND ticker = @ticker AND purchaseDate <= @splitDate
      `);
    
    // Update stock transactions for this ticker
    await request
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, new Date(splitDate))
      .query(`
        UPDATE StockTransactions
        SET quantity = CASE WHEN quantity IS NOT NULL THEN quantity * @multiplier ELSE NULL END,
            price = CASE WHEN price IS NOT NULL AND quantity IS NOT NULL THEN price / @multiplier ELSE price END,
            updatedAt = GETUTCDATE()
        WHERE userId = @userId AND ticker = @ticker AND transactionDate <= @splitDate AND type IN ('buy', 'sell')
      `);
    
    res.json({ message: 'Stock split applied', ticker, multiplier });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
