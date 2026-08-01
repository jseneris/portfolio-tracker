import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/connection.js';
import sql from 'mssql';

const router = Router();
const QUANTITY_TOLERANCE = 1e-6;

type DisplayLotsRow = {
  id: string;
  userId: string;
  ticker: string;
  lotsCsv: string;
  createdAt: string;
  updatedAt: string;
};

function parseLotsCsv(lotsCsv: string): number[] {
  if (!lotsCsv || !lotsCsv.trim()) {
    return [];
  }

  return lotsCsv
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > QUANTITY_TOLERANCE);
}

function serializeLotsCsv(lots: number[]): string {
  return lots.map((value) => Number(value.toFixed(8))).join(',');
}

function validateQuantities(values: unknown): number[] | null {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const quantities = values.map((value) => Number(value));
  if (quantities.some((value) => !Number.isFinite(value) || value <= QUANTITY_TOLERANCE)) {
    return null;
  }

  return quantities;
}

async function getDisplayLotsRowById(userId: string, id: string): Promise<DisplayLotsRow | null> {
  const result = await getPool().request()
    .input('id', sql.UniqueIdentifier, id)
    .input('userId', sql.NVarChar, userId)
    .query(`
      SELECT id, userId, ticker, lotsCsv, createdAt, updatedAt
      FROM DisplayLots
      WHERE id = @id AND userId = @userId
    `);

  if (result.recordset.length === 0) {
    return null;
  }

  return result.recordset[0] as DisplayLotsRow;
}

function mapDisplayLotsRow(row: DisplayLotsRow) {
  const lots = parseLotsCsv(row.lotsCsv);
  const totalQuantity = lots.reduce((sum, value) => sum + value, 0);

  return {
    id: row.id,
    userId: row.userId,
    ticker: row.ticker,
    lots,
    lotCount: lots.length,
    totalQuantity: Number(totalQuantity.toFixed(8)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// GET all display lots for user
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT id, userId, ticker, lotsCsv, createdAt, updatedAt
        FROM DisplayLots
        WHERE userId = @userId
        ORDER BY ticker ASC, createdAt ASC
      `);

    res.json((result.recordset as DisplayLotsRow[]).map(mapDisplayLotsRow));
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
        SELECT id, userId, ticker, lotsCsv, createdAt, updatedAt
        FROM DisplayLots
        WHERE userId = @userId AND ticker = @ticker
      `);

    res.json((result.recordset as DisplayLotsRow[]).map(mapDisplayLotsRow));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET synthetic composition for a display lot row
router.get('/:id/composition', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id!;

    const row = await getDisplayLotsRowById(userId, id);
    if (!row) {
      return res.status(404).json({ error: 'Display lot not found' });
    }

    const lots = parseLotsCsv(row.lotsCsv);
    const composition = lots.map((quantityAllocated, index) => ({
      id: `${row.id}:${index}`,
      index,
      quantityAllocated: Number(quantityAllocated.toFixed(8)),
      ticker: row.ticker,
    }));

    res.json(composition);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// CREATE/REPLACE display lots for ticker with minimal payload
router.post('/:ticker', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const { quantities } = req.body as { quantities: unknown };
    const userId = req.user?.id!;

    const parsedQuantities = validateQuantities(quantities);
    if (!parsedQuantities) {
      return res.status(400).json({ error: 'Payload must include quantities: number[] with values > 0' });
    }

    const normalizedTicker = ticker.toUpperCase();
    const lotsCsv = serializeLotsCsv(parsedQuantities);

    const existing = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .query(`
        SELECT id FROM DisplayLots WHERE userId = @userId AND ticker = @ticker
      `);

    let id: string;
    if (existing.recordset.length > 0) {
      id = String(existing.recordset[0].id);
      await getPool().request()
        .input('id', sql.UniqueIdentifier, id)
        .input('userId', sql.NVarChar, userId)
        .input('lotsCsv', sql.NVarChar(sql.MAX), lotsCsv)
        .query(`
          UPDATE DisplayLots
          SET lotsCsv = @lotsCsv, updatedAt = GETUTCDATE()
          WHERE id = @id AND userId = @userId
        `);
    } else {
      id = uuidv4();
      await getPool().request()
        .input('id', sql.UniqueIdentifier, id)
        .input('userId', sql.NVarChar, userId)
        .input('ticker', sql.NVarChar, normalizedTicker)
        .input('lotsCsv', sql.NVarChar(sql.MAX), lotsCsv)
        .query(`
          INSERT INTO DisplayLots (id, userId, ticker, lotsCsv)
          VALUES (@id, @userId, @ticker, @lotsCsv)
        `);
    }

    const totalQuantity = parsedQuantities.reduce((sum, value) => sum + value, 0);
    res.status(201).json({
      id,
      ticker: normalizedTicker,
      lotCount: parsedQuantities.length,
      totalQuantity: Number(totalQuantity.toFixed(8)),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// COMBINE selected lot indices into one
router.post('/:id/combine', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { indices } = req.body as { indices: unknown };
    const userId = req.user?.id!;

    if (!Array.isArray(indices) || indices.length < 2) {
      return res.status(400).json({ error: 'Combine requires indices: number[] with at least two indices' });
    }

    const normalizedIndices = Array.from(new Set(indices.map((v) => Number(v)))).sort((a, b) => a - b);
    if (normalizedIndices.some((v) => !Number.isInteger(v) || v < 0)) {
      return res.status(400).json({ error: 'indices must be non-negative integers' });
    }

    const row = await getDisplayLotsRowById(userId, id);
    if (!row) {
      return res.status(404).json({ error: 'Display lot not found' });
    }

    const lots = parseLotsCsv(row.lotsCsv);
    if (normalizedIndices.some((index) => index >= lots.length)) {
      return res.status(400).json({ error: 'One or more indices are out of range' });
    }

    const keepIndex = normalizedIndices[0];
    const combineSet = new Set(normalizedIndices);
    let combinedValue = 0;
    const nextLots: number[] = [];

    for (let i = 0; i < lots.length; i++) {
      if (combineSet.has(i)) {
        combinedValue += lots[i];
        if (i === keepIndex) {
          nextLots.push(0);
        }
      } else {
        nextLots.push(lots[i]);
      }
    }

    const keepPos = nextLots.findIndex((_, idx) => idx === keepIndex);
    if (keepPos >= 0) {
      nextLots[keepPos] = Number(combinedValue.toFixed(8));
    }

    const compactLots = nextLots.filter((value) => value > QUANTITY_TOLERANCE);

    await getPool().request()
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.NVarChar, userId)
      .input('lotsCsv', sql.NVarChar(sql.MAX), serializeLotsCsv(compactLots))
      .query(`
        UPDATE DisplayLots
        SET lotsCsv = @lotsCsv, updatedAt = GETUTCDATE()
        WHERE id = @id AND userId = @userId
      `);

    res.status(201).json({
      id,
      ticker: row.ticker,
      lotCount: compactLots.length,
      totalQuantity: Number(compactLots.reduce((sum, value) => sum + value, 0).toFixed(8)),
      combinedIndices: normalizedIndices,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// SPLIT one lot entry into many
router.post('/:id/split', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { index, quantities } = req.body as { index: unknown; quantities: unknown };
    const userId = req.user?.id!;

    const splitIndex = Number(index);
    if (!Number.isInteger(splitIndex) || splitIndex < 0) {
      return res.status(400).json({ error: 'index must be a non-negative integer' });
    }

    const splitQuantities = validateQuantities(quantities);
    if (!splitQuantities || splitQuantities.length < 2) {
      return res.status(400).json({ error: 'Split requires quantities: number[] with at least two values > 0' });
    }

    const row = await getDisplayLotsRowById(userId, id);
    if (!row) {
      return res.status(404).json({ error: 'Display lot not found' });
    }

    const lots = parseLotsCsv(row.lotsCsv);
    if (splitIndex >= lots.length) {
      return res.status(400).json({ error: 'index is out of range' });
    }

    const original = lots[splitIndex];
    const splitTotal = splitQuantities.reduce((sum, value) => sum + value, 0);
    if (Math.abs(splitTotal - original) > QUANTITY_TOLERANCE) {
      return res.status(400).json({
        error: `Split total (${splitTotal}) must equal original lot quantity (${original})`,
      });
    }

    const nextLots = [
      ...lots.slice(0, splitIndex),
      ...splitQuantities.map((value) => Number(value.toFixed(8))),
      ...lots.slice(splitIndex + 1),
    ];

    await getPool().request()
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.NVarChar, userId)
      .input('lotsCsv', sql.NVarChar(sql.MAX), serializeLotsCsv(nextLots))
      .query(`
        UPDATE DisplayLots
        SET lotsCsv = @lotsCsv, updatedAt = GETUTCDATE()
        WHERE id = @id AND userId = @userId
      `);

    res.status(201).json({
      id,
      ticker: row.ticker,
      lotCount: nextLots.length,
      totalQuantity: Number(nextLots.reduce((sum, value) => sum + value, 0).toFixed(8)),
      splitIndex,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// DELETE a single lot entry by index
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id!;
    const index = Number(req.body?.index);

    if (!Number.isInteger(index) || index < 0) {
      return res.status(400).json({ error: 'Delete requires body.index as a non-negative integer' });
    }

    const row = await getDisplayLotsRowById(userId, id);
    if (!row) {
      return res.status(404).json({ error: 'Display lot not found' });
    }

    const lots = parseLotsCsv(row.lotsCsv);
    if (index >= lots.length) {
      return res.status(400).json({ error: 'index is out of range' });
    }

    const nextLots = lots.filter((_, i) => i !== index);
    if (nextLots.length === 0) {
      await getPool().request()
        .input('id', sql.UniqueIdentifier, id)
        .input('userId', sql.NVarChar, userId)
        .query(`DELETE FROM DisplayLots WHERE id = @id AND userId = @userId`);
    } else {
      await getPool().request()
        .input('id', sql.UniqueIdentifier, id)
        .input('userId', sql.NVarChar, userId)
        .input('lotsCsv', sql.NVarChar(sql.MAX), serializeLotsCsv(nextLots))
        .query(`
          UPDATE DisplayLots
          SET lotsCsv = @lotsCsv, updatedAt = GETUTCDATE()
          WHERE id = @id AND userId = @userId
        `);
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
