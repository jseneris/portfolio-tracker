import { getPool } from '../src/db/connection.js';
import sql from 'mssql';
import { v4 as uuidv4 } from 'uuid';

const TEST_USER_ID = 'auth0|test-user-' + uuidv4().substring(0, 8);
const TOLERANCE = 1e-6;

export { TEST_USER_ID, TOLERANCE };

/**
 * Clear all user data from database (respecting foreign key constraints)
 */
export async function clearUserData(): Promise<void> {
  const pool = getPool();
  const request = pool.request().input('userId', sql.NVarChar, TEST_USER_ID);

  // Delete in proper cascade order
  await request.query('DELETE FROM DisplayLotAllocations WHERE userId = @userId');
  await request.query('DELETE FROM DisplayLotComposition WHERE displayLotId IN (SELECT id FROM DisplayLots WHERE userId = @userId)');
  await request.query('DELETE FROM DisplayLotComposition WHERE purchaseLotId IN (SELECT id FROM PurchaseLots WHERE userId = @userId)');
  await request.query('DELETE FROM DisplayLots WHERE userId = @userId');
  await request.query('DELETE FROM PurchaseLotAllocations WHERE userId = @userId');
  await request.query('DELETE FROM SplitAdjustments WHERE userId = @userId');
  await request.query('DELETE FROM UserSplitActivations WHERE userId = @userId');
  await request.query('DELETE FROM PurchaseLots WHERE userId = @userId');
  await request.query('DELETE FROM StockTransactions WHERE userId = @userId');
  await request.query('DELETE FROM StockSplits');
  await request.query('DELETE FROM CashTransactions WHERE userId = @userId');
  await request.query('DELETE FROM UserSettings WHERE userId = @userId');
  await request.query('DELETE FROM Users WHERE id = @userId');
}

/**
 * Helper to make a cash deposit
 */
export async function depositCash(amount: number, date?: Date): Promise<string> {
  const pool = getPool();
  const txId = uuidv4();
  const txDate = date || new Date();

  await pool.request()
    .input('id', sql.UniqueIdentifier, txId)
    .input('userId', sql.NVarChar, TEST_USER_ID)
    .input('type', sql.NVarChar, 'deposit')
    .input('amount', sql.Decimal(18, 4), amount)
    .input('transactionDate', sql.DateTime2, txDate)
    .query(`
      INSERT INTO CashTransactions (id, userId, type, amount, transactionDate)
      VALUES (@id, @userId, @type, @amount, @transactionDate)
    `);

  return txId;
}

/**
 * Helper to make a stock purchase
 */
export async function buyStock(ticker: string, quantity: number, price: number, date?: Date): Promise<string> {
  const pool = getPool();
  const txId = uuidv4();
  const lotId = uuidv4();
  const txDate = date || new Date();
  const amount = quantity * price;

  await pool.request()
    .input('id', sql.UniqueIdentifier, txId)
    .input('userId', sql.NVarChar, TEST_USER_ID)
    .input('ticker', sql.NVarChar, ticker.toUpperCase())
    .input('type', sql.NVarChar, 'buy')
    .input('quantity', sql.Decimal(18, 8), quantity)
    .input('price', sql.Decimal(18, 8), price)
    .input('amount', sql.Decimal(18, 4), amount)
    .input('transactionDate', sql.DateTime2, txDate)
    .query(`
      INSERT INTO StockTransactions (id, userId, ticker, type, quantity, price, amount, transactionDate)
      VALUES (@id, @userId, @ticker, @type, @quantity, @price, @amount, @transactionDate)
    `);

  // Also create the corresponding PurchaseLot
  await pool.request()
    .input('lotId', sql.UniqueIdentifier, lotId)
    .input('userId', sql.NVarChar, TEST_USER_ID)
    .input('ticker', sql.NVarChar, ticker.toUpperCase())
    .input('transactionId', sql.UniqueIdentifier, txId)
    .input('quantity', sql.Decimal(18, 8), quantity)
    .input('price', sql.Decimal(18, 8), price)
    .input('transactionDate', sql.DateTime2, txDate)
    .query(`
      INSERT INTO PurchaseLots (id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate)
      VALUES (@lotId, @userId, @ticker, @transactionId, 'purchase', @quantity, @quantity, @price, @transactionDate)
    `);

  return txId;
}

/**
 * Helper to sell stock with explicit Purchase Lot allocation
 */
export async function sellStock(
  ticker: string,
  quantity: number,
  price: number,
  allocations: { lotId: string; quantity: number }[],
  date?: Date
): Promise<string> {
  const pool = getPool();
  const txId = uuidv4();
  const txDate = date || new Date();
  const amount = quantity * price;

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    // Insert stock transaction
    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, txId)
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .input('type', sql.NVarChar, 'sell')
      .input('quantity', sql.Decimal(18, 8), quantity)
      .input('price', sql.Decimal(18, 8), price)
      .input('amount', sql.Decimal(18, 4), amount)
      .input('transactionDate', sql.DateTime2, txDate)
      .query(`
        INSERT INTO StockTransactions (id, userId, ticker, type, quantity, price, amount, transactionDate)
        VALUES (@id, @userId, @ticker, @type, @quantity, @price, @amount, @transactionDate)
      `);

    // Insert allocations and update lots
    for (const alloc of allocations) {
      await new sql.Request(transaction)
        .input('id', sql.UniqueIdentifier, uuidv4())
        .input('userId', sql.NVarChar, TEST_USER_ID)
        .input('saleTransactionId', sql.UniqueIdentifier, txId)
        .input('purchaseLotId', sql.UniqueIdentifier, alloc.lotId)
        .input('quantityConsumed', sql.Decimal(18, 8), alloc.quantity)
        .query(`
          INSERT INTO PurchaseLotAllocations (id, userId, saleTransactionId, purchaseLotId, quantityConsumed)
          VALUES (@id, @userId, @saleTransactionId, @purchaseLotId, @quantityConsumed)
        `);

      // Update purchase lot remaining quantity
      const updateResult = await new sql.Request(transaction)
        .input('lotId', sql.UniqueIdentifier, alloc.lotId)
        .input('quantityConsumed', sql.Decimal(18, 8), alloc.quantity)
        .query(`
          UPDATE PurchaseLots
          SET remainingQuantity = remainingQuantity - @quantityConsumed
          WHERE id = @lotId
        `);
      
      if (updateResult.rowsAffected[0] !== 1) {
        throw new Error(`Failed to update lot ${alloc.lotId}: no rows affected`);
      }
    }

    await transaction.commit();
  } catch (error) {
    try {
      if (transaction.state === sql.ConnectionState.LoggedIn) {
        await transaction.rollback();
      }
    } catch (rollbackError) {
      // Transaction might already be rolled back, ignore
    }
    throw error;
  }

  return txId;
}

/**
 * Helper to create a dividend
 */
export async function payDividend(ticker: string, quantity: number, amount: number, date?: Date): Promise<string> {
  const pool = getPool();
  const txId = uuidv4();
  const lotId = uuidv4();
  const txDate = date || new Date();
  const unitCost = amount / quantity; // Price per share

  await pool.request()
    .input('id', sql.UniqueIdentifier, txId)
    .input('userId', sql.NVarChar, TEST_USER_ID)
    .input('ticker', sql.NVarChar, ticker.toUpperCase())
    .input('type', sql.NVarChar, 'div')
    .input('quantity', sql.Decimal(18, 8), quantity)
    .input('amount', sql.Decimal(18, 4), amount)
    .input('transactionDate', sql.DateTime2, txDate)
    .query(`
      INSERT INTO StockTransactions (id, userId, ticker, type, quantity, amount, transactionDate)
      VALUES (@id, @userId, @ticker, @type, @quantity, @amount, @transactionDate)
    `);

  // Also create the corresponding Dividend Lot
  await pool.request()
    .input('lotId', sql.UniqueIdentifier, lotId)
    .input('userId', sql.NVarChar, TEST_USER_ID)
    .input('ticker', sql.NVarChar, ticker.toUpperCase())
    .input('transactionId', sql.UniqueIdentifier, txId)
    .input('quantity', sql.Decimal(18, 8), quantity)
    .input('unitCost', sql.Decimal(18, 8), unitCost)
    .input('transactionDate', sql.DateTime2, txDate)
    .query(`
      INSERT INTO PurchaseLots (id, userId, ticker, transactionId, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate)
      VALUES (@lotId, @userId, @ticker, @transactionId, 'dividend', @quantity, @quantity, @unitCost, @transactionDate)
    `);

  return txId;
}

/**
 * Helper to create a display lot
 */
export async function createDisplayLot(
  ticker: string,
  composition: { purchaseLotId: string; quantityAllocated: number }[]
): Promise<string> {
  const pool = getPool();
  const normalizedTicker = ticker.toUpperCase();
  const quantities = composition.map((c) => Number(c.quantityAllocated));

  if (quantities.length === 0 || quantities.some((q) => !Number.isFinite(q) || q <= 0)) {
    throw new Error('Display lot quantities must be positive numbers');
  }

  const existing = await pool.request()
    .input('userId', sql.NVarChar, TEST_USER_ID)
    .input('ticker', sql.NVarChar, normalizedTicker)
    .query(`
      SELECT TOP 1 id, lotsCsv
      FROM DisplayLots
      WHERE userId = @userId AND ticker = @ticker
    `);

  let displayLotId = '';
  if (existing.recordset.length === 0) {
    displayLotId = uuidv4();
    const lotsCsv = quantities.map((q) => Number(q.toFixed(8))).join(',');
    await pool.request()
      .input('id', sql.UniqueIdentifier, displayLotId)
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, normalizedTicker)
      .input('lotsCsv', sql.NVarChar(sql.MAX), lotsCsv)
      .query(`
        INSERT INTO DisplayLots (id, userId, ticker, lotsCsv)
        VALUES (@id, @userId, @ticker, @lotsCsv)
      `);
    return displayLotId;
  }

  displayLotId = String(existing.recordset[0].id);
  const currentCsv = String(existing.recordset[0].lotsCsv || '');
  const currentLots = currentCsv
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);

  const nextLots = [...currentLots, ...quantities.map((q) => Number(q.toFixed(8)))];
  const nextCsv = nextLots.join(',');

  await pool.request()
    .input('id', sql.UniqueIdentifier, displayLotId)
    .input('userId', sql.NVarChar, TEST_USER_ID)
    .input('lotsCsv', sql.NVarChar(sql.MAX), nextCsv)
    .query(`
      UPDATE DisplayLots
      SET lotsCsv = @lotsCsv, updatedAt = GETUTCDATE()
      WHERE id = @id AND userId = @userId
    `);

  return displayLotId;
}

/**
 * Helper to get all purchase lots for a ticker
 */
export async function getPurchaseLots(ticker: string): Promise<any[]> {
  const pool = getPool();
  const result = await pool.request()
    .input('userId', sql.NVarChar, TEST_USER_ID)
    .input('ticker', sql.NVarChar, ticker.toUpperCase())
    .query(`
      SELECT id, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate, splitAdjusted, lastSplitId
      FROM PurchaseLots
      WHERE userId = @userId AND ticker = @ticker
      ORDER BY purchaseDate ASC
    `);

  return result.recordset;
}

/**
 * Helper to get all display lots for a ticker
 */
export async function getDisplayLots(ticker: string): Promise<any[]> {
  const pool = getPool();
  const result = await pool.request()
    .input('userId', sql.NVarChar, TEST_USER_ID)
    .input('ticker', sql.NVarChar, ticker.toUpperCase())
    .query(`
      SELECT id, lotsCsv, createdAt
      FROM DisplayLots
      WHERE userId = @userId AND ticker = @ticker
      ORDER BY createdAt ASC
    `);

  const expanded: any[] = [];
  for (const row of result.recordset as any[]) {
    const lots = String(row.lotsCsv || '')
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);

    lots.forEach((qty, index) => {
      expanded.push({
        id: `${String(row.id)}:${index}`,
        rowId: String(row.id),
        lotIndex: index,
        totalQuantity: Number(qty.toFixed(8)),
        createdAt: row.createdAt,
      });
    });
  }

  return expanded;
}

/**
 * Helper to get display lot composition
 */
export async function getDisplayLotComposition(displayLotId: string): Promise<any[]> {
  const pool = getPool();
  const rowId = displayLotId.includes(':') ? displayLotId.split(':')[0] : displayLotId;
  const result = await pool.request()
    .input('displayLotId', sql.UniqueIdentifier, rowId)
    .query(`
      SELECT lotsCsv, ticker
      FROM DisplayLots
      WHERE id = @displayLotId
    `);

  if (result.recordset.length === 0) {
    return [];
  }

  const row = result.recordset[0] as any;
  const lots = String(row.lotsCsv || '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);

  return lots.map((quantityAllocated, index) => ({
    id: `${rowId}:${index}`,
    index,
    quantityAllocated: Number(quantityAllocated.toFixed(8)),
    ticker: String(row.ticker || ''),
  }));
}

/**
 * Helper to get cash balance
 */
export async function getCashBalance(): Promise<number> {
  const pool = getPool();
  const result = await pool.request()
    .input('userId', sql.NVarChar, TEST_USER_ID)
    .query(`
      WITH CashAgg AS (
        SELECT
          SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END) AS deposits,
          SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END) AS withdrawals,
          SUM(CASE WHEN type = 'interest' THEN amount ELSE 0 END) AS interest,
          SUM(CASE WHEN type = 'fee' THEN amount ELSE 0 END) AS fees
        FROM CashTransactions
        WHERE userId = @userId
      ),
      StockAgg AS (
        SELECT
          SUM(CASE WHEN type = 'buy' THEN amount ELSE 0 END) AS buys,
          SUM(CASE WHEN type = 'sell' THEN amount ELSE 0 END) AS sells
        FROM StockTransactions
        WHERE userId = @userId
      )
      SELECT
        COALESCE(c.deposits, 0) + COALESCE(c.interest, 0) - COALESCE(c.withdrawals, 0) - COALESCE(c.fees, 0) - COALESCE(s.buys, 0) + COALESCE(s.sells, 0) AS balance
      FROM CashAgg c
      CROSS JOIN StockAgg s
    `);

  return Number(result.recordset[0]?.balance || 0);
}

/**
 * Helper to apply a stock split globally
 */
export async function applySplit(ticker: string, numerator: number, denominator: number, date?: Date): Promise<string> {
  const pool = getPool();
  const splitDate = date || new Date();
  const multiplier = numerator / denominator;

  // Check if this split already exists (idempotency)
  const existingResult = await pool.request()
    .input('ticker', sql.NVarChar, ticker.toUpperCase())
    .input('numerator', sql.Decimal(18, 8), numerator)
    .input('denominator', sql.Decimal(18, 8), denominator)
    .input('splitDate', sql.DateTime2, splitDate)
    .query(`
      SELECT id FROM StockSplits
      WHERE ticker = @ticker
        AND ratioNumerator = @numerator
        AND ratioDenominator = @denominator
        AND splitDate = @splitDate
    `);

  if (existingResult.recordset.length > 0) {
    return existingResult.recordset[0].id;
  }

  const splitId = uuidv4();

  await pool.request()
    .input('id', sql.UniqueIdentifier, splitId)
    .input('ticker', sql.NVarChar, ticker.toUpperCase())
    .input('numerator', sql.Decimal(18, 8), numerator)
    .input('denominator', sql.Decimal(18, 8), denominator)
    .input('multiplier', sql.Decimal(18, 8), multiplier)
    .input('splitDate', sql.DateTime2, splitDate)
    .query(`
      INSERT INTO StockSplits (id, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate)
      VALUES (@id, @ticker, @numerator, @denominator, @multiplier, @splitDate)
    `);

  await pool.request()
    .input('id', sql.UniqueIdentifier, uuidv4())
    .input('userId', sql.NVarChar, TEST_USER_ID)
    .input('splitId', sql.UniqueIdentifier, splitId)
    .input('activatedBy', sql.NVarChar, 'manual')
    .query(`
      IF NOT EXISTS (
        SELECT 1 FROM UserSplitActivations WHERE userId = @userId AND splitId = @splitId
      )
      INSERT INTO UserSplitActivations (id, userId, splitId, activatedBy)
      VALUES (@id, @userId, @splitId, @activatedBy)
    `);

  return splitId;
}
