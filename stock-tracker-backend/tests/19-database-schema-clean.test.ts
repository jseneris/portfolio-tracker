import { describe, it, expect, beforeAll } from 'vitest';
import { initializeDatabase, getPool } from '../src/db/connection.js';

function expectColumnsToMatch(actual: unknown[], expected: string[]) {
  const normalizedActual = actual.map((value) => String(value)).sort();
  const normalizedExpected = [...expected].sort();
  expect(normalizedActual).toEqual(normalizedExpected);
}

describe('19. Database Schema - Clean Install', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  it('creates the current clean-install schema with expected tables, indexes, and foreign keys', async () => {
    const pool = getPool();

    const tablesResult = await pool.request().query(`
      SELECT name
      FROM sys.tables
      WHERE name IN (
        'CashTransactions',
        'StockTransactions',
        'StockSplits',
        'PurchaseLots',
        'PurchaseLotAllocations',
        'SplitAdjustments',
        'DisplayLots',
        'UserSplitActivations',
        'DisplayLotComposition',
        'DisplayLotAllocations',
        'HistoricalPrices',
        'Users',
        'UserSettings'
      )
      ORDER BY name
    `);

    expectColumnsToMatch(tablesResult.recordset.map((row: any) => String(row.name)), [
      'CashTransactions',
      'DisplayLotAllocations',
      'DisplayLotComposition',
      'DisplayLots',
      'HistoricalPrices',
      'PurchaseLotAllocations',
      'PurchaseLots',
      'SplitAdjustments',
      'StockSplits',
      'StockTransactions',
      'UserSplitActivations',
      'UserSettings',
      'Users',
    ]);

    const displayLotsColumnsResult = await pool.request().query(`
      SELECT name
      FROM sys.columns
      WHERE object_id = OBJECT_ID('DisplayLots')
      ORDER BY column_id
    `);

    expectColumnsToMatch(displayLotsColumnsResult.recordset.map((row: any) => row.name), [
      'id',
      'userId',
      'ticker',
      'lotsCsv',
      'createdAt',
      'updatedAt',
    ]);

    const userSplitActivationsColumnsResult = await pool.request().query(`
      SELECT name
      FROM sys.columns
      WHERE object_id = OBJECT_ID('UserSplitActivations')
      ORDER BY column_id
    `);

    expectColumnsToMatch(userSplitActivationsColumnsResult.recordset.map((row: any) => row.name), [
      'id',
      'userId',
      'splitId',
      'activatedBy',
      'activationTransactionId',
      'createdAt',
    ]);

    const userSettingsColumnsResult = await pool.request().query(`
      SELECT name
      FROM sys.columns
      WHERE object_id = OBJECT_ID('UserSettings')
      ORDER BY column_id
    `);

    expectColumnsToMatch(userSettingsColumnsResult.recordset.map((row: any) => row.name), [
      'id',
      'userId',
      'saleTargetPercent',
      'buyTargetPercentUnder3DisplayLots',
      'buyTargetPercentFor3DisplayLots',
      'buyTargetPercentFor4DisplayLots',
      'buyTargetPercentFor5DisplayLots',
      'buyTargetPercentFor6OrMoreDisplayLots',
      'createdAt',
      'updatedAt',
    ]);

    const stockTransactionColumnsResult = await pool.request().query(`
      SELECT name
      FROM sys.columns
      WHERE object_id = OBJECT_ID('StockTransactions')
      ORDER BY column_id
    `);

    expectColumnsToMatch(stockTransactionColumnsResult.recordset.map((row: any) => row.name), [
      'id',
      'userId',
      'ticker',
      'type',
      'quantity',
      'price',
      'amount',
      'transactionDate',
      'splitAdjusted',
      'lastSplitId',
      'createdAt',
      'updatedAt',
    ]);

    const purchaseLotColumnsResult = await pool.request().query(`
      SELECT name
      FROM sys.columns
      WHERE object_id = OBJECT_ID('PurchaseLots')
      ORDER BY column_id
    `);

    expectColumnsToMatch(purchaseLotColumnsResult.recordset.map((row: any) => row.name), [
      'id',
      'userId',
      'ticker',
      'transactionId',
      'sourceType',
      'originalQuantity',
      'remainingQuantity',
      'unitCost',
      'purchaseDate',
      'splitAdjusted',
      'lastSplitId',
      'createdAt',
      'updatedAt',
    ]);

    const stockSplitColumnsResult = await pool.request().query(`
      SELECT name
      FROM sys.columns
      WHERE object_id = OBJECT_ID('StockSplits')
      ORDER BY column_id
    `);

    expectColumnsToMatch(stockSplitColumnsResult.recordset.map((row: any) => row.name), [
      'id',
      'ticker',
      'ratioNumerator',
      'ratioDenominator',
      'multiplier',
      'splitDate',
      'createdAt',
    ]);

    const splitIndexesResult = await pool.request().query(`
      SELECT name
      FROM sys.indexes
      WHERE object_id = OBJECT_ID('StockSplits')
        AND name IN ('IX_StockSplits_Ticker', 'UX_StockSplits_Ticker_Ratio_Date')
      ORDER BY name
    `);

    expect(splitIndexesResult.recordset.map((row: any) => String(row.name))).toEqual([
      'IX_StockSplits_Ticker',
      'UX_StockSplits_Ticker_Ratio_Date',
    ]);

    const stockTransactionSplitFkResult = await pool.request().query(`
      SELECT fk.name
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
      INNER JOIN sys.tables t ON fk.parent_object_id = t.object_id
      INNER JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = fkc.parent_column_id
      INNER JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id
      WHERE t.name = 'StockTransactions'
        AND rt.name = 'StockSplits'
        AND c.name = 'lastSplitId'
    `);

    expect(stockTransactionSplitFkResult.recordset).toHaveLength(1);

    const purchaseLotSplitFkResult = await pool.request().query(`
      SELECT fk.name
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
      INNER JOIN sys.tables t ON fk.parent_object_id = t.object_id
      INNER JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = fkc.parent_column_id
      INNER JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id
      WHERE t.name = 'PurchaseLots'
        AND rt.name = 'StockSplits'
        AND c.name = 'lastSplitId'
    `);

    expect(purchaseLotSplitFkResult.recordset).toHaveLength(1);

    const userSplitActivationIndexes = await pool.request().query(`
      SELECT name
      FROM sys.indexes
      WHERE object_id = OBJECT_ID('UserSplitActivations')
        AND name IN ('IX_UserSplitActivations_UserId', 'IX_UserSplitActivations_SplitId', 'UX_UserSplitActivations_UserId_SplitId')
      ORDER BY name
    `);

    expect(userSplitActivationIndexes.recordset.map((row: any) => String(row.name))).toEqual([
      'IX_UserSplitActivations_SplitId',
      'IX_UserSplitActivations_UserId',
      'UX_UserSplitActivations_UserId_SplitId',
    ]);
  });

  it('does not include legacy userId columns on global tables', async () => {
    const pool = getPool();

    const stockSplitsUserIdResult = await pool.request().query(`
      SELECT name
      FROM sys.columns
      WHERE object_id = OBJECT_ID('StockSplits')
        AND name = 'userId'
    `);

    const historicalPricesUserIdResult = await pool.request().query(`
      SELECT name
      FROM sys.columns
      WHERE object_id = OBJECT_ID('HistoricalPrices')
        AND name = 'userId'
    `);

    expect(stockSplitsUserIdResult.recordset).toHaveLength(0);
    expect(historicalPricesUserIdResult.recordset).toHaveLength(0);
  });
});
