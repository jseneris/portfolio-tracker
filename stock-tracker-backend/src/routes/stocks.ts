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

// GET portfolio summary in one database call (cash summary + stock rollup)
router.get('/portfolio/summary', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const summaryResult = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query(`
        ;WITH CashAgg AS (
          SELECT
            SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END) AS deposits,
            SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END) AS withdrawals,
            SUM(CASE WHEN type = 'interest' THEN amount ELSE 0 END) AS interest,
            SUM(CASE WHEN type = 'fee' THEN amount ELSE 0 END) AS fees
          FROM CashTransactions
          WHERE userId = @userId
        ),
        StockCashAgg AS (
          SELECT
            SUM(CASE WHEN type = 'buy' THEN amount ELSE 0 END) AS buys,
            SUM(CASE WHEN type = 'sell' THEN amount ELSE 0 END) AS sells
          FROM StockTransactions
          WHERE userId = @userId
        ),
        StockTotals AS (
          SELECT
            SUM(remainingQuantity * unitCost) AS totalStockCostBasis,
            COUNT(DISTINCT ticker) AS stockCount
          FROM Lots
          WHERE userId = @userId AND remainingQuantity > 0
        )
        SELECT
          COALESCE(c.deposits, 0) AS deposits,
          COALESCE(c.withdrawals, 0) AS withdrawals,
          COALESCE(c.interest, 0) AS interest,
          COALESCE(c.fees, 0) AS fees,
          COALESCE(s.buys, 0) AS buys,
          COALESCE(s.sells, 0) AS sells,
          COALESCE(c.deposits, 0) - COALESCE(c.withdrawals, 0) + COALESCE(c.interest, 0) - COALESCE(c.fees, 0) - COALESCE(s.buys, 0) + COALESCE(s.sells, 0) AS availableCash,
          COALESCE(c.deposits, 0) - COALESCE(c.withdrawals, 0) AS cashBasis,
          COALESCE(c.interest, 0) - COALESCE(c.fees, 0) AS adjustments,
          COALESCE(t.totalStockCostBasis, 0) AS totalStockCostBasis,
          COALESCE(t.stockCount, 0) AS stockCount
        FROM CashAgg c
        CROSS JOIN StockCashAgg s
        CROSS JOIN StockTotals t;
      `);

    const stocksResult = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT
          ticker,
          SUM(remainingQuantity) AS totalShares,
          SUM(remainingQuantity * unitCost) AS costBasis,
          COUNT(*) AS lotCount
        FROM Lots
        WHERE userId = @userId AND remainingQuantity > 0
        GROUP BY ticker
        ORDER BY ticker ASC;
      `);

    const summaryRow = (summaryResult.recordset[0] ?? {}) as any;
    const stocks = (stocksResult.recordset ?? []) as any[];

    res.json({
      deposits: Number(summaryRow.deposits || 0),
      withdrawals: Number(summaryRow.withdrawals || 0),
      interest: Number(summaryRow.interest || 0),
      fees: Number(summaryRow.fees || 0),
      buys: Number(summaryRow.buys || 0),
      sells: Number(summaryRow.sells || 0),
      availableCash: Number(summaryRow.availableCash || 0),
      cashBasis: Number(summaryRow.cashBasis || 0),
      adjustments: Number(summaryRow.adjustments || 0),
      totalStockCostBasis: Number(summaryRow.totalStockCostBasis || 0),
      stockCount: Number(summaryRow.stockCount || 0),
      stocks: stocks.map((row: any) => ({
        ticker: row.ticker,
        totalShares: Number(row.totalShares || 0),
        costBasis: Number(row.costBasis || 0),
        lotCount: Number(row.lotCount || 0)
      }))
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

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
          SUM(remainingQuantity * unitCost) as costBasis
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
    const { ticker, type, quantity, price, transactionDate, allocations } = req.body as {
      ticker: string;
      type: string;
      quantity?: number;
      price?: number;
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
      .input('price', sql.Decimal(18, 8), price ?? null)
      .input('amount', sql.Decimal(18, 4), amount)
      .input('transactionDate', sql.DateTime2, new Date(transactionDate))
      .query(`
        INSERT INTO StockTransactions 
        (id, userId, ticker, type, quantity, price, amount, transactionDate)
        VALUES (@id, @userId, @ticker, @type, @quantity, @price, @amount, @transactionDate)
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
        .input('price', sql.Decimal(18, 8), price)
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
        .input('price', sql.Decimal(18, 8), price)
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
    const { ticker, type, quantity, price, transactionDate } = req.body;
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
      .input('price', sql.Decimal(18, 8), price || null)
      .input('amount', sql.Decimal(18, 4), amount)
      .input('transactionDate', sql.DateTime2, new Date(transactionDate))
      .query(`
        UPDATE StockTransactions 
        SET type = @type, quantity = @quantity, price = @price, amount = @amount,
            transactionDate = @transactionDate, updatedAt = GETUTCDATE()
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
