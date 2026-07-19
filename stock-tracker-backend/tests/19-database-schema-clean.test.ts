import { describe, it, expect, beforeAll } from 'vitest';
import { initializeDatabase, getPool } from '../src/db/connection.js';

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
        'DisplayLotComposition',
        'DisplayLotAllocations',
        'HistoricalPrices',
        'UserSettings'
      )
      ORDER BY name
    `);

    expect(tablesResult.recordset.map((row: any) => String(row.name))).toEqual([
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
      'UserSettings',
    ]);

    const userSettingsColumnsResult = await pool.request().query(`
      SELECT name
      FROM sys.columns
      WHERE object_id = OBJECT_ID('UserSettings')
      ORDER BY column_id
    `);

    expect(userSettingsColumnsResult.recordset.map((row: any) => String(row.name))).toEqual([
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

    expect(stockTransactionColumnsResult.recordset.map((row: any) => String(row.name))).toEqual([
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

    expect(purchaseLotColumnsResult.recordset.map((row: any) => String(row.name))).toEqual([
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

    expect(stockSplitColumnsResult.recordset.map((row: any) => String(row.name))).toEqual([
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

    const foreignKeysResult = await pool.request().query(`
      SELECT name
      FROM sys.foreign_keys
      WHERE name = 'FK_StockTransactions_LastSplit'
    `);

    expect(foreignKeysResult.recordset.map((row: any) => String(row.name))).toEqual([
      'FK_StockTransactions_LastSplit',
    ]);

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
