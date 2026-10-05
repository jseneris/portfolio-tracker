import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/connection.js';
import sql from 'mssql';
import { getCashSummary } from '../services/cash-summary.js';

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

    const summary = await getCashSummary(userId);
    
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
