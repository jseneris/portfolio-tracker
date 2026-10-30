import sql from 'mssql';
import { getPool } from '../db/connection.js';
import { fetchCurrentPrices } from './current-prices.js';
import { isUsMarketOpen } from './market-hours.js';
import { sendPushNotification, type PushPayload } from './push-notifications.js';

const DEFAULT_SALE_TARGET_PERCENT = 10;
const DEFAULT_BUY_TARGET_PERCENT_AT_BASE_SIZE = 10;
const DEFAULT_BUY_TARGET_PERCENT_BASE_PLUS_1 = 15;
const DEFAULT_BUY_TARGET_PERCENT_BASE_PLUS_2 = 20;
const DEFAULT_BUY_TARGET_PERCENT_BASE_PLUS_3_OR_MORE = 25;
const DEFAULT_BUY_ON_DIP_BUY_TARGET_PERCENT = 1;
const DEFAULT_BASE_SIZE = 3;
const QUANTITY_TOLERANCE = 1e-6;

type TargetSettings = {
  saleTargetPercent: number;
  buyTargetPercentAtBaseSize: number;
  buyTargetPercentBasePlus1: number;
  buyTargetPercentBasePlus2: number;
  buyTargetPercentBasePlus3OrMore: number;
  buyOnDipBuyTargetPercent: number;
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

function buyOnDipPercentOr(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 100 ? parsed : DEFAULT_BUY_ON_DIP_BUY_TARGET_PERCENT;
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

function getBuyTargetPercent(settings: TargetSettings, lotsAboveBaseSize: number): number {
  if (lotsAboveBaseSize <= 0) return settings.buyTargetPercentAtBaseSize;
  if (lotsAboveBaseSize === 1) return settings.buyTargetPercentBasePlus1;
  if (lotsAboveBaseSize === 2) return settings.buyTargetPercentBasePlus2;
  return settings.buyTargetPercentBasePlus3OrMore;
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

function parseDisplayLotQuantities(lotsCsv: string | null): number[] {
  if (!lotsCsv || !lotsCsv.trim()) {
    return [];
  }
  return lotsCsv
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > QUANTITY_TOLERANCE);
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
      WHEN MATCHED AND NOT (target.buyRestricted = 1 AND target.buyRestrictedUntil >= @today) THEN
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

  const [holdingsResult, settingsResult, preferencesResult, displayLotsResult, latestTxResult, splitsResult, purchaseLotsResult] = await Promise.all([
    pool.request().query(`
      SELECT DISTINCT userId, ticker
      FROM PurchaseLots
      WHERE remainingQuantity > 0
    `),
    pool.request().query(`
      SELECT userId, saleTargetPercent, buyTargetPercentAtBaseSize, buyTargetPercentBasePlus1,
             buyTargetPercentBasePlus2, buyTargetPercentBasePlus3OrMore,
             buyOnDipBuyTargetPercent
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
    pool.request().query(`
      SELECT userId, ticker, remainingQuantity, unitCost
      FROM PurchaseLots
      WHERE remainingQuantity > 0 AND sourceType = 'purchase'
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
      buyTargetPercentAtBaseSize: positiveOr(row.buyTargetPercentAtBaseSize, DEFAULT_BUY_TARGET_PERCENT_AT_BASE_SIZE),
      buyTargetPercentBasePlus1: positiveOr(row.buyTargetPercentBasePlus1, DEFAULT_BUY_TARGET_PERCENT_BASE_PLUS_1),
      buyTargetPercentBasePlus2: positiveOr(row.buyTargetPercentBasePlus2, DEFAULT_BUY_TARGET_PERCENT_BASE_PLUS_2),
      buyTargetPercentBasePlus3OrMore: positiveOr(row.buyTargetPercentBasePlus3OrMore, DEFAULT_BUY_TARGET_PERCENT_BASE_PLUS_3_OR_MORE),
      buyOnDipBuyTargetPercent: buyOnDipPercentOr(row.buyOnDipBuyTargetPercent),
    });
  }
  const defaultSettings: TargetSettings = {
    saleTargetPercent: DEFAULT_SALE_TARGET_PERCENT,
    buyTargetPercentAtBaseSize: DEFAULT_BUY_TARGET_PERCENT_AT_BASE_SIZE,
    buyTargetPercentBasePlus1: DEFAULT_BUY_TARGET_PERCENT_BASE_PLUS_1,
    buyTargetPercentBasePlus2: DEFAULT_BUY_TARGET_PERCENT_BASE_PLUS_2,
    buyTargetPercentBasePlus3OrMore: DEFAULT_BUY_TARGET_PERCENT_BASE_PLUS_3_OR_MORE,
    buyOnDipBuyTargetPercent: DEFAULT_BUY_ON_DIP_BUY_TARGET_PERCENT,
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
  const smallestDisplayLot = new Map<string, number>();
  for (const row of displayLotsResult.recordset as any[]) {
    const k = key(String(row.userId), String(row.ticker).toUpperCase());
    displayLotCounts.set(k, (displayLotCounts.get(k) ?? 0) + countDisplayLots(row.lotsCsv));
    for (const quantity of parseDisplayLotQuantities(row.lotsCsv)) {
      smallestDisplayLot.set(k, Math.min(smallestDisplayLot.get(k) ?? Infinity, quantity));
    }
  }

  const purchaseLotsByKey = new Map<string, Array<{ remainingQuantity: number; unitCost: number }>>();
  for (const row of purchaseLotsResult.recordset as any[]) {
    const k = key(String(row.userId), String(row.ticker).toUpperCase());
    const list = purchaseLotsByKey.get(k) ?? [];
    list.push({ remainingQuantity: Number(row.remainingQuantity), unitCost: Number(row.unitCost) });
    purchaseLotsByKey.set(k, list);
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
    const lotCount = displayLotCounts.get(k) ?? 0;
    const baseSize = preference?.baseSize ?? DEFAULT_BASE_SIZE;

    let basePrice: number | null = null;
    if (base && Number.isFinite(base.price) && base.price > 0 && base.transactionDate) {
      // Mirrors getSplitAdjustedTargetBasePrice() on the dashboard.
      const splitMultiplier = activeSplits
        .filter((split) => split.userId === userId && split.ticker === ticker && base.transactionDate <= split.splitDate)
        .reduce((product, split) => product * split.multiplier, 1);
      basePrice = base.price / splitMultiplier;
    }

    let buyOnDipPrice = preference?.buyOnDip && preference.buyOnDipPrice != null
      && Number.isFinite(preference.buyOnDipPrice) && preference.buyOnDipPrice > 0
      ? preference.buyOnDipPrice
      : null;

    // Any holding below its base display-lot size is automatically treated as Buy on Dip,
    // anchored at the split-adjusted last buy/sell price (falling back to the current price).
    let autoEnabledBelowBase = false;
    if (!preference?.buyOnDip && lotCount < baseSize && !preference?.isBuyRestricted) {
      const anchor = basePrice ?? price;
      autoEnabledBelowBase = await enableBuyOnDipAtTrigger(pool, userId, ticker, anchor, today);
      if (autoEnabledBelowBase) {
        buyOnDipPrice = anchor;
      }
    }

    const dipAnchor = buyOnDipPrice ?? (lotCount < baseSize ? basePrice : null);

    let sellTarget: number | null = null;
    let buyTarget: number | null = null;
    if (dipAnchor != null && Number.isFinite(dipAnchor) && dipAnchor > 0) {
      sellTarget = Number((dipAnchor * 1.10).toFixed(8));
      buyTarget = Number((dipAnchor * (1 - settings.buyOnDipBuyTargetPercent / 100)).toFixed(8));
    } else if (basePrice != null && Number.isFinite(basePrice) && basePrice > 0) {
      sellTarget = basePrice * (1 + settings.saleTargetPercent / 100);
      buyTarget = basePrice * (1 - getBuyTargetPercent(settings, lotCount - baseSize) / 100);
    }

    if (sellTarget != null && price >= sellTarget) {
      const withinBaseSize = lotCount <= baseSize;
      const smallestLot = smallestDisplayLot.get(k);
      const profitableQuantity = (purchaseLotsByKey.get(k) ?? [])
        .filter((lot) => lot.unitCost < price)
        .reduce((sum, lot) => sum + lot.remainingQuantity, 0);
      const insufficientProfitableShares = smallestLot != null && profitableQuantity + QUANTITY_TOLERANCE < smallestLot;
      const enabledBuyOnDip = !preference?.buyOnDip && !autoEnabledBelowBase && (withinBaseSize || insufficientProfitableShares)
        ? await enableBuyOnDipAtTrigger(pool, userId, ticker, price, today)
        : false;
      const reason = withinBaseSize
        ? 'this holding is at or below its base display-lot size'
        : 'there are not enough shares purchased below the current price to cover the smallest display lot';
      const body = `${ticker} hit its sell target of ${formatPrice(sellTarget)} (current price ${formatPrice(price)}).`
        + (enabledBuyOnDip ? ` Buy on Dip was automatically enabled at ${formatPrice(price)} because ${reason}.` : '');
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
