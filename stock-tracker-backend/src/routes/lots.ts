import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/connection.js';
import sql from 'mssql';

const router = Router();
const SPLIT_TOLERANCE = 1e-6;

interface CombineLotsRequestBody {
  lotIds?: string[];
}

// GET all purchase-lot attribution rows for user
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const request = getPool().request();
    
    const result = await request
      .input('userId', sql.NVarChar, userId)
      .query('SELECT * FROM PurchaseLots WHERE userId = @userId ORDER BY purchaseDate ASC');
    
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

// COMBINE multiple open lots into a single open lot for the same ticker.
// Preserves cost basis by using weighted average unit cost of remaining shares.
router.post('/combine', async (req: Request, res: Response) => {
  const pool = getPool();
  const transaction = new sql.Transaction(pool);
  let began = false;
  try {
    const { lotIds } = req.body as CombineLotsRequestBody;
    const userId = req.user?.id!;

    if (!Array.isArray(lotIds) || lotIds.length < 2) {
      return res.status(400).json({ error: 'Lot combine requires at least two lot IDs' });
    }

    const normalizedLotIds = lotIds
      .map((id) => String(id || '').trim())
      .filter((id) => id.length > 0);
    const uniqueLotIds = Array.from(new Set(normalizedLotIds));
    if (uniqueLotIds.length < 2) {
      return res.status(400).json({ error: 'Lot combine requires at least two unique lot IDs' });
    }

    await transaction.begin();
    began = true;

    const selectRequest = new sql.Request(transaction)
      .input('userId', sql.NVarChar, userId);

    const lotIdParameters: string[] = [];
    for (let i = 0; i < uniqueLotIds.length; i += 1) {
      const paramName = `lotId${i}`;
      lotIdParameters.push(`@${paramName}`);
      selectRequest.input(paramName, sql.UniqueIdentifier, uniqueLotIds[i]);
    }

    const lotsResult = await selectRequest.query(`
      SELECT id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate
      FROM Lots
      WHERE userId = @userId AND id IN (${lotIdParameters.join(', ')})
    `);

    const selectedLots = lotsResult.recordset ?? [];
    if (selectedLots.length !== uniqueLotIds.length) {
      await transaction.rollback();
      began = false;
      return res.status(404).json({ error: 'One or more lots were not found for this user' });
    }

    const ticker = String(selectedLots[0].ticker || '').toUpperCase();
    if (selectedLots.some((lot) => String(lot.ticker || '').toUpperCase() !== ticker)) {
      await transaction.rollback();
      began = false;
      return res.status(400).json({ error: 'All lots must belong to the same ticker' });
    }

    const openRemaining = selectedLots.map((lot) => Number(lot.remainingQuantity));
    if (openRemaining.some((remaining) => !Number.isFinite(remaining) || remaining <= SPLIT_TOLERANCE)) {
      await transaction.rollback();
      began = false;
      return res.status(400).json({ error: 'All lots to combine must be open lots with remaining shares' });
    }

    const combinedRemainingQuantity = openRemaining.reduce((sum, value) => sum + value, 0);
    const combinedCostBasis = selectedLots.reduce((sum, lot) => {
      return sum + Number(lot.remainingQuantity) * Number(lot.unitCost);
    }, 0);
    const combinedUnitCost = combinedCostBasis / combinedRemainingQuantity;

    const combinedPurchaseDate = selectedLots
      .map((lot) => new Date(lot.purchaseDate))
      .sort((a, b) => a.getTime() - b.getTime())[0];

    const firstLot = selectedLots[0];

    for (const lot of selectedLots) {
      const originalQuantity = Number(lot.originalQuantity);
      const remainingQuantity = Number(lot.remainingQuantity);
      const consumedQuantity = Math.max(0, originalQuantity - remainingQuantity);

      if (consumedQuantity <= SPLIT_TOLERANCE) {
        await new sql.Request(transaction)
          .input('id', sql.UniqueIdentifier, lot.id)
          .input('userId', sql.NVarChar, userId)
          .query(`
            DELETE FROM Lots
            WHERE id = @id AND userId = @userId
          `);
      } else {
        await new sql.Request(transaction)
          .input('id', sql.UniqueIdentifier, lot.id)
          .input('userId', sql.NVarChar, userId)
          .input('consumedQuantity', sql.Decimal(18, 8), consumedQuantity)
          .query(`
            UPDATE Lots
            SET originalQuantity = @consumedQuantity,
                remainingQuantity = 0,
                updatedAt = GETUTCDATE()
            WHERE id = @id AND userId = @userId
          `);
      }
    }

    const combinedLotId = uuidv4();
    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, combinedLotId)
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker)
      .input('transactionId', sql.UniqueIdentifier, firstLot.transactionId)
      .input('sourceType', sql.NVarChar, firstLot.sourceType)
      .input('quantity', sql.Decimal(18, 8), combinedRemainingQuantity)
      .input('unitCost', sql.Decimal(18, 8), combinedUnitCost)
      .input('purchaseDate', sql.DateTime2, combinedPurchaseDate)
      .query(`
        INSERT INTO Lots (id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate)
        VALUES (@id, @userId, @ticker, @transactionId, @sourceType, @quantity, @quantity, @unitCost, @purchaseDate)
      `);

    await transaction.commit();
    began = false;

    res.status(201).json({
      lotIds: uniqueLotIds,
      combinedLotId,
      ticker,
      combinedQuantity: combinedRemainingQuantity,
      combinedUnitCost,
    });
  } catch (error) {
    if (began) {
      try {
        await transaction.rollback();
      } catch {
        // ignore rollback failures after original error
      }
    }
    res.status(500).json({ error: String(error) });
  }
});

// SPLIT lot into multiple child lots that sum to current remainingQuantity.
// Explicit '/lot/:id/split' path avoids collisions with ticker split routes.
router.post('/lot/:id/split', async (req: Request, res: Response) => {
  const pool = getPool();
  const transaction = new sql.Transaction(pool);
  let began = false;
  try {
    const { id } = req.params;
    const { quantities } = req.body as { quantities?: number[] };
    const userId = req.user?.id!;

    if (!Array.isArray(quantities) || quantities.length < 2) {
      return res.status(400).json({ error: 'Lot split requires at least two quantities' });
    }

    const parsedQuantities = quantities.map((value) => Number(value));
    if (parsedQuantities.some((value) => !Number.isFinite(value) || value <= 0)) {
      return res.status(400).json({ error: 'All split quantities must be numeric and greater than 0' });
    }

    await transaction.begin();
    began = true;

    const lotResult = await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT TOP 1 id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate
        FROM Lots
        WHERE id = @id AND userId = @userId
      `);

    if (lotResult.recordset.length === 0) {
      await transaction.rollback();
      began = false;
      return res.status(404).json({ error: 'Lot not found' });
    }

    const lot = lotResult.recordset[0];
    const remainingQuantity = Number(lot.remainingQuantity);
    const originalQuantity = Number(lot.originalQuantity);
    if (!Number.isFinite(remainingQuantity) || remainingQuantity <= SPLIT_TOLERANCE) {
      await transaction.rollback();
      began = false;
      return res.status(400).json({ error: 'Only open lots can be split' });
    }

    const requestedTotal = parsedQuantities.reduce((sum, value) => sum + value, 0);
    if (Math.abs(requestedTotal - remainingQuantity) > SPLIT_TOLERANCE) {
      await transaction.rollback();
      began = false;
      return res.status(400).json({
        error: `Split quantities total (${requestedTotal}) must equal lot remaining quantity (${remainingQuantity})`
      });
    }

    const consumedQuantity = Math.max(0, originalQuantity - remainingQuantity);

    if (consumedQuantity <= SPLIT_TOLERANCE) {
      await new sql.Request(transaction)
        .input('id', sql.UniqueIdentifier, id)
        .input('userId', sql.NVarChar, userId)
        .query(`
          DELETE FROM Lots
          WHERE id = @id AND userId = @userId
        `);
    } else {
      await new sql.Request(transaction)
        .input('id', sql.UniqueIdentifier, id)
        .input('userId', sql.NVarChar, userId)
        .input('consumedQuantity', sql.Decimal(18, 8), consumedQuantity)
        .query(`
          UPDATE Lots
          SET originalQuantity = @consumedQuantity,
              remainingQuantity = 0,
              updatedAt = GETUTCDATE()
          WHERE id = @id AND userId = @userId
        `);
    }

    const createdLots: Array<{ id: string; quantity: number }> = [];
    for (const quantity of parsedQuantities) {
      const newLotId = uuidv4();
      await new sql.Request(transaction)
        .input('id', sql.UniqueIdentifier, newLotId)
        .input('userId', sql.NVarChar, userId)
        .input('ticker', sql.NVarChar, lot.ticker)
        .input('transactionId', sql.UniqueIdentifier, lot.transactionId)
        .input('sourceType', sql.NVarChar, lot.sourceType)
        .input('quantity', sql.Decimal(18, 8), quantity)
        .input('unitCost', sql.Decimal(18, 8), lot.unitCost)
        .input('purchaseDate', sql.DateTime2, lot.purchaseDate)
        .query(`
          INSERT INTO Lots (id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate)
          VALUES (@id, @userId, @ticker, @transactionId, @sourceType, @quantity, @quantity, @unitCost, @purchaseDate)
        `);
      createdLots.push({ id: newLotId, quantity });
    }

    await transaction.commit();
    began = false;

    res.status(201).json({
      parentLotId: id,
      ticker: lot.ticker,
      quantities: parsedQuantities,
      createdLots,
    });
  } catch (error) {
    if (began) {
      try {
        await transaction.rollback();
      } catch {
        // ignore rollback failures after original error
      }
    }
    res.status(500).json({ error: String(error) });
  }
});

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
      .input('userId', sql.NVarChar, actorUserId)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('ratioNumerator', sql.Decimal(18, 8), ratioNumerator)
      .input('ratioDenominator', sql.Decimal(18, 8), ratioDenominator)
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, parsedSplitDate)
      .query(`
         INSERT INTO StockSplits (id, userId, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate)
         VALUES (@id, @userId, @ticker, @ratioNumerator, @ratioDenominator, @multiplier, @splitDate)
         `);

    const lotTargets = await new sql.Request(transaction)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('splitDate', sql.DateTime2, parsedSplitDate)
      .query(`
        SELECT id, userId
        FROM Lots
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

    // Update all lots for this ticker with purchaseDate <= splitDate.
    // Quantities multiply and unitCost divides by the same factor so cost basis (qty * unitCost) is unchanged.
    // Every affected lot is also logged into SplitAdjustments to preserve full multi-split history.
    await new sql.Request(transaction)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, parsedSplitDate)
      .input('splitId', sql.UniqueIdentifier, splitId)
      .query(`
        UPDATE Lots
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
        SELECT la.id, la.userId
        FROM LotAllocations la
        JOIN StockTransactions st ON la.saleTransactionId = st.id
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

    // Rescale historical LotAllocations rows for sales that happened on or before the split date.
    // Those rows recorded "shares consumed" in pre-split terms; without rescaling them they'd
    // permanently drift out of sync with the now-split-adjusted Lots.remainingQuantity.
    await new sql.Request(transaction)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, parsedSplitDate)
      .input('splitId', sql.UniqueIdentifier, splitId)
      .query(`
        UPDATE la
        SET la.quantityConsumed = la.quantityConsumed * @multiplier,
            la.updatedAt = GETUTCDATE()
        FROM LotAllocations la
        JOIN StockTransactions st ON la.saleTransactionId = st.id
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

    await transaction.commit();
    began = false;

    res.json({
      splitId,
      message: 'Stock split applied',
      ticker: normalizedTicker,
      ratioNumerator: Number(ratioNumerator),
      ratioDenominator: Number(ratioDenominator),
      multiplier
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
