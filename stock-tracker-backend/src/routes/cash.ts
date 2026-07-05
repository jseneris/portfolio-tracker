import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/connection.js';
import sql from 'mssql';

const router = Router();

// GET all cash transactions for user
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const request = getPool().request();
    
    const result = await request
      .input('userId', sql.NVarChar, userId)
      .query('SELECT * FROM CashTransactions WHERE userId = @userId ORDER BY transactionDate DESC');
    
    res.json(result.recordset);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET cash summary
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;

    const cashRequest = getPool().request();
    const cashResult = await cashRequest
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT 
          SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END) as deposits,
          SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END) as withdrawals,
          SUM(CASE WHEN type = 'interest' THEN amount ELSE 0 END) as interest,
          SUM(CASE WHEN type = 'fee' THEN amount ELSE 0 END) as fees
        FROM CashTransactions
        WHERE userId = @userId
      `);

    const stockRequest = getPool().request();
    const stockResult = await stockRequest
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT
          SUM(CASE WHEN type = 'buy' THEN amount ELSE 0 END) as buys,
          SUM(CASE WHEN type = 'sell' THEN amount ELSE 0 END) as sells
        FROM StockTransactions
        WHERE userId = @userId
      `);
    
    const cashRow = cashResult.recordset[0] || {};
    const stockRow = stockResult.recordset[0] || {};
    const deposits = Number(cashRow.deposits || 0);
    const withdrawals = Number(cashRow.withdrawals || 0);
    const interest = Number(cashRow.interest || 0);
    const fees = Number(cashRow.fees || 0);
    const buys = Number(stockRow.buys || 0);
    const sells = Number(stockRow.sells || 0);

    const summary = {
      deposits,
      withdrawals,
      interest,
      fees,
      buys,
      sells,
      availableCash: deposits - withdrawals + interest - fees - buys + sells,
      costBasis: deposits - withdrawals,
      adjustments: interest - fees
    };
    
    res.json(summary);
  } catch (error) {
    console.error('cash summary error', error);
    res.status(500).json({ error: String(error) });
  }
});

// CREATE cash transaction
router.post('/', async (req: Request, res: Response) => {
  try {
    const { type, amount, transactionDate } = req.body;
    const userId = req.user?.id!;
    
    if (!type || !amount || !transactionDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const id = uuidv4();
    const request = getPool().request();
    
    await request
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.NVarChar, userId)
      .input('type', sql.NVarChar, type)
      .input('amount', sql.Decimal(18, 2), amount)
      .input('transactionDate', sql.DateTime2, new Date(transactionDate))
      .query(`
        INSERT INTO CashTransactions (id, userId, type, amount, transactionDate)
        VALUES (@id, @userId, @type, @amount, @transactionDate)
      `);
    
    res.status(201).json({ id, type, amount, transactionDate });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// UPDATE cash transaction
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { type, amount, transactionDate } = req.body;
    const userId = req.user?.id!;
    
    const request = getPool().request();
    
    await request
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.NVarChar, userId)
      .input('type', sql.NVarChar, type)
      .input('amount', sql.Decimal(18, 2), amount)
      .input('transactionDate', sql.DateTime2, new Date(transactionDate))
      .query(`
        UPDATE CashTransactions 
        SET type = @type, amount = @amount, transactionDate = @transactionDate, updatedAt = GETUTCDATE()
        WHERE id = @id AND userId = @userId
      `);
    
    res.json({ id, type, amount, transactionDate });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// DELETE cash transaction
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id!;
    
    const request = getPool().request();
    
    await request
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.NVarChar, userId)
      .query('DELETE FROM CashTransactions WHERE id = @id AND userId = @userId');
    
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
