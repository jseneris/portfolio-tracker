import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeDatabase } from '../src/db/connection.js';
import { clearUserData, depositCash, getCashBalance, TEST_USER_ID, TOLERANCE } from './setup.js';
import { getPool } from '../src/db/connection.js';
import sql from 'mssql';

describe('01. Foundation - Cash Management Workflow', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    await clearUserData();
  });

  it('deposits and withdrawals affect cash balance correctly', async () => {
    const balance1 = await getCashBalance();
    expect(Math.abs(balance1 - 0)).toBeLessThan(TOLERANCE);

    await depositCash(1000);
    const balance2 = await getCashBalance();
    expect(Math.abs(balance2 - 1000)).toBeLessThan(TOLERANCE);

    await depositCash(500);
    const balance3 = await getCashBalance();
    expect(Math.abs(balance3 - 1500)).toBeLessThan(TOLERANCE);
  });

  it('calculates available cash after deposits, withdrawals, and transactions', async () => {
    await depositCash(5000);
    let balance = await getCashBalance();
    expect(Math.abs(balance - 5000)).toBeLessThan(TOLERANCE);

    // Withdrawal
    const pool = getPool();
    await pool.request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('type', sql.NVarChar, 'withdrawal')
      .input('amount', sql.Decimal(18, 4), 1000)
      .input('transactionDate', sql.DateTime2, new Date())
      .query(`
        INSERT INTO CashTransactions (userId, type, amount, transactionDate)
        VALUES (@userId, @type, @amount, @transactionDate)
      `);

    balance = await getCashBalance();
    expect(Math.abs(balance - 4000)).toBeLessThan(TOLERANCE);
  });

  it('handles interest and fee calculations', async () => {
    await depositCash(2000);
    const pool = getPool();

    // Add interest
    await pool.request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('type', sql.NVarChar, 'interest')
      .input('amount', sql.Decimal(18, 4), 25)
      .input('transactionDate', sql.DateTime2, new Date())
      .query(`
        INSERT INTO CashTransactions (userId, type, amount, transactionDate)
        VALUES (@userId, @type, @amount, @transactionDate)
      `);

    let balance = await getCashBalance();
    expect(Math.abs(balance - 2025)).toBeLessThan(TOLERANCE);

    // Deduct fee
    await pool.request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('type', sql.NVarChar, 'fee')
      .input('amount', sql.Decimal(18, 4), 5)
      .input('transactionDate', sql.DateTime2, new Date())
      .query(`
        INSERT INTO CashTransactions (userId, type, amount, transactionDate)
        VALUES (@userId, @type, @amount, @transactionDate)
      `);

    balance = await getCashBalance();
    expect(Math.abs(balance - 2020)).toBeLessThan(TOLERANCE);
  });

  it('reduces cash correctly when buying stock', async () => {
    await depositCash(10000);
    const pool = getPool();

    // Buy 10 shares at $100 = $1000
    await pool.request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, 'AAPL')
      .input('type', sql.NVarChar, 'buy')
      .input('quantity', sql.Decimal(18, 8), 10)
      .input('price', sql.Decimal(18, 8), 100)
      .input('amount', sql.Decimal(18, 4), 1000)
      .input('transactionDate', sql.DateTime2, new Date())
      .query(`
        INSERT INTO StockTransactions (userId, ticker, type, quantity, price, amount, transactionDate)
        VALUES (@userId, @ticker, @type, @quantity, @price, @amount, @transactionDate)
      `);

    const balance = await getCashBalance();
    expect(Math.abs(balance - 9000)).toBeLessThan(TOLERANCE);
  });

  it('increases cash correctly when selling stock', async () => {
    await depositCash(5000);
    const pool = getPool();

    // Buy 10 shares at $100
    await pool.request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, 'AAPL')
      .input('type', sql.NVarChar, 'buy')
      .input('quantity', sql.Decimal(18, 8), 10)
      .input('price', sql.Decimal(18, 8), 100)
      .input('amount', sql.Decimal(18, 4), 1000)
      .input('transactionDate', sql.DateTime2, new Date())
      .query(`
        INSERT INTO StockTransactions (userId, ticker, type, quantity, price, amount, transactionDate)
        VALUES (@userId, @ticker, @type, @quantity, @price, @amount, @transactionDate)
      `);

    // Sell 5 shares at $120
    await pool.request()
      .input('userId', sql.NVarChar, TEST_USER_ID)
      .input('ticker', sql.NVarChar, 'AAPL')
      .input('type', sql.NVarChar, 'sell')
      .input('quantity', sql.Decimal(18, 8), 5)
      .input('price', sql.Decimal(18, 8), 120)
      .input('amount', sql.Decimal(18, 4), 600)
      .input('transactionDate', sql.DateTime2, new Date())
      .query(`
        INSERT INTO StockTransactions (userId, ticker, type, quantity, price, amount, transactionDate)
        VALUES (@userId, @ticker, @type, @quantity, @price, @amount, @transactionDate)
      `);

    const balance = await getCashBalance();
    expect(Math.abs(balance - 4600)).toBeLessThan(TOLERANCE); // 5000 - 1000 + 600
  });
});
