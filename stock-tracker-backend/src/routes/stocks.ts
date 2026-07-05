import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/connection.js';
import sql from 'mssql';

const router = Router();

const ALLOCATION_TOLERANCE = 1e-6;

interface Allocation {
  lotId: string;
  quantity: number;
}

// GET all stock transactions for user
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const request = getPool().request();
    
    const result = await request
      .input('userId', sql.NVarChar, userId)
      .query('SELECT * FROM StockTransactions WHERE userId = @userId ORDER BY transactionDate DESC, ticker ASC');
    
    res.json(result.recordset);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET transactions for specific ticker
router.get('/:ticker', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const userId = req.user?.id!;
    const request = getPool().request();
    
    const result = await request
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .query(`
        SELECT * FROM StockTransactions 
        WHERE userId = @userId AND ticker = @ticker 
        ORDER BY transactionDate ASC
      `);
    
    res.json(result.recordset);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET summary for ticker (total shares, lots, etc.)
router.get('/:ticker/summary', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const userId = req.user?.id!;
    const request = getPool().request();
    
    const lotsResult = await request
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .query(`
        SELECT 
          SUM(remainingQuantity) as totalShares,
          COUNT(*) as numberOfLots,
          SUM(originalQuantity * unitCost) as costBasis
        FROM Lots
        WHERE userId = @userId AND ticker = @ticker
      `);
    
    const lot = lotsResult.recordset[0] || {};
    
    res.json({
      ticker: ticker.toUpperCase(),
      totalShares: lot.totalShares || 0,
      numberOfLots: lot.numberOfLots || 0,
      costBasis: lot.costBasis || 0
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// CREATE stock transaction
router.post('/', async (req: Request, res: Response) => {
  try {
    const { ticker, type, quantity, price, multiplier, transactionDate, allocations } = req.body as {
      ticker: string;
      type: string;
      quantity?: number;
      price?: number;
      multiplier?: number;
      transactionDate: string;
      allocations?: Allocation[];
    };
    const userId = req.user?.id!;
    
    if (!ticker || !type || !transactionDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const normalizedTicker = ticker.toUpperCase();
    const pool = getPool();

    // Calculate amount based on transaction type
    let amount: number | null = null;
    if (type === 'buy' || type === 'sell' || type === 'div') {
      if (quantity == null || price == null) {
        return res.status(400).json({ error: `${type} transactions require quantity and price` });
      }
      amount = quantity * price;
    }

    // Sell transactions require the user to explicitly choose which lots are consumed
    if (type === 'sell') {
      if (!Array.isArray(allocations) || allocations.length === 0) {
        return res.status(400).json({ error: 'Sell transactions require explicit lot allocations' });
      }

      const allocatedTotal = allocations.reduce((sum, a) => sum + Number(a.quantity), 0);
      if (Math.abs(allocatedTotal - Number(quantity)) > ALLOCATION_TOLERANCE) {
        return res.status(400).json({
          error: `Allocated quantity (${allocatedTotal}) does not match sell quantity (${quantity})`
        });
      }

      // Validate each referenced lot belongs to this user/ticker and has enough remaining shares
      for (const allocation of allocations) {
        const lotCheck = await pool.request()
          .input('lotId', sql.UniqueIdentifier, allocation.lotId)
          .input('userId', sql.NVarChar, userId)
          .input('ticker', sql.NVarChar, normalizedTicker)
          .query(`
            SELECT id, remainingQuantity FROM Lots
            WHERE id = @lotId AND userId = @userId AND ticker = @ticker
          `);

        const lotRow = lotCheck.recordset[0];
        if (!lotRow) {
          return res.status(400).json({ error: `Lot ${allocation.lotId} not found for ${normalizedTicker}` });
        }
        if (Number(lotRow.remainingQuantity) + ALLOCATION_TOLERANCE < Number(allocation.quantity)) {
          return res.status(400).json({
            error: `Lot ${allocation.lotId} does not have enough remaining shares to allocate ${allocation.quantity}`
          });
        }
      }
    }
    
    const id = uuidv4();

    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('type', sql.NVarChar, type)
      .input('quantity', sql.Decimal(18, 8), quantity ?? null)
      .input('price', sql.Decimal(18, 4), price ?? null)
      .input('amount', sql.Decimal(18, 4), amount)
      .input('multiplier', sql.Decimal(18, 8), multiplier ?? null)
      .input('transactionDate', sql.DateTime2, new Date(transactionDate))
      .query(`
        INSERT INTO StockTransactions 
        (id, userId, ticker, type, quantity, price, amount, multiplier, transactionDate)
        VALUES (@id, @userId, @ticker, @type, @quantity, @price, @amount, @multiplier, @transactionDate)
      `);
    
    // If it's a buy transaction, create a purchase lot
    if (type === 'buy') {
      const lotId = uuidv4();
      await pool.request()
        .input('lotId', sql.UniqueIdentifier, lotId)
        .input('userId', sql.NVarChar, userId)
        .input('ticker', sql.NVarChar, normalizedTicker)
        .input('transactionId', sql.UniqueIdentifier, id)
        .input('quantity', sql.Decimal(18, 8), quantity)
        .input('price', sql.Decimal(18, 4), price)
        .input('transactionDate', sql.DateTime2, new Date(transactionDate))
        .query(`
          INSERT INTO Lots (id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate)
          VALUES (@lotId, @userId, @ticker, @transactionId, 'purchase', @quantity, @quantity, @price, @transactionDate)
        `);
    }

    // Dividends are reinvested only: they create their own lot rather than affecting cash directly
    if (type === 'div') {
      const lotId = uuidv4();
      await pool.request()
        .input('lotId', sql.UniqueIdentifier, lotId)
        .input('userId', sql.NVarChar, userId)
        .input('ticker', sql.NVarChar, normalizedTicker)
        .input('transactionId', sql.UniqueIdentifier, id)
        .input('quantity', sql.Decimal(18, 8), quantity)
        .input('price', sql.Decimal(18, 4), price)
        .input('transactionDate', sql.DateTime2, new Date(transactionDate))
        .query(`
          INSERT INTO Lots (id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate)
          VALUES (@lotId, @userId, @ticker, @transactionId, 'dividend', @quantity, @quantity, @price, @transactionDate)
        `);
    }

    // Sells consume the lots the user explicitly chose, recording the allocation for auditability
    if (type === 'sell' && allocations) {
      for (const allocation of allocations) {
        await pool.request()
          .input('lotId', sql.UniqueIdentifier, allocation.lotId)
          .input('userId', sql.NVarChar, userId)
          .input('quantity', sql.Decimal(18, 8), allocation.quantity)
          .query(`
            UPDATE Lots
            SET remainingQuantity = remainingQuantity - @quantity, updatedAt = GETUTCDATE()
            WHERE id = @lotId AND userId = @userId
          `);

        const allocationId = uuidv4();
        await pool.request()
          .input('allocationId', sql.UniqueIdentifier, allocationId)
          .input('userId', sql.NVarChar, userId)
          .input('saleTransactionId', sql.UniqueIdentifier, id)
          .input('lotId', sql.UniqueIdentifier, allocation.lotId)
          .input('quantity', sql.Decimal(18, 8), allocation.quantity)
          .query(`
            INSERT INTO LotAllocations (id, userId, saleTransactionId, lotId, quantityConsumed)
            VALUES (@allocationId, @userId, @saleTransactionId, @lotId, @quantity)
          `);
      }
    }
    
    res.status(201).json({ id, ticker: normalizedTicker, type, quantity, price, amount, transactionDate });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { ticker, type, quantity, price, multiplier, transactionDate } = req.body;
    const userId = req.user?.id!;
    
    const request = getPool().request();
    
    let amount = null;
    if (type === 'buy' || type === 'sell') {
      amount = quantity * price;
    } else if (type === 'div') {
      amount = quantity;
    }
    
    await request
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.NVarChar, userId)
      .input('type', sql.NVarChar, type)
      .input('quantity', sql.Decimal(18, 8), quantity || null)
      .input('price', sql.Decimal(18, 4), price || null)
      .input('amount', sql.Decimal(18, 4), amount)
      .input('multiplier', sql.Decimal(18, 4), multiplier || null)
      .input('transactionDate', sql.DateTime2, new Date(transactionDate))
      .query(`
        UPDATE StockTransactions 
        SET type = @type, quantity = @quantity, price = @price, amount = @amount, 
            multiplier = @multiplier, transactionDate = @transactionDate, updatedAt = GETUTCDATE()
        WHERE id = @id AND userId = @userId
      `);
    
    res.json({ id, ticker, type, quantity, price, transactionDate });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// DELETE stock transaction
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id!;
    
    const request = getPool().request();
    
    // Delete associated lots first
    await request
      .input('id', sql.UniqueIdentifier, id)
      .query('DELETE FROM Lots WHERE transactionId = @id');
    
    // Delete the transaction
    await request
      .input('userId', sql.NVarChar, userId)
      .query('DELETE FROM StockTransactions WHERE id = @id AND userId = @userId');
    
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
