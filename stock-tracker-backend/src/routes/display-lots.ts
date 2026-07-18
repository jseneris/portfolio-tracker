import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/connection.js';
import sql from 'mssql';

const router = Router();
const QUANTITY_TOLERANCE = 1e-6;

interface DisplayLotCompositionItem {
  purchaseLotId: string;
  quantityAllocated: number;
}

// GET all display lots for user
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT id, userId, ticker, totalQuantity, createdAt, updatedAt
        FROM DisplayLots
        WHERE userId = @userId
        ORDER BY ticker ASC, totalQuantity ASC
      `);
    
    res.json(result.recordset.map((row: any) => ({
      id: row.id,
      userId: row.userId,
      ticker: row.ticker,
      totalQuantity: Number(row.totalQuantity || 0),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    })));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET display lots for specific ticker
router.get('/ticker/:ticker', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const userId = req.user?.id!;
    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .query(`
        SELECT id, userId, ticker, totalQuantity, createdAt, updatedAt
        FROM DisplayLots
        WHERE userId = @userId AND ticker = @ticker
        ORDER BY totalQuantity ASC, createdAt ASC
      `);
    
    res.json(result.recordset.map((row: any) => ({
      id: row.id,
      userId: row.userId,
      ticker: row.ticker,
      totalQuantity: Number(row.totalQuantity || 0),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    })));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET composition of a display lot (which purchase lots it contains)
router.get('/:id/composition', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id!;
    const pool = getPool();

    // Verify ownership
    const displayLot = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.NVarChar, userId)
      .query(`SELECT id FROM DisplayLots WHERE id = @id AND userId = @userId`);

    if (displayLot.recordset.length === 0) {
      return res.status(404).json({ error: 'Display lot not found' });
    }

    const composition = await pool.request()
      .input('displayLotId', sql.UniqueIdentifier, id)
      .query(`
        SELECT 
          dlc.id,
          dlc.purchaseLotId,
          dlc.quantityAllocated,
          pl.ticker,
          pl.unitCost,
          pl.sourceType,
          pl.purchaseDate
        FROM DisplayLotComposition dlc
        INNER JOIN PurchaseLots pl ON pl.id = dlc.purchaseLotId
        WHERE dlc.displayLotId = @displayLotId
        ORDER BY pl.purchaseDate ASC
      `);

    res.json(composition.recordset.map((row: any) => ({
      id: row.id,
      purchaseLotId: row.purchaseLotId,
      quantityAllocated: Number(row.quantityAllocated),
      ticker: row.ticker,
      unitCost: Number(row.unitCost),
      sourceType: row.sourceType,
      purchaseDate: row.purchaseDate
    })));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// CREATE a new display lot from purchase lots
router.post('/:ticker', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const { composition } = req.body as { composition: DisplayLotCompositionItem[] };
    const userId = req.user?.id!;
    const pool = getPool();
    const tx = new sql.Transaction(pool);

    if (!Array.isArray(composition) || composition.length === 0) {
      return res.status(400).json({ error: 'Composition must contain at least one purchase lot' });
    }

    const normalizedTicker = ticker.toUpperCase();
    let totalQuantity = 0;

    // Validate all purchase lots exist and sum quantities
    for (const comp of composition) {
      const qty = Number(comp.quantityAllocated);
      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ error: `Invalid quantity for purchase lot ${comp.purchaseLotId}` });
      }
      totalQuantity += qty;
    }

    await tx.begin();

    try {
      // Verify all purchase lots exist and belong to user
      for (const comp of composition) {
        const purchaseLot = await new sql.Request(tx)
          .input('id', sql.UniqueIdentifier, comp.purchaseLotId)
          .input('userId', sql.NVarChar, userId)
          .input('ticker', sql.NVarChar, normalizedTicker)
          .query(`
            SELECT id, ticker FROM PurchaseLots 
            WHERE id = @id AND userId = @userId AND ticker = @ticker
          `);

        if (purchaseLot.recordset.length === 0) {
          await tx.rollback();
          return res.status(400).json({ error: `Purchase lot ${comp.purchaseLotId} not found for ${normalizedTicker}` });
        }
      }

      // Create display lot
      const displayLotId = uuidv4();
      await new sql.Request(tx)
        .input('id', sql.UniqueIdentifier, displayLotId)
        .input('userId', sql.NVarChar, userId)
        .input('ticker', sql.NVarChar, normalizedTicker)
        .input('totalQuantity', sql.Decimal(18, 8), totalQuantity)
        .query(`
          INSERT INTO DisplayLots (id, userId, ticker, totalQuantity)
          VALUES (@id, @userId, @ticker, @totalQuantity)
        `);

      // Create composition entries
      for (const comp of composition) {
        await new sql.Request(tx)
          .input('id', sql.UniqueIdentifier, uuidv4())
          .input('displayLotId', sql.UniqueIdentifier, displayLotId)
          .input('purchaseLotId', sql.UniqueIdentifier, comp.purchaseLotId)
          .input('quantityAllocated', sql.Decimal(18, 8), comp.quantityAllocated)
          .query(`
            INSERT INTO DisplayLotComposition (id, displayLotId, purchaseLotId, quantityAllocated)
            VALUES (@id, @displayLotId, @purchaseLotId, @quantityAllocated)
          `);
      }

      await tx.commit();
      res.status(201).json({
        id: displayLotId,
        ticker: normalizedTicker,
        totalQuantity,
        compositionCount: composition.length
      });
    } catch (innerError) {
      await tx.rollback();
      throw innerError;
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// COMBINE multiple display lots into one
router.post('/:id/combine', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { displayLotIds } = req.body as { displayLotIds: string[] };
    const userId = req.user?.id!;
    const pool = getPool();
    const tx = new sql.Transaction(pool);

    if (!Array.isArray(displayLotIds) || displayLotIds.length === 0) {
      return res.status(400).json({ error: 'Combine requires at least one other display lot ID' });
    }

    // Include the source display lot in the list to combine
    const allLotsToMerge = [id, ...displayLotIds];

    await tx.begin();

    try {
      // Verify all display lots exist and belong to user
      const placeholders = allLotsToMerge.map((_, i) => `@id${i}`).join(',');
      let request = new sql.Request(tx).input('userId', sql.NVarChar, userId);
      allLotsToMerge.forEach((lotId, i) => {
        request = request.input(`id${i}`, sql.UniqueIdentifier, lotId);
      });
      const verifyResult = await request.query(`
        SELECT id, ticker, totalQuantity FROM DisplayLots
        WHERE userId = @userId AND id IN (${placeholders})
      `);

      if (verifyResult.recordset.length !== allLotsToMerge.length) {
        await tx.rollback();
        return res.status(400).json({ error: 'One or more display lots not found' });
      }

      // All lots should be same ticker
      const tickers = new Set(verifyResult.recordset.map((r: any) => r.ticker));
      if (tickers.size > 1) {
        await tx.rollback();
        return res.status(400).json({ error: 'Cannot combine display lots for different tickers' });
      }

      const ticker = Array.from(tickers)[0];
      const totalQty = verifyResult.recordset.reduce((sum: number, r: any) => sum + Number(r.totalQuantity), 0);

      // Create new combined display lot
      const newDisplayLotId = uuidv4();
      await new sql.Request(tx)
        .input('id', sql.UniqueIdentifier, newDisplayLotId)
        .input('userId', sql.NVarChar, userId)
        .input('ticker', sql.NVarChar, ticker)
        .input('totalQuantity', sql.Decimal(18, 8), totalQty)
        .query(`
          INSERT INTO DisplayLots (id, userId, ticker, totalQuantity)
          VALUES (@id, @userId, @ticker, @totalQuantity)
        `);

      // Copy composition entries from all source lots
      for (const sourceId of allLotsToMerge) {
        const compositions = await new sql.Request(tx)
          .input('displayLotId', sql.UniqueIdentifier, sourceId)
          .query(`
            SELECT purchaseLotId, quantityAllocated FROM DisplayLotComposition
            WHERE displayLotId = @displayLotId
          `);

        for (const comp of compositions.recordset) {
          await new sql.Request(tx)
            .input('id', sql.UniqueIdentifier, uuidv4())
            .input('displayLotId', sql.UniqueIdentifier, newDisplayLotId)
            .input('purchaseLotId', sql.UniqueIdentifier, comp.purchaseLotId)
            .input('quantityAllocated', sql.Decimal(18, 8), comp.quantityAllocated)
            .query(`
              INSERT INTO DisplayLotComposition (id, displayLotId, purchaseLotId, quantityAllocated)
              VALUES (@id, @displayLotId, @purchaseLotId, @quantityAllocated)
            `);
        }
      }

      // Delete old display lots (CASCADE will remove compositions)
      for (const sourceId of allLotsToMerge) {
        await new sql.Request(tx)
          .input('id', sql.UniqueIdentifier, sourceId)
          .query(`DELETE FROM DisplayLots WHERE id = @id`);
      }

      await tx.commit();
      res.status(201).json({
        id: newDisplayLotId,
        ticker,
        totalQuantity: totalQty,
        mergedFromCount: allLotsToMerge.length
      });
    } catch (innerError) {
      await tx.rollback();
      throw innerError;
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// SPLIT a display lot into multiple new lots
router.post('/:id/split', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { splits } = req.body as { splits: Array<{ quantityAllocated: number }> };
    const userId = req.user?.id!;
    const pool = getPool();
    const tx = new sql.Transaction(pool);

    if (!Array.isArray(splits) || splits.length < 2) {
      return res.status(400).json({ error: 'Split requires at least two target quantities' });
    }

    await tx.begin();

    try {
      // Get source display lot
      const sourceDisplayLot = await new sql.Request(tx)
        .input('id', sql.UniqueIdentifier, id)
        .input('userId', sql.NVarChar, userId)
        .query(`SELECT id, ticker, totalQuantity FROM DisplayLots WHERE id = @id AND userId = @userId`);

      if (sourceDisplayLot.recordset.length === 0) {
        await tx.rollback();
        return res.status(404).json({ error: 'Display lot not found' });
      }

      const sourceLot = sourceDisplayLot.recordset[0];
      const totalToSplit = Number(sourceLot.totalQuantity);

      // Verify split quantities sum to total
      let splitTotal = 0;
      for (const split of splits) {
        const qty = Number(split.quantityAllocated);
        if (!Number.isFinite(qty) || qty <= 0) {
          await tx.rollback();
          return res.status(400).json({ error: 'All split quantities must be positive' });
        }
        splitTotal += qty;
      }

      if (Math.abs(splitTotal - totalToSplit) > QUANTITY_TOLERANCE) {
        await tx.rollback();
        return res.status(400).json({
          error: `Split quantities (${splitTotal}) do not match display lot total (${totalToSplit})`
        });
      }

      // Get composition of source lot
      const compositions = await new sql.Request(tx)
        .input('displayLotId', sql.UniqueIdentifier, id)
        .query(`
          SELECT purchaseLotId, quantityAllocated FROM DisplayLotComposition
          WHERE displayLotId = @displayLotId
          ORDER BY purchaseLotId
        `);

      const sourceCompositions = compositions.recordset;

      // Create new display lots and distribute compositions proportionally
      const newDisplayLotIds: string[] = [];
      let remainingQtyToAllocate = totalToSplit;

      for (let i = 0; i < splits.length; i++) {
        const newDisplayLotId = uuidv4();
        newDisplayLotIds.push(newDisplayLotId);
        const newLotQty = i === splits.length - 1 
          ? remainingQtyToAllocate 
          : Number(splits[i].quantityAllocated);

        await new sql.Request(tx)
          .input('id', sql.UniqueIdentifier, newDisplayLotId)
          .input('userId', sql.NVarChar, userId)
          .input('ticker', sql.NVarChar, sourceLot.ticker)
          .input('totalQuantity', sql.Decimal(18, 8), newLotQty)
          .query(`
            INSERT INTO DisplayLots (id, userId, ticker, totalQuantity)
            VALUES (@id, @userId, @ticker, @totalQuantity)
          `);

        remainingQtyToAllocate -= newLotQty;

        // Distribute compositions proportionally
        const proportionOfSource = newLotQty / totalToSplit;
        for (const sourceComp of sourceCompositions) {
          const distributedQty = Number(sourceComp.quantityAllocated) * proportionOfSource;
          if (distributedQty > QUANTITY_TOLERANCE) {
            await new sql.Request(tx)
              .input('id', sql.UniqueIdentifier, uuidv4())
              .input('displayLotId', sql.UniqueIdentifier, newDisplayLotId)
              .input('purchaseLotId', sql.UniqueIdentifier, sourceComp.purchaseLotId)
              .input('quantityAllocated', sql.Decimal(18, 8), distributedQty)
              .query(`
                INSERT INTO DisplayLotComposition (id, displayLotId, purchaseLotId, quantityAllocated)
                VALUES (@id, @displayLotId, @purchaseLotId, @quantityAllocated)
              `);
          }
        }
      }

      // Delete source display lot
      await new sql.Request(tx)
        .input('id', sql.UniqueIdentifier, id)
        .query(`DELETE FROM DisplayLots WHERE id = @id`);

      await tx.commit();
      res.status(201).json({
        originalDisplayLotId: id,
        newDisplayLotIds,
        ticker: sourceLot.ticker,
        splitCount: splits.length
      });
    } catch (innerError) {
      await tx.rollback();
      throw innerError;
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// DELETE a display lot (fails if it has active allocations from sales)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id!;
    const pool = getPool();

    // Check if display lot has any active allocations from sales
    const allocations = await pool.request()
      .input('displayLotId', sql.UniqueIdentifier, id)
      .query(`
        SELECT COUNT(*) as count FROM DisplayLotAllocations
        WHERE displayLotId = @displayLotId
      `);

    if (allocations.recordset[0].count > 0) {
      return res.status(400).json({
        error: 'Cannot delete display lot with active sale allocations. Delete the sale transaction first.'
      });
    }

    // Delete the display lot (CASCADE will remove composition)
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.NVarChar, userId)
      .query(`DELETE FROM DisplayLots WHERE id = @id AND userId = @userId`);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Display lot not found' });
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
