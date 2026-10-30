import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { getPool } from '../db/connection.js';
import { loadAiPreferences, SEEDED_AI_ASSUMPTIONS } from '../services/ai-preferences.js';

const router = Router();
const DEFAULT_SALE_TARGET_PERCENT = 10;
const DEFAULT_BUY_TARGET_PERCENT_AT_BASE_SIZE = 10;
const DEFAULT_BUY_TARGET_PERCENT_BASE_PLUS_1 = 15;
const DEFAULT_BUY_TARGET_PERCENT_BASE_PLUS_2 = 20;
const DEFAULT_BUY_TARGET_PERCENT_BASE_PLUS_3_OR_MORE = 25;
const DEFAULT_BUY_ON_DIP_BUY_TARGET_PERCENT = 1;

router.get('/ai-assumptions', async (req: Request, res: Response) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Authentication required.' });
  try {
    res.json({ assumptions: await loadAiPreferences(req.user.id) });
  } catch (error) {
    console.error('Unable to load AI assumptions:', error);
    res.status(500).json({ error: 'Unable to load AI assumptions.' });
  }
});

router.put('/ai-assumptions', async (req: Request, res: Response) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Authentication required.' });
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean.' });
  }
  try {
    const result = await getPool().request()
      .input('userId', sql.NVarChar, req.user.id)
      .input('enabled', sql.Bit, req.body.enabled)
      .query('UPDATE Users SET aiAssumptionsEnabled = @enabled WHERE id = @userId AND aiInsightsEnabled = 1');
    if (!result.rowsAffected[0]) return res.status(403).json({ error: 'Portfolio insights are not enabled for this user.' });
    res.json({ assumptions: req.body.enabled ? SEEDED_AI_ASSUMPTIONS : null });
  } catch (error) {
    console.error('Unable to save AI assumptions:', error);
    res.status(500).json({ error: 'Unable to save AI assumptions.' });
  }
});

router.get('/profile', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT aiInsightsEnabled
        FROM Users
        WHERE id = @userId
      `);

    res.json({ aiInsightsEnabled: Boolean(result.recordset[0]?.aiInsightsEnabled) });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/targets', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;

    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT TOP 1
          basePurchaseSize,
          saleTargetPercent,
          buyTargetPercentAtBaseSize,
          buyTargetPercentBasePlus1,
          buyTargetPercentBasePlus2,
          buyTargetPercentBasePlus3OrMore,
          buyOnDipBuyTargetPercent
        FROM UserSettings
        WHERE userId = @userId
      `);

    const row = result.recordset[0] ?? {};
    res.json({
      basePurchaseSize: normalizeTargetPercent(row.basePurchaseSize, 300),
      saleTargetPercent: normalizeTargetPercent(row.saleTargetPercent, DEFAULT_SALE_TARGET_PERCENT),
      buyTargetPercentAtBaseSize: normalizeTargetPercent(
        row.buyTargetPercentAtBaseSize,
        DEFAULT_BUY_TARGET_PERCENT_AT_BASE_SIZE
      ),
      buyTargetPercentBasePlus1: normalizeTargetPercent(
        row.buyTargetPercentBasePlus1,
        DEFAULT_BUY_TARGET_PERCENT_BASE_PLUS_1
      ),
      buyTargetPercentBasePlus2: normalizeTargetPercent(
        row.buyTargetPercentBasePlus2,
        DEFAULT_BUY_TARGET_PERCENT_BASE_PLUS_2
      ),
      buyTargetPercentBasePlus3OrMore: normalizeTargetPercent(
        row.buyTargetPercentBasePlus3OrMore,
        DEFAULT_BUY_TARGET_PERCENT_BASE_PLUS_3_OR_MORE
      ),
      buyOnDipBuyTargetPercent: normalizeBuyOnDipBuyTargetPercent(row.buyOnDipBuyTargetPercent),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/targets', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const basePurchaseSize = Number(req.body?.basePurchaseSize);
    const saleTargetPercent = Number(req.body?.saleTargetPercent);
    const buyTargetPercentAtBaseSize = Number(req.body?.buyTargetPercentAtBaseSize);
    const buyTargetPercentBasePlus1 = Number(req.body?.buyTargetPercentBasePlus1);
    const buyTargetPercentBasePlus2 = Number(req.body?.buyTargetPercentBasePlus2);
    const buyTargetPercentBasePlus3OrMore = Number(req.body?.buyTargetPercentBasePlus3OrMore);
    const buyOnDipBuyTargetPercent = Number(req.body?.buyOnDipBuyTargetPercent);

    if (!Number.isFinite(basePurchaseSize) || basePurchaseSize < 0.01 || basePurchaseSize > 9999999999.99
      || Math.abs(basePurchaseSize * 100 - Math.round(basePurchaseSize * 100)) > 0.000001) {
      return res.status(400).json({ error: 'basePurchaseSize must be a positive dollar amount with at most 2 decimal places' });
    }

    if (!Number.isFinite(saleTargetPercent) || saleTargetPercent <= 0) {
      return res.status(400).json({ error: 'saleTargetPercent must be a positive number' });
    }

    if (!Number.isFinite(buyTargetPercentAtBaseSize) || buyTargetPercentAtBaseSize <= 0) {
      return res.status(400).json({ error: 'buyTargetPercentAtBaseSize must be a positive number' });
    }
    if (!Number.isFinite(buyTargetPercentBasePlus1) || buyTargetPercentBasePlus1 <= 0) {
      return res.status(400).json({ error: 'buyTargetPercentBasePlus1 must be a positive number' });
    }
    if (!Number.isFinite(buyTargetPercentBasePlus2) || buyTargetPercentBasePlus2 <= 0) {
      return res.status(400).json({ error: 'buyTargetPercentBasePlus2 must be a positive number' });
    }
    if (!Number.isFinite(buyTargetPercentBasePlus3OrMore) || buyTargetPercentBasePlus3OrMore <= 0) {
      return res.status(400).json({ error: 'buyTargetPercentBasePlus3OrMore must be a positive number' });
    }

    if (!Number.isFinite(buyOnDipBuyTargetPercent) || buyOnDipBuyTargetPercent <= 0 || buyOnDipBuyTargetPercent >= 100) {
      return res.status(400).json({ error: 'buyOnDipBuyTargetPercent must be greater than 0 and less than 100' });
    }

    if (saleTargetPercent > 1000) {
      return res.status(400).json({ error: 'saleTargetPercent is too large' });
    }
    if (buyTargetPercentAtBaseSize > 1000) {
      return res.status(400).json({ error: 'buyTargetPercentAtBaseSize is too large' });
    }
    if (buyTargetPercentBasePlus1 > 1000) {
      return res.status(400).json({ error: 'buyTargetPercentBasePlus1 is too large' });
    }
    if (buyTargetPercentBasePlus2 > 1000) {
      return res.status(400).json({ error: 'buyTargetPercentBasePlus2 is too large' });
    }
    if (buyTargetPercentBasePlus3OrMore > 1000) {
      return res.status(400).json({ error: 'buyTargetPercentBasePlus3OrMore is too large' });
    }

    await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .input('basePurchaseSize', sql.Decimal(12, 2), basePurchaseSize)
      .input('saleTargetPercent', sql.Decimal(9, 4), saleTargetPercent)
      .input('buyTargetPercentAtBaseSize', sql.Decimal(9, 4), buyTargetPercentAtBaseSize)
      .input('buyTargetPercentBasePlus1', sql.Decimal(9, 4), buyTargetPercentBasePlus1)
      .input('buyTargetPercentBasePlus2', sql.Decimal(9, 4), buyTargetPercentBasePlus2)
      .input('buyTargetPercentBasePlus3OrMore', sql.Decimal(9, 4), buyTargetPercentBasePlus3OrMore)
      .input('buyOnDipBuyTargetPercent', sql.Decimal(9, 4), buyOnDipBuyTargetPercent)
      .query(`
        MERGE UserSettings AS target
        USING (SELECT @userId AS userId) AS source
          ON target.userId = source.userId
        WHEN MATCHED THEN
          UPDATE SET basePurchaseSize = @basePurchaseSize,
                     saleTargetPercent = @saleTargetPercent,
                     buyTargetPercentAtBaseSize = @buyTargetPercentAtBaseSize,
                     buyTargetPercentBasePlus1 = @buyTargetPercentBasePlus1,
                     buyTargetPercentBasePlus2 = @buyTargetPercentBasePlus2,
                     buyTargetPercentBasePlus3OrMore = @buyTargetPercentBasePlus3OrMore,
                     buyOnDipBuyTargetPercent = @buyOnDipBuyTargetPercent,
                     updatedAt = GETUTCDATE()
        WHEN NOT MATCHED THEN
          INSERT (
            id,
            userId,
            basePurchaseSize,
            saleTargetPercent,
            buyTargetPercentAtBaseSize,
            buyTargetPercentBasePlus1,
            buyTargetPercentBasePlus2,
            buyTargetPercentBasePlus3OrMore,
            buyOnDipBuyTargetPercent
          )
          VALUES (
            NEWID(),
            @userId,
            @basePurchaseSize,
            @saleTargetPercent,
            @buyTargetPercentAtBaseSize,
            @buyTargetPercentBasePlus1,
            @buyTargetPercentBasePlus2,
            @buyTargetPercentBasePlus3OrMore,
            @buyOnDipBuyTargetPercent
          );
      `);

    res.json({
      basePurchaseSize,
      saleTargetPercent,
      buyTargetPercentAtBaseSize,
      buyTargetPercentBasePlus1,
      buyTargetPercentBasePlus2,
      buyTargetPercentBasePlus3OrMore,
      buyOnDipBuyTargetPercent,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

function normalizeTargetPercent(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBuyOnDipBuyTargetPercent(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 100 ? parsed : DEFAULT_BUY_ON_DIP_BUY_TARGET_PERCENT;
}

export default router;
