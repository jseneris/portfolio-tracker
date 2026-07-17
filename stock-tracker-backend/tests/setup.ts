import { getPool } from '../src/db/connection.js';
import sql from 'mssql';
import { v4 as uuidv4 } from 'uuid';

const TEST_USER_ID = 'test-user-' + uuidv4().substring(0, 8);
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
  await request.query('DELETE FROM DisplayLots WHERE userId = @userId');
  await request.query('DELETE FROM PurchaseLotAllocations WHERE userId = @userId');
  await request.query('DELETE FROM SplitAdjustments WHERE userId = @userId');
  await request.query('DELETE FROM PurchaseLots WHERE userId = @userId');
  await request.query('DELETE FROM StockTransactions WHERE userId = @userId');
  await request.query('DELETE FROM CashTransactions WHERE userId = @userId');
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

    // Insert allocations
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
      await new sql.Request(transaction)
        .input('lotId', sql.UniqueIdentifier, alloc.lotId)
        .input('quantityConsumed', sql.Decimal(18, 8), alloc.quantity)
        .query(`
          UPDATE PurchaseLots
          SET remainingQuantity = remainingQuantity - @quantityConsumed
          WHERE id = @lotId
        `);
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
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
  const txDate = date || new Date();

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
  const displayLotId = uuidv4();
  const totalQuantity = composition.reduce((sum, c) => sum + c.quantityAllocated, 0);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    // Create display lot
    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, displayLotId)
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .input('totalQuantity', sql.Decimal(18, 8), totalQuantity)
      .query(`
        INSERT INTO DisplayLots (id, userId, ticker, totalQuantity)
        VALUES (@id, @userId, @ticker, @totalQuantity)
      `);

    // Add composition
    for (const comp of composition) {
      await new sql.Request(transaction)
        .input('id', sql.UniqueIdentifier, uuidv4())
        .input('displayLotId', sql.UniqueIdentifier, displayLotId)
        .input('purchaseLotId', sql.UniqueIdentifier, comp.purchaseLotId)
        .input('quantityAllocated', sql.Decimal(18, 8), comp.quantityAllocated)
        .query(`
          INSERT INTO DisplayLotComposition (id, displayLotId, purchaseLotId, quantityAllocated)
          VALUES (@id, @displayLotId, @purchaseLotId, @quantityAllocated)
        `);
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

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
      SELECT id, sourceType, originalQuantity, remainingQuantity, unitCost, purchaseDate
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
      SELECT id, totalQuantity, createdAt
      FROM DisplayLots
      WHERE userId = @userId AND ticker = @ticker
      ORDER BY createdAt ASC
    `);

  return result.recordset;
}

/**
 * Helper to get display lot composition
 */
export async function getDisplayLotComposition(displayLotId: string): Promise<any[]> {
  const pool = getPool();
  const result = await pool.request()
    .input('displayLotId', sql.UniqueIdentifier, displayLotId)
    .query(`
      SELECT purchaseLotId, quantityAllocated
      FROM DisplayLotComposition
      WHERE displayLotId = @displayLotId
      ORDER BY purchaseLotId ASC
    `);

  return result.recordset;
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
          SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END) AS withdrawals
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
        COALESCE(c.deposits, 0) - COALESCE(c.withdrawals, 0) - COALESCE(s.buys, 0) + COALESCE(s.sells, 0) AS balance
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
  const splitId = uuidv4();
  const splitDate = date || new Date();
  const multiplier = numerator / denominator;

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    // Record split
    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, splitId)
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .input('numerator', sql.Decimal(18, 8), numerator)
      .input('denominator', sql.Decimal(18, 8), denominator)
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, splitDate)
      .query(`
        INSERT INTO StockSplits (id, userId, ticker, ratioNumerator, ratioDenominator, multiplier, splitDate)
        VALUES (@id, @userId, @ticker, @numerator, @denominator, @multiplier, @splitDate)
      `);

    // Update purchase lots
    await new sql.Request(transaction)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, splitDate)
      .input('splitId', sql.UniqueIdentifier, splitId)
      .query(`
        UPDATE PurchaseLots
        SET originalQuantity = originalQuantity * @multiplier,
            remainingQuantity = remainingQuantity * @multiplier,
            unitCost = unitCost / @multiplier,
            lastSplitId = @splitId
        WHERE ticker = @ticker AND purchaseDate <= @splitDate
      `);

    // Update stock transactions
    await new sql.Request(transaction)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, splitDate)
      .input('splitId', sql.UniqueIdentifier, splitId)
      .query(`
        UPDATE StockTransactions
        SET quantity = CASE WHEN quantity IS NOT NULL THEN quantity * @multiplier ELSE NULL END,
            price = CASE WHEN price IS NOT NULL THEN price / @multiplier ELSE NULL END,
            lastSplitId = @splitId
        WHERE ticker = @ticker AND transactionDate <= @splitDate AND type IN ('buy', 'sell', 'div')
      `);

    // Update allocations
    await new sql.Request(transaction)
      .input('ticker', sql.NVarChar, ticker.toUpperCase())
      .input('multiplier', sql.Decimal(18, 8), multiplier)
      .input('splitDate', sql.DateTime2, splitDate)
      .query(`
        UPDATE pla
        SET pla.quantityConsumed = pla.quantityConsumed * @multiplier
        FROM PurchaseLotAllocations pla
        JOIN StockTransactions st ON pla.saleTransactionId = st.id
        WHERE st.ticker = @ticker AND st.transactionDate <= @splitDate
      `);

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  return splitId;
}
