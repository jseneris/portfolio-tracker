import sql from 'mssql';
import { getPool } from '../db/connection.js';
import { fetchCurrentPrices } from './current-prices.js';
import { isUsMarketOpen } from './market-hours.js';
import { sendPushNotification, type PushPayload } from './push-notifications.js';

const DEFAULT_SALE_TARGET_PERCENT = 10;
const DEFAULT_BUY_TARGET_PERCENT_UNDER_3_DISPLAY_LOTS = 5;
const DEFAULT_BUY_TARGET_PERCENT_FOR_3_DISPLAY_LOTS = 10;
const DEFAULT_BUY_TARGET_PERCENT_FOR_4_DISPLAY_LOTS = 15;
const DEFAULT_BUY_TARGET_PERCENT_FOR_5_DISPLAY_LOTS = 20;
const DEFAULT_BUY_TARGET_PERCENT_FOR_6_OR_MORE_DISPLAY_LOTS = 25;
const QUANTITY_TOLERANCE = 1e-6;

type TargetSettings = {
  saleTargetPercent: number;
  buyTargetPercentUnder3DisplayLots: number;
  buyTargetPercentFor3DisplayLots: number;
  buyTargetPercentFor4DisplayLots: number;
  buyTargetPercentFor5DisplayLots: number;
  buyTargetPercentFor6OrMoreDisplayLots: number;
};

type MessageType = 'buy-target-hit' | 'sell-target-hit';

export type PriceTargetCycleOptions = {
  now?: Date;
  ignoreMarketHours?: boolean;
  getPrices?: (tickers: string[]) => Promise<Record<string, number>>;
  sendNotification?: (userId: string, payload: PushPayload) => Promise<void>;
};

export type PriceTargetCycleSummary = {
  marketOpen: boolean;
  checked: number;
  created: number;
  missingTickers: string[];
};

function positiveOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toDateOnly(value: Date | string | null | undefined): string {
  if (value == null) {
    return '';
  }
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function key(userId: string, ticker: string): string {
  return `${userId}\u0000${ticker}`;
}

function getBuyTargetPercent(settings: TargetSettings, displayLotCount: number): number {
  if (displayLotCount < 3) return settings.buyTargetPercentUnder3DisplayLots;
  if (displayLotCount === 3) return settings.buyTargetPercentFor3DisplayLots;
  if (displayLotCount === 4) return settings.buyTargetPercentFor4DisplayLots;
  if (displayLotCount === 5) return settings.buyTargetPercentFor5DisplayLots;
  return settings.buyTargetPercentFor6OrMoreDisplayLots;
}

function countDisplayLots(lotsCsv: string | null): number {
  if (!lotsCsv || !lotsCsv.trim()) {
    return 0;
  }
  return lotsCsv
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > QUANTITY_TOLERANCE)
    .length;
}

function formatPrice(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

async function defaultGetPrices(tickers: string[]): Promise<Record<string, number>> {
  const { prices } = await fetchCurrentPrices(tickers);
  return Object.fromEntries(prices.map((row) => [row.ticker, row.price]));
}

async function insertMessageIfNoUnread(
  pool: sql.ConnectionPool,
  message: { userId: string; ticker: string; type: MessageType; targetPrice: number | null; triggerPrice: number; body: string }
): Promise<boolean> {
  const result = await pool.request()
    .input('userId', sql.NVarChar, message.userId)
    .input('ticker', sql.NVarChar, message.ticker)
    .input('type', sql.NVarChar, message.type)
    .input('targetPrice', sql.Decimal(18, 8), message.targetPrice)
    .input('triggerPrice', sql.Decimal(18, 8), message.triggerPrice)
    .input('body', sql.NVarChar(500), message.body)
    .query(`
      INSERT INTO Messages (userId, type, ticker, targetPrice, triggerPrice, body)
      SELECT @userId, @type, @ticker, @targetPrice, @triggerPrice, @body
      WHERE NOT EXISTS (
        SELECT 1 FROM Messages WITH (UPDLOCK, HOLDLOCK)
        WHERE userId = @userId AND ticker = @ticker AND type = @type AND isRead = 0
      );
    `);
  return (result.rowsAffected[0] ?? 0) > 0;
}

async function enableBuyOnDipAtTrigger(
  pool: sql.ConnectionPool, userId: string, ticker: string, price: number, today: string
): Promise<boolean> {
  if (!Number.isFinite(price) || price < 0.00000001 || price >= 10000000000) {
    throw new Error(`[price-target-alerts] Cannot capture Buy on Dip price for ${ticker}: price is outside the supported range.`);
  }
  const result = await pool.request()
    .input('userId', sql.NVarChar, userId)
    .input('ticker', sql.NVarChar, ticker)
    .input('price', sql.Decimal(18, 8), price)
    .input('today', sql.Date, today)
    .query(`
      MERGE UserTickerPreferences WITH (HOLDLOCK) AS target
      USING (SELECT @userId AS userId, @ticker AS ticker) AS source
        ON target.userId = source.userId AND target.ticker = source.ticker
      WHEN MATCHED AND target.buyOnDip = 0
        AND NOT (target.buyRestricted = 1 AND target.buyRestrictedUntil >= @today) THEN
        UPDATE SET buyOnDip = 1, buyOnDipPrice = @price, updatedAt = GETUTCDATE()
      WHEN NOT MATCHED THEN
        INSERT (id, userId, ticker, buyOnDip, buyOnDipPrice, buyRestricted, buyRestrictedUntil)
        VALUES (NEWID(), @userId, @ticker, 1, @price, 0, NULL)
      OUTPUT inserted.ticker;
    `);
  return result.recordset.length > 0;
}

export async function runPriceTargetAlertCycle(options: PriceTargetCycleOptions = {}): Promise<PriceTargetCycleSummary> {
  const now = options.now ?? new Date();
  const marketOpen = isUsMarketOpen(now);
  if (!marketOpen && !options.ignoreMarketHours) {
    return { marketOpen, checked: 0, created: 0, missingTickers: [] };
  }

  const pool = getPool();
  const today = now.toISOString().slice(0, 10);

  const [holdingsResult, settingsResult, preferencesResult, displayLotsResult, latestTxResult, splitsResult] = await Promise.all([
    pool.request().query(`
      SELECT DISTINCT userId, ticker
      FROM PurchaseLots
      WHERE remainingQuantity > 0
    `),
    pool.request().query(`
      SELECT userId, saleTargetPercent, buyTargetPercentUnder3DisplayLots, buyTargetPercentFor3DisplayLots,
             buyTargetPercentFor4DisplayLots, buyTargetPercentFor5DisplayLots, buyTargetPercentFor6OrMoreDisplayLots
      FROM UserSettings
    `),
    pool.request().query(`
      SELECT userId, ticker, baseSize, buyOnDip, buyOnDipPrice, buyRestricted, buyRestrictedUntil
      FROM UserTickerPreferences
    `),
    pool.request().query(`
      SELECT userId, ticker, lotsCsv
      FROM DisplayLots
    `),
    pool.request().query(`
      ;WITH Ranked AS (
        SELECT userId, ticker, price, transactionDate,
               ROW_NUMBER() OVER (PARTITION BY userId, ticker ORDER BY transactionDate DESC, createdAt DESC) AS rn
        FROM StockTransactions
        WHERE type IN ('buy', 'sell') AND price > 0
      )
      SELECT userId, ticker, price, transactionDate FROM Ranked WHERE rn = 1
    `),
    pool.request().query(`
      SELECT usa.userId, ss.ticker, ss.splitDate, ss.multiplier
      FROM UserSplitActivations usa
      INNER JOIN StockSplits ss ON ss.id = usa.splitId
    `),
  ]);

  const holdings = (holdingsResult.recordset as any[]).map((row) => ({
    userId: String(row.userId),
    ticker: String(row.ticker).toUpperCase(),
  }));
  if (holdings.length === 0) {
    return { marketOpen, checked: 0, created: 0, missingTickers: [] };
  }

  const settingsByUser = new Map<string, TargetSettings>();
  for (const row of settingsResult.recordset as any[]) {
    settingsByUser.set(String(row.userId), {
      saleTargetPercent: positiveOr(row.saleTargetPercent, DEFAULT_SALE_TARGET_PERCENT),
      buyTargetPercentUnder3DisplayLots: positiveOr(row.buyTargetPercentUnder3DisplayLots, DEFAULT_BUY_TARGET_PERCENT_UNDER_3_DISPLAY_LOTS),
      buyTargetPercentFor3DisplayLots: positiveOr(row.buyTargetPercentFor3DisplayLots, DEFAULT_BUY_TARGET_PERCENT_FOR_3_DISPLAY_LOTS),
      buyTargetPercentFor4DisplayLots: positiveOr(row.buyTargetPercentFor4DisplayLots, DEFAULT_BUY_TARGET_PERCENT_FOR_4_DISPLAY_LOTS),
      buyTargetPercentFor5DisplayLots: positiveOr(row.buyTargetPercentFor5DisplayLots, DEFAULT_BUY_TARGET_PERCENT_FOR_5_DISPLAY_LOTS),
      buyTargetPercentFor6OrMoreDisplayLots: positiveOr(row.buyTargetPercentFor6OrMoreDisplayLots, DEFAULT_BUY_TARGET_PERCENT_FOR_6_OR_MORE_DISPLAY_LOTS),
    });
  }
  const defaultSettings: TargetSettings = {
    saleTargetPercent: DEFAULT_SALE_TARGET_PERCENT,
    buyTargetPercentUnder3DisplayLots: DEFAULT_BUY_TARGET_PERCENT_UNDER_3_DISPLAY_LOTS,
    buyTargetPercentFor3DisplayLots: DEFAULT_BUY_TARGET_PERCENT_FOR_3_DISPLAY_LOTS,
    buyTargetPercentFor4DisplayLots: DEFAULT_BUY_TARGET_PERCENT_FOR_4_DISPLAY_LOTS,
    buyTargetPercentFor5DisplayLots: DEFAULT_BUY_TARGET_PERCENT_FOR_5_DISPLAY_LOTS,
    buyTargetPercentFor6OrMoreDisplayLots: DEFAULT_BUY_TARGET_PERCENT_FOR_6_OR_MORE_DISPLAY_LOTS,
  };

  const preferences = new Map<string, { baseSize: number; buyOnDip: boolean; buyOnDipPrice: number | null; isBuyRestricted: boolean }>();
  for (const row of preferencesResult.recordset as any[]) {
    const restrictedUntil = toDateOnly(row.buyRestrictedUntil);
    preferences.set(key(String(row.userId), String(row.ticker).toUpperCase()), {
      baseSize: Number(row.baseSize ?? 3),
      buyOnDip: Boolean(row.buyOnDip),
      buyOnDipPrice: row.buyOnDipPrice == null ? null : Number(row.buyOnDipPrice),
      isBuyRestricted: Boolean(row.buyRestricted) && restrictedUntil !== '' && today <= restrictedUntil,
    });
  }

  const displayLotCounts = new Map<string, number>();
  for (const row of displayLotsResult.recordset as any[]) {
    const k = key(String(row.userId), String(row.ticker).toUpperCase());
    displayLotCounts.set(k, (displayLotCounts.get(k) ?? 0) + countDisplayLots(row.lotsCsv));
  }

  const latestTx = new Map<string, { price: number; transactionDate: string }>();
  for (const row of latestTxResult.recordset as any[]) {
    latestTx.set(key(String(row.userId), String(row.ticker).toUpperCase()), {
      price: Number(row.price),
      transactionDate: toDateOnly(row.transactionDate),
    });
  }

  const activeSplits = (splitsResult.recordset as any[])
    .map((row) => ({
      userId: String(row.userId),
      ticker: String(row.ticker).toUpperCase(),
      splitDate: toDateOnly(row.splitDate),
      multiplier: Number(row.multiplier),
    }))
    .filter((split) => split.splitDate && split.splitDate <= today && Number.isFinite(split.multiplier) && split.multiplier > 0);

  const tickers = Array.from(new Set(holdings.map((row) => row.ticker))).sort();
  const pricesByTicker = await (options.getPrices ?? defaultGetPrices)(tickers);
  const missingTickers = tickers.filter((ticker) => !(Number(pricesByTicker[ticker]) > 0));

  let checked = 0;
  let created = 0;
  const notify = options.sendNotification ?? sendPushNotification;

  async function sendMessageNotification(userId: string, title: string, body: string): Promise<void> {
    try {
      await notify(userId, { title, body, url: '/messages' });
    } catch (error) {
      console.error('[price-target-alerts] Push notification failed:', error);
    }
  }

  for (const { userId, ticker } of holdings) {
    const price = Number(pricesByTicker[ticker]);
    if (!Number.isFinite(price) || price <= 0) {
      continue;
    }
    checked += 1;

    const k = key(userId, ticker);
    const settings = settingsByUser.get(userId) ?? defaultSettings;
    const preference = preferences.get(k);
    const base = latestTx.get(k);

    let sellTarget: number | null = null;
    let buyTarget: number | null = null;
    if (base && Number.isFinite(base.price) && base.price > 0 && base.transactionDate) {
      // Mirrors getSplitAdjustedTargetBasePrice() on the dashboard.
      const splitMultiplier = activeSplits
        .filter((split) => split.userId === userId && split.ticker === ticker && base.transactionDate <= split.splitDate)
        .reduce((product, split) => product * split.multiplier, 1);
      const basePrice = base.price / splitMultiplier;
      sellTarget = basePrice * (1 + settings.saleTargetPercent / 100);
      buyTarget = basePrice * (1 - getBuyTargetPercent(settings, displayLotCounts.get(k) ?? 0) / 100);
    }

    if (preference?.buyOnDip && preference.buyOnDipPrice != null && Number.isFinite(preference.buyOnDipPrice) && preference.buyOnDipPrice > 0) {
      sellTarget = Number((preference.buyOnDipPrice * 1.10).toFixed(8));
      buyTarget = Number((preference.buyOnDipPrice * 0.99).toFixed(8));
    }

    if (sellTarget != null && price >= sellTarget) {
      const enabledBuyOnDip = !preference?.buyOnDip
        && (displayLotCounts.get(k) ?? 0) === (preference?.baseSize ?? 3)
        ? await enableBuyOnDipAtTrigger(pool, userId, ticker, price, today)
        : false;
      const body = `${ticker} hit its sell target of ${formatPrice(sellTarget)} (current price ${formatPrice(price)}).`
        + (enabledBuyOnDip ? ` Buy on Dip was automatically enabled at ${formatPrice(price)} because this holding matches its base display-lot size.` : '');
      const inserted = await insertMessageIfNoUnread(pool, {
        userId,
        ticker,
        type: 'sell-target-hit',
        targetPrice: sellTarget,
        triggerPrice: price,
        body,
      });
      if (inserted) {
        created += 1;
        await sendMessageNotification(userId, `${ticker} sell target reached`, body);
      }
    }

    if (preference?.isBuyRestricted) {
      continue;
    }

    if (buyTarget != null && price <= buyTarget) {
      const body = `${ticker} hit its buy target of ${formatPrice(buyTarget)} (current price ${formatPrice(price)}).`;
      const inserted = await insertMessageIfNoUnread(pool, {
        userId,
        ticker,
        type: 'buy-target-hit',
        targetPrice: buyTarget,
        triggerPrice: price,
        body,
      });
      if (inserted) {
        created += 1;
        await sendMessageNotification(userId, `${ticker} buy target reached`, body);
      }
    }
  }

  return { marketOpen, checked, created, missingTickers };
}
