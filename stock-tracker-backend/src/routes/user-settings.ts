import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { getPool } from '../db/connection.js';

const router = Router();
const DEFAULT_SALE_TARGET_PERCENT = 10;
const DEFAULT_BUY_TARGET_PERCENT_UNDER_3_DISPLAY_LOTS = 5;
const DEFAULT_BUY_TARGET_PERCENT_FOR_3_DISPLAY_LOTS = 10;
const DEFAULT_BUY_TARGET_PERCENT_FOR_4_DISPLAY_LOTS = 15;
const DEFAULT_BUY_TARGET_PERCENT_FOR_5_DISPLAY_LOTS = 20;
const DEFAULT_BUY_TARGET_PERCENT_FOR_6_OR_MORE_DISPLAY_LOTS = 25;

async function ensureUserSettingsBuyTargetColumns() {
  await getPool().request().batch(`
    IF OBJECT_ID('UserSettings', 'U') IS NULL
    BEGIN
      CREATE TABLE UserSettings (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        userId NVARCHAR(255) NOT NULL,
        saleTargetPercent DECIMAL(9, 4) NOT NULL DEFAULT 10,
        buyTargetPercentUnder3DisplayLots DECIMAL(9, 4) NULL,
        buyTargetPercentFor3DisplayLots DECIMAL(9, 4) NULL,
        buyTargetPercentFor4DisplayLots DECIMAL(9, 4) NULL,
        buyTargetPercentFor5DisplayLots DECIMAL(9, 4) NULL,
        buyTargetPercentFor6OrMoreDisplayLots DECIMAL(9, 4) NULL,
        createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      );
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('UserSettings') AND name = 'buyTargetPercentUnder3DisplayLots')
      ALTER TABLE UserSettings ADD buyTargetPercentUnder3DisplayLots DECIMAL(9, 4) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('UserSettings') AND name = 'buyTargetPercentFor3DisplayLots')
      ALTER TABLE UserSettings ADD buyTargetPercentFor3DisplayLots DECIMAL(9, 4) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('UserSettings') AND name = 'buyTargetPercentFor4DisplayLots')
      ALTER TABLE UserSettings ADD buyTargetPercentFor4DisplayLots DECIMAL(9, 4) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('UserSettings') AND name = 'buyTargetPercentFor5DisplayLots')
      ALTER TABLE UserSettings ADD buyTargetPercentFor5DisplayLots DECIMAL(9, 4) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('UserSettings') AND name = 'buyTargetPercentFor6OrMoreDisplayLots')
      ALTER TABLE UserSettings ADD buyTargetPercentFor6OrMoreDisplayLots DECIMAL(9, 4) NULL;
  `);
}

function normalizeTargetPercent(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

router.get('/targets', async (req: Request, res: Response) => {
  try {
    await ensureUserSettingsBuyTargetColumns();
    const userId = req.user?.id!;

    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT TOP 1
          saleTargetPercent,
          buyTargetPercentUnder3DisplayLots,
          buyTargetPercentFor3DisplayLots,
          buyTargetPercentFor4DisplayLots,
          buyTargetPercentFor5DisplayLots,
          buyTargetPercentFor6OrMoreDisplayLots
        FROM UserSettings
        WHERE userId = @userId
      `);

    const row = result.recordset[0] ?? {};
    res.json({
      saleTargetPercent: normalizeTargetPercent(row.saleTargetPercent, DEFAULT_SALE_TARGET_PERCENT),
      buyTargetPercentUnder3DisplayLots: normalizeTargetPercent(
        row.buyTargetPercentUnder3DisplayLots,
        DEFAULT_BUY_TARGET_PERCENT_UNDER_3_DISPLAY_LOTS
      ),
      buyTargetPercentFor3DisplayLots: normalizeTargetPercent(
        row.buyTargetPercentFor3DisplayLots,
        DEFAULT_BUY_TARGET_PERCENT_FOR_3_DISPLAY_LOTS
      ),
      buyTargetPercentFor4DisplayLots: normalizeTargetPercent(
        row.buyTargetPercentFor4DisplayLots,
        DEFAULT_BUY_TARGET_PERCENT_FOR_4_DISPLAY_LOTS
      ),
      buyTargetPercentFor5DisplayLots: normalizeTargetPercent(
        row.buyTargetPercentFor5DisplayLots,
        DEFAULT_BUY_TARGET_PERCENT_FOR_5_DISPLAY_LOTS
      ),
      buyTargetPercentFor6OrMoreDisplayLots: normalizeTargetPercent(
        row.buyTargetPercentFor6OrMoreDisplayLots,
        DEFAULT_BUY_TARGET_PERCENT_FOR_6_OR_MORE_DISPLAY_LOTS
      ),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/targets', async (req: Request, res: Response) => {
  try {
    await ensureUserSettingsBuyTargetColumns();
    const userId = req.user?.id!;
    const saleTargetPercent = Number(req.body?.saleTargetPercent);
    const buyTargetPercentUnder3DisplayLots = Number(req.body?.buyTargetPercentUnder3DisplayLots);
    const buyTargetPercentFor3DisplayLots = Number(req.body?.buyTargetPercentFor3DisplayLots);
    const buyTargetPercentFor4DisplayLots = Number(req.body?.buyTargetPercentFor4DisplayLots);
    const buyTargetPercentFor5DisplayLots = Number(req.body?.buyTargetPercentFor5DisplayLots);
    const buyTargetPercentFor6OrMoreDisplayLots = Number(req.body?.buyTargetPercentFor6OrMoreDisplayLots);

    if (!Number.isFinite(saleTargetPercent) || saleTargetPercent <= 0) {
      return res.status(400).json({ error: 'saleTargetPercent must be a positive number' });
    }

    if (!Number.isFinite(buyTargetPercentUnder3DisplayLots) || buyTargetPercentUnder3DisplayLots <= 0) {
      return res.status(400).json({ error: 'buyTargetPercentUnder3DisplayLots must be a positive number' });
    }
    if (!Number.isFinite(buyTargetPercentFor3DisplayLots) || buyTargetPercentFor3DisplayLots <= 0) {
      return res.status(400).json({ error: 'buyTargetPercentFor3DisplayLots must be a positive number' });
    }
    if (!Number.isFinite(buyTargetPercentFor4DisplayLots) || buyTargetPercentFor4DisplayLots <= 0) {
      return res.status(400).json({ error: 'buyTargetPercentFor4DisplayLots must be a positive number' });
    }
    if (!Number.isFinite(buyTargetPercentFor5DisplayLots) || buyTargetPercentFor5DisplayLots <= 0) {
      return res.status(400).json({ error: 'buyTargetPercentFor5DisplayLots must be a positive number' });
    }
    if (!Number.isFinite(buyTargetPercentFor6OrMoreDisplayLots) || buyTargetPercentFor6OrMoreDisplayLots <= 0) {
      return res.status(400).json({ error: 'buyTargetPercentFor6OrMoreDisplayLots must be a positive number' });
    }

    if (saleTargetPercent > 1000) {
      return res.status(400).json({ error: 'saleTargetPercent is too large' });
    }
    if (buyTargetPercentUnder3DisplayLots > 1000) {
      return res.status(400).json({ error: 'buyTargetPercentUnder3DisplayLots is too large' });
    }
    if (buyTargetPercentFor3DisplayLots > 1000) {
      return res.status(400).json({ error: 'buyTargetPercentFor3DisplayLots is too large' });
    }
    if (buyTargetPercentFor4DisplayLots > 1000) {
      return res.status(400).json({ error: 'buyTargetPercentFor4DisplayLots is too large' });
    }
    if (buyTargetPercentFor5DisplayLots > 1000) {
      return res.status(400).json({ error: 'buyTargetPercentFor5DisplayLots is too large' });
    }
    if (buyTargetPercentFor6OrMoreDisplayLots > 1000) {
      return res.status(400).json({ error: 'buyTargetPercentFor6OrMoreDisplayLots is too large' });
    }

    await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .input('saleTargetPercent', sql.Decimal(9, 4), saleTargetPercent)
      .input('buyTargetPercentUnder3DisplayLots', sql.Decimal(9, 4), buyTargetPercentUnder3DisplayLots)
      .input('buyTargetPercentFor3DisplayLots', sql.Decimal(9, 4), buyTargetPercentFor3DisplayLots)
      .input('buyTargetPercentFor4DisplayLots', sql.Decimal(9, 4), buyTargetPercentFor4DisplayLots)
      .input('buyTargetPercentFor5DisplayLots', sql.Decimal(9, 4), buyTargetPercentFor5DisplayLots)
      .input('buyTargetPercentFor6OrMoreDisplayLots', sql.Decimal(9, 4), buyTargetPercentFor6OrMoreDisplayLots)
      .query(`
        MERGE UserSettings AS target
        USING (SELECT @userId AS userId) AS source
          ON target.userId = source.userId
        WHEN MATCHED THEN
          UPDATE SET saleTargetPercent = @saleTargetPercent,
                     buyTargetPercentUnder3DisplayLots = @buyTargetPercentUnder3DisplayLots,
                     buyTargetPercentFor3DisplayLots = @buyTargetPercentFor3DisplayLots,
                     buyTargetPercentFor4DisplayLots = @buyTargetPercentFor4DisplayLots,
                     buyTargetPercentFor5DisplayLots = @buyTargetPercentFor5DisplayLots,
                     buyTargetPercentFor6OrMoreDisplayLots = @buyTargetPercentFor6OrMoreDisplayLots,
                     updatedAt = GETUTCDATE()
        WHEN NOT MATCHED THEN
          INSERT (
            id,
            userId,
            saleTargetPercent,
            buyTargetPercentUnder3DisplayLots,
            buyTargetPercentFor3DisplayLots,
            buyTargetPercentFor4DisplayLots,
            buyTargetPercentFor5DisplayLots,
            buyTargetPercentFor6OrMoreDisplayLots
          )
          VALUES (
            NEWID(),
            @userId,
            @saleTargetPercent,
            @buyTargetPercentUnder3DisplayLots,
            @buyTargetPercentFor3DisplayLots,
            @buyTargetPercentFor4DisplayLots,
            @buyTargetPercentFor5DisplayLots,
            @buyTargetPercentFor6OrMoreDisplayLots
          );
      `);

    res.json({
      saleTargetPercent,
      buyTargetPercentUnder3DisplayLots,
      buyTargetPercentFor3DisplayLots,
      buyTargetPercentFor4DisplayLots,
      buyTargetPercentFor5DisplayLots,
      buyTargetPercentFor6OrMoreDisplayLots,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
