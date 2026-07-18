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

interface OpenLot {
  id: string;
  transactionId: string;
  remainingQuantity: number;
}

interface PurchaseLot {
  id: string;
  transactionId: string;
  remainingQuantity: number;
}

function buildSmallestFirstConsumption(openLots: OpenLot[], sellQuantity: number): Allocation[] {
  let remainingToSell = Number(sellQuantity);
  const consumptionPlan: Allocation[] = [];

  for (const lot of openLots) {
    if (remainingToSell <= ALLOCATION_TOLERANCE) {
      break;
    }

    const lotRemaining = Number(lot.remainingQuantity);
    if (!Number.isFinite(lotRemaining) || lotRemaining <= ALLOCATION_TOLERANCE) {
      continue;
    }

    const quantityToConsume = Math.min(lotRemaining, remainingToSell);
    if (quantityToConsume > ALLOCATION_TOLERANCE) {
      consumptionPlan.push({ lotId: lot.id, quantity: quantityToConsume });
      remainingToSell -= quantityToConsume;
    }
  }

  return consumptionPlan;
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
          FROM PurchaseLots
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
          SUM(CASE WHEN sourceType = 'purchase' THEN 1 ELSE 0 END) AS lotCount
        FROM PurchaseLots
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
        ORDER BY transactionDate DESC
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
        FROM PurchaseLots
        WHERE userId = @userId AND ticker = @ticker AND remainingQuantity > 0
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

// GET allocations for a specific sale transaction (which purchase lots it affected)
router.get('/:transactionId/allocations', async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user?.id!;

    const result = await getPool().request()
      .input('transactionId', sql.UniqueIdentifier, transactionId)
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT 
          pla.purchaseLotId as lotId,
          pla.quantityConsumed as quantity,
          pl.ticker,
          pl.purchaseDate,
          pl.unitCost
        FROM PurchaseLotAllocations pla
        JOIN PurchaseLots pl ON pla.purchaseLotId = pl.id
        WHERE pla.saleTransactionId = @transactionId AND pla.userId = @userId
        ORDER BY pl.purchaseDate ASC
      `);

    res.json(result.recordset.map((row: any) => ({
      lotId: row.lotId,
      quantity: Number(row.quantity || 0),
      ticker: row.ticker,
      purchaseDate: row.purchaseDate,
      unitCost: Number(row.unitCost || 0)
    })));
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
    let finalQuantity = quantity;
    let finalPrice = price;
    
    if (type === 'buy' || type === 'sell' || type === 'div') {
      if (quantity == null || price == null) {
        return res.status(400).json({ error: `${type} transactions require quantity and price` });
      }
      amount = quantity * price;
    }

    let sellConsumptionPlan: Allocation[] = [];
    let purchaseAttributionPlan: Allocation[] = [];

    // Sell transactions require explicit allocations in the request, but matching is applied
    // smallest-lot-first to close out full lots whenever possible.
    if (type === 'sell') {
      if (!Array.isArray(allocations) || allocations.length === 0) {
        return res.status(400).json({ error: 'Sell transactions require explicit lot allocations' });
      }

      for (const allocation of allocations) {
        const requested = Number(allocation.quantity);
        if (!allocation?.lotId || !Number.isFinite(requested) || requested <= 0) {
          return res.status(400).json({ error: 'Each sell allocation must include lotId and quantity > 0' });
        }
      }

      const allocatedTotal = allocations.reduce((sum, a) => sum + Number(a.quantity), 0);
      if (Math.abs(allocatedTotal - Number(quantity)) > ALLOCATION_TOLERANCE) {
        return res.status(400).json({
          error: `Allocated quantity (${allocatedTotal}) does not match sell quantity (${quantity})`
        });
      }

      purchaseAttributionPlan = allocations.map((allocation) => ({
        lotId: String(allocation.lotId),
        quantity: Number(allocation.quantity),
      }));

      const openLotsResult = await pool.request()
        .input('userId', sql.NVarChar, userId)
        .input('ticker', sql.NVarChar, normalizedTicker)
        .query(`
          SELECT id, transactionId, remainingQuantity
          FROM PurchaseLots
          WHERE userId = @userId AND ticker = @ticker AND remainingQuantity > 0
          ORDER BY remainingQuantity ASC, purchaseDate ASC, id ASC
        `);

      const openLots = (openLotsResult.recordset ?? []).map((lot) => ({
        id: String(lot.id),
        transactionId: String(lot.transactionId),
        remainingQuantity: Number(lot.remainingQuantity),
      }));

      const totalOpenShares = openLots.reduce((sum, lot) => sum + Number(lot.remainingQuantity), 0);
      if (totalOpenShares + ALLOCATION_TOLERANCE < Number(quantity)) {
        return res.status(400).json({
          error: `Not enough shares to sell ${quantity} from ${normalizedTicker}`
        });
      }

      const purchaseLotsResult = await pool.request()
        .input('userId', sql.NVarChar, userId)
        .input('ticker', sql.NVarChar, normalizedTicker)
        .query(`
        SELECT id, transactionId, remainingQuantity, purchaseDate
        FROM PurchaseLots
        WHERE userId = @userId
          AND ticker = @ticker
      `);

      const purchaseLots = (purchaseLotsResult.recordset ?? []).map((lot) => ({
        id: String(lot.id),
        transactionId: String(lot.transactionId),
        remainingQuantity: Number(lot.remainingQuantity),
        purchaseDate: new Date(lot.purchaseDate),
      } as PurchaseLot & { purchaseDate: Date }));

      // Validate that all allocated purchase lots have a purchase date on or before the sale date
      const saleDate = new Date(transactionDate);
      for (const allocation of allocations) {
        const purchaseLot = purchaseLots.find((lot) => lot.id === allocation.lotId);
        if (!purchaseLot) {
          return res.status(400).json({ error: `Purchase lot ${allocation.lotId} not found for ${normalizedTicker}` });
        }
        if (purchaseLot.purchaseDate > saleDate) {
          return res.status(400).json({
            error: `Cannot allocate purchase lot dated ${purchaseLot.purchaseDate.toISOString().slice(0, 10)} to sale dated ${transactionDate}. Purchases must occur before or on the sale date.`
          });
        }
      }

      const openLotsById = new Map(openLots.map((lot) => [lot.id, lot]));
      const purchaseLotsById = new Map(purchaseLots.map((lot) => [lot.id, lot]));
      const purchaseLotIdByTransactionId = new Map<string, string>();
      for (const purchaseLot of purchaseLots) {
        if (!purchaseLotIdByTransactionId.has(purchaseLot.transactionId)) {
          purchaseLotIdByTransactionId.set(purchaseLot.transactionId, purchaseLot.id);
        }
      }

      // Allow allocation lotIds to reference either purchase lots (attribution layer)
      // or open lots (operational layer). Open-lot IDs are mapped back to the
      // corresponding purchase lot by transactionId.
      purchaseAttributionPlan = purchaseAttributionPlan.map((allocation) => {
        const directPurchaseLot = purchaseLotsById.get(allocation.lotId);
        if (directPurchaseLot) {
          return allocation;
        }

        const openLot = openLotsById.get(allocation.lotId);
        if (!openLot) {
          return allocation;
        }

        const mappedPurchaseLotId = purchaseLotIdByTransactionId.get(openLot.transactionId);
        if (!mappedPurchaseLotId) {
          return allocation;
        }

        return {
          lotId: mappedPurchaseLotId,
          quantity: allocation.quantity,
        };
      });

      const remainingByPurchaseLotId = new Map<string, number>();
      for (const purchaseLot of purchaseLots) {
        remainingByPurchaseLotId.set(purchaseLot.id, Number(purchaseLot.remainingQuantity));
      }

      const requestedByPurchaseLotId = new Map<string, number>();
      for (const allocation of purchaseAttributionPlan) {
        if (!remainingByPurchaseLotId.has(allocation.lotId)) {
          return res.status(400).json({ error: `Purchase lot ${allocation.lotId} not found for ${normalizedTicker}` });
        }
        requestedByPurchaseLotId.set(
          allocation.lotId,
          Number(requestedByPurchaseLotId.get(allocation.lotId) ?? 0) + Number(allocation.quantity)
        );
      }

      for (const [purchaseLotId, requestedQuantity] of requestedByPurchaseLotId.entries()) {
        const lotRemaining = remainingByPurchaseLotId.get(purchaseLotId);
        if (lotRemaining == null) {
          return res.status(400).json({ error: `Purchase lot ${purchaseLotId} not found for ${normalizedTicker}` });
        }
        if (lotRemaining + ALLOCATION_TOLERANCE < Number(requestedQuantity)) {
          return res.status(400).json({
            error: `Purchase lot ${purchaseLotId} has only ${lotRemaining} remaining shares`
          });
        }
      }

      sellConsumptionPlan = buildSmallestFirstConsumption(openLots, Number(quantity));
      const consumedTotal = sellConsumptionPlan.reduce((sum, row) => sum + Number(row.quantity), 0);
      if (Math.abs(consumedTotal - Number(quantity)) > ALLOCATION_TOLERANCE) {
        return res.status(400).json({
          error: `Unable to match sell quantity (${quantity}) against open lots`
        });
      }
    }
    
    const id = uuidv4();

    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      await new sql.Request(tx)
        .input('id', sql.UniqueIdentifier, id)
        .input('userId', sql.NVarChar, userId)
        .input('ticker', sql.NVarChar, normalizedTicker)
        .input('type', sql.NVarChar, type)
        .input('quantity', sql.Decimal(18, 8), finalQuantity ?? null)
        .input('price', sql.Decimal(18, 8), finalPrice ?? null)
        .input('amount', sql.Decimal(18, 4), amount)
        .input('transactionDate', sql.DateTime2, new Date(transactionDate))
        .query(`
          INSERT INTO StockTransactions 
          (id, userId, ticker, type, quantity, price, amount, transactionDate)
          VALUES (@id, @userId, @ticker, @type, @quantity, @price, @amount, @transactionDate)
        `);
      

      // If it's a buy transaction, create a purchase lot and a matching display lot
      if (type === 'buy') {
        const lotId = uuidv4();
        await new sql.Request(tx)
          .input('lotId', sql.UniqueIdentifier, lotId)
          .input('userId', sql.NVarChar, userId)
          .input('ticker', sql.NVarChar, normalizedTicker)
          .input('transactionId', sql.UniqueIdentifier, id)
          .input('quantity', sql.Decimal(18, 8), quantity)
          .input('price', sql.Decimal(18, 8), price)
          .input('transactionDate', sql.DateTime2, new Date(transactionDate))
          .query(`
            INSERT INTO PurchaseLots (id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate)
            VALUES (@lotId, @userId, @ticker, @transactionId, 'purchase', @quantity, @quantity, @price, @transactionDate)
          `);

        const displayLotId = uuidv4();
        await new sql.Request(tx)
          .input('displayLotId', sql.UniqueIdentifier, displayLotId)
          .input('userId', sql.NVarChar, userId)
          .input('ticker', sql.NVarChar, normalizedTicker)
          .input('totalQuantity', sql.Decimal(18, 8), quantity)
          .query(`
            INSERT INTO DisplayLots (id, userId, ticker, totalQuantity)
            VALUES (@displayLotId, @userId, @ticker, @totalQuantity)
          `);

        await new sql.Request(tx)
          .input('compositionId', sql.UniqueIdentifier, uuidv4())
          .input('displayLotId', sql.UniqueIdentifier, displayLotId)
          .input('purchaseLotId', sql.UniqueIdentifier, lotId)
          .input('quantityAllocated', sql.Decimal(18, 8), quantity)
          .query(`
            INSERT INTO DisplayLotComposition (id, displayLotId, purchaseLotId, quantityAllocated)
            VALUES (@compositionId, @displayLotId, @purchaseLotId, @quantityAllocated)
          `);
      }

      // Dividends create a purchase lot (sourceType=dividend) and a matching display lot
      if (type === 'div') {
        const lotId = uuidv4();
        await new sql.Request(tx)
          .input('lotId', sql.UniqueIdentifier, lotId)
          .input('userId', sql.NVarChar, userId)
          .input('ticker', sql.NVarChar, normalizedTicker)
          .input('transactionId', sql.UniqueIdentifier, id)
          .input('quantity', sql.Decimal(18, 8), quantity)
          .input('price', sql.Decimal(18, 8), price)
          .input('transactionDate', sql.DateTime2, new Date(transactionDate))
          .query(`
            INSERT INTO PurchaseLots (id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate)
            VALUES (@lotId, @userId, @ticker, @transactionId, 'dividend', @quantity, @quantity, @price, @transactionDate)
          `);

        const displayLotId = uuidv4();
        await new sql.Request(tx)
          .input('displayLotId', sql.UniqueIdentifier, displayLotId)
          .input('userId', sql.NVarChar, userId)
          .input('ticker', sql.NVarChar, normalizedTicker)
          .input('totalQuantity', sql.Decimal(18, 8), quantity)
          .query(`
            INSERT INTO DisplayLots (id, userId, ticker, totalQuantity)
            VALUES (@displayLotId, @userId, @ticker, @totalQuantity)
          `);

        await new sql.Request(tx)
          .input('compositionId', sql.UniqueIdentifier, uuidv4())
          .input('displayLotId', sql.UniqueIdentifier, displayLotId)
          .input('purchaseLotId', sql.UniqueIdentifier, lotId)
          .input('quantityAllocated', sql.Decimal(18, 8), quantity)
          .query(`
            INSERT INTO DisplayLotComposition (id, displayLotId, purchaseLotId, quantityAllocated)
            VALUES (@compositionId, @displayLotId, @purchaseLotId, @quantityAllocated)
          `);
      }

      // Sells consume lots smallest-first, recording the actual allocation for auditability.
      if (type === 'sell') {
        for (const allocation of purchaseAttributionPlan) {
          await new sql.Request(tx)
            .input('lotId', sql.UniqueIdentifier, allocation.lotId)
            .input('userId', sql.NVarChar, userId)
            .input('quantity', sql.Decimal(18, 8), allocation.quantity)
            .query(`
              UPDATE PurchaseLots
              SET remainingQuantity = remainingQuantity - @quantity, updatedAt = GETUTCDATE()
              WHERE id = @lotId AND userId = @userId
            `);

          const purchaseAllocationId = uuidv4();
          await new sql.Request(tx)
            .input('allocationId', sql.UniqueIdentifier, purchaseAllocationId)
            .input('userId', sql.NVarChar, userId)
            .input('saleTransactionId', sql.UniqueIdentifier, id)
            .input('purchaseLotId', sql.UniqueIdentifier, allocation.lotId)
            .input('quantity', sql.Decimal(18, 8), allocation.quantity)
            .query(`
              INSERT INTO PurchaseLotAllocations (id, userId, saleTransactionId, purchaseLotId, quantityConsumed)
              VALUES (@allocationId, @userId, @saleTransactionId, @purchaseLotId, @quantity)
            `);
        }

        // Also consume display lots smallest-first to keep display state in sync
        const displayLotsResult = await new sql.Request(tx)
          .input('userId', sql.NVarChar, userId)
          .input('ticker', sql.NVarChar, normalizedTicker)
          .query(`
            SELECT id, totalQuantity FROM DisplayLots
            WHERE userId = @userId AND ticker = @ticker AND totalQuantity > 0
            ORDER BY totalQuantity ASC, createdAt ASC
          `);

        let displayRemaining = Number(quantity);
        for (const row of displayLotsResult.recordset as any[]) {
          if (displayRemaining <= ALLOCATION_TOLERANCE) break;
          const dlId = String(row.id);
          const dlQty = Number(row.totalQuantity);
          const consume = Math.min(dlQty, displayRemaining);
          displayRemaining -= consume;

          await new sql.Request(tx)
            .input('allocationId', sql.UniqueIdentifier, uuidv4())
            .input('userId', sql.NVarChar, userId)
            .input('saleTransactionId', sql.UniqueIdentifier, id)
            .input('displayLotId', sql.UniqueIdentifier, dlId)
            .input('quantity', sql.Decimal(18, 8), consume)
            .query(`
              INSERT INTO DisplayLotAllocations (id, userId, saleTransactionId, displayLotId, quantityConsumed)
              VALUES (@allocationId, @userId, @saleTransactionId, @displayLotId, @quantity)
            `);

          // Update DisplayLot quantity (don't delete to preserve foreign key references to DisplayLotAllocations)
          await new sql.Request(tx)
            .input('displayLotId', sql.UniqueIdentifier, dlId)
            .input('userId', sql.NVarChar, userId)
            .input('quantity', sql.Decimal(18, 8), consume)
            .query(`
              UPDATE DisplayLots
              SET totalQuantity = totalQuantity - @quantity, updatedAt = GETUTCDATE()
              WHERE id = @displayLotId AND userId = @userId
            `);
        }
      }

      await tx.commit();
      res.status(201).json({ id, ticker: normalizedTicker, type, quantity, price, amount, transactionDate });
    } catch (innerError) {
      await tx.rollback();
      throw innerError;
    }
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

    const pool = getPool();
    const transactionLookup = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.NVarChar, userId)
      .query('SELECT TOP 1 id, type FROM StockTransactions WHERE id = @id AND userId = @userId');

    if (transactionLookup.recordset.length === 0) {
      return res.status(404).json({ error: 'Stock transaction not found' });
    }

    const transactionType = String(transactionLookup.recordset[0].type || '').toLowerCase();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      if (transactionType === 'sell') {
        // All allocations handled via PurchaseLotAllocations below

        const purchaseAllocations = await new sql.Request(tx)
          .input('saleTransactionId', sql.UniqueIdentifier, id)
          .input('userId', sql.NVarChar, userId)
          .query(`
            SELECT purchaseLotId, quantityConsumed
            FROM PurchaseLotAllocations
            WHERE saleTransactionId = @saleTransactionId AND userId = @userId
          `);

        for (const allocation of purchaseAllocations.recordset) {
          await new sql.Request(tx)
            .input('purchaseLotId', sql.UniqueIdentifier, allocation.purchaseLotId)
            .input('userId', sql.NVarChar, userId)
            .input('quantity', sql.Decimal(18, 8), allocation.quantityConsumed)
            .query(`
              UPDATE PurchaseLots
              SET remainingQuantity = remainingQuantity + @quantity, updatedAt = GETUTCDATE()
              WHERE id = @purchaseLotId AND userId = @userId
            `);
        }

        // Restore DisplayLots quantities (reversible display lot allocations)
        const displayAllocations = await new sql.Request(tx)
          .input('saleTransactionId', sql.UniqueIdentifier, id)
          .input('userId', sql.NVarChar, userId)
          .query(`
            SELECT displayLotId, quantityConsumed
            FROM DisplayLotAllocations
            WHERE saleTransactionId = @saleTransactionId AND userId = @userId
          `);

        for (const allocation of displayAllocations.recordset) {
          await new sql.Request(tx)
            .input('displayLotId', sql.UniqueIdentifier, allocation.displayLotId)
            .input('userId', sql.NVarChar, userId)
            .input('quantity', sql.Decimal(18, 8), allocation.quantityConsumed)
            .query(`
              UPDATE DisplayLots
              SET totalQuantity = totalQuantity + @quantity, updatedAt = GETUTCDATE()
              WHERE id = @displayLotId AND userId = @userId
            `);
        }
      } else if (transactionType === 'buy' || transactionType === 'div') {
        // For buy/div, delete the associated DisplayLotComposition, DisplayLots, and PurchaseLot
        
        const purchaseLotsResult = await new sql.Request(tx)
          .input('transactionId', sql.UniqueIdentifier, id)
          .input('userId', sql.NVarChar, userId)
          .query(`
            SELECT id FROM PurchaseLots
            WHERE transactionId = @transactionId AND userId = @userId
          `);

        for (const row of purchaseLotsResult.recordset) {
          const purchaseLotId = row.id;
          
          // Find and delete all DisplayLotComposition records that reference this PurchaseLot
          const compositionsResult = await new sql.Request(tx)
            .input('purchaseLotId', sql.UniqueIdentifier, purchaseLotId)
            .query(`
              SELECT displayLotId FROM DisplayLotComposition
              WHERE purchaseLotId = @purchaseLotId
            `);

          for (const comp of compositionsResult.recordset) {
            const displayLotId = comp.displayLotId;
            
            // Delete the composition record
            await new sql.Request(tx)
              .input('purchaseLotId', sql.UniqueIdentifier, purchaseLotId)
              .query(`
                DELETE FROM DisplayLotComposition
                WHERE purchaseLotId = @purchaseLotId
              `);

            // Delete the DisplayLot
            await new sql.Request(tx)
              .input('displayLotId', sql.UniqueIdentifier, displayLotId)
              .input('userId', sql.NVarChar, userId)
              .query(`
                DELETE FROM DisplayLots
                WHERE id = @displayLotId AND userId = @userId
              `);
          }

          // Delete the PurchaseLot
          await new sql.Request(tx)
            .input('purchaseLotId', sql.UniqueIdentifier, purchaseLotId)
            .input('userId', sql.NVarChar, userId)
            .query(`
              DELETE FROM PurchaseLots
              WHERE id = @purchaseLotId AND userId = @userId
            `);
        }
      }

      await new sql.Request(tx)
        .input('id', sql.UniqueIdentifier, id)
        .input('userId', sql.NVarChar, userId)
        .query('DELETE FROM StockTransactions WHERE id = @id AND userId = @userId');

      await tx.commit();
    } catch (innerError) {
      await tx.rollback();
      throw innerError;
    }
    
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
