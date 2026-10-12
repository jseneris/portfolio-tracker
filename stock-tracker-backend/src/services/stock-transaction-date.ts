import sql from 'mssql';
import { getPool } from '../db/connection.js';
import { restrictBuyingAfterLossSale } from './loss-sale-restriction.js';

export class TransactionDateError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function parseTransactionDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1
    && date.toISOString().slice(0, 10) === value ? date : null;
}

export async function changeStockTransactionDate(
  userId: string, id: string, date: Date, expectedDate: Date
): Promise<{ id: string; transactionDate: string }> {
  const tx = new sql.Transaction(getPool());
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const validation = await new sql.Request(tx)
      .input('userId', sql.NVarChar, userId)
      .input('id', sql.UniqueIdentifier, id)
      .input('date', sql.DateTime2, date)
      .input('expectedDate', sql.Date, expectedDate)
      .query<{ error: string | null; ticker: string; type: string; previousRestriction: Date | null }>(`
        DECLARE @ticker NVARCHAR(10), @type NVARCHAR(50), @oldDate DATETIME2;
        SELECT @ticker = ticker, @type = type, @oldDate = transactionDate
        FROM StockTransactions WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @id AND userId = @userId;
        DECLARE @error NVARCHAR(255) = NULL;
        IF @ticker IS NULL SET @error = 'not-found';
        ELSE IF CONVERT(date, @oldDate) <> @expectedDate
          SET @error = 'The transaction date changed. Refresh the page before editing.';
        ELSE IF @type NOT IN ('buy', 'sell', 'div')
          SET @error = 'Only buy, sell and dividend dates can be edited.';
        ELSE IF EXISTS (
          SELECT 1 FROM StockExchangeLotMappings WHERE userId = @userId
            AND (sourceTransactionId = @id OR targetTransactionId = @id)
        ) OR EXISTS (
          SELECT 1 FROM StockExchanges WHERE userId = @userId AND sourceTicker = @ticker
            AND (transactionDate >= @oldDate OR transactionDate >= @date)
        ) SET @error = 'Transactions linked to stock exchanges cannot have their dates edited.';
        ELSE IF EXISTS (
          SELECT 1 FROM StockSplits WHERE ticker = @ticker
            AND ((@oldDate <= splitDate AND @date > splitDate)
              OR (@oldDate > splitDate AND @date <= splitDate))
        ) SET @error = 'The date cannot move across a stock split. Split reconciliation is required.';
        ELSE IF @type IN ('buy', 'div') AND (
          (SELECT COUNT(*) FROM PurchaseLots WHERE userId = @userId AND transactionId = @id) <> 1
          OR EXISTS (SELECT 1 FROM PurchaseLots WHERE userId = @userId AND transactionId = @id
            AND CONVERT(date, purchaseDate) <> CONVERT(date, @oldDate))
        ) SET @error = 'The purchase lot is missing or its date is inconsistent. Reconcile the lot first.';
        ELSE IF @type IN ('buy', 'div') AND EXISTS (
          SELECT 1 FROM PurchaseLots lot
          JOIN PurchaseLotAllocations allocation ON allocation.purchaseLotId = lot.id AND allocation.userId = @userId
          JOIN StockTransactions sale ON sale.id = allocation.saleTransactionId AND sale.userId = @userId
          WHERE lot.transactionId = @id AND lot.userId = @userId
            AND CONVERT(date, sale.transactionDate) < CONVERT(date, @date)
        ) SET @error = 'The purchase date cannot be after a sale that consumed this lot.';
        ELSE IF @type = 'sell' AND EXISTS (
          SELECT 1 FROM PurchaseLotAllocations allocation
          JOIN PurchaseLots lot ON lot.id = allocation.purchaseLotId AND lot.userId = @userId
          WHERE allocation.saleTransactionId = @id AND allocation.userId = @userId
            AND CONVERT(date, lot.purchaseDate) > CONVERT(date, @date)
        ) SET @error = 'The sale date cannot be before an allocated purchase lot.';
        ELSE IF @type = 'sell' AND ABS(
          COALESCE((SELECT SUM(quantityConsumed) FROM PurchaseLotAllocations
            WHERE userId = @userId AND saleTransactionId = @id), 0)
          - (SELECT quantity FROM StockTransactions WHERE id = @id AND userId = @userId)
        ) > 0.000001 SET @error = 'The sale allocations are inconsistent. Reconcile them before editing the date.';
        DECLARE @previousRestriction DATE;
        SELECT @previousRestriction = MAX(DATEADD(day, 31, CONVERT(date, sale.transactionDate)))
        FROM StockTransactions sale
        WHERE sale.userId = @userId AND sale.ticker = @ticker AND sale.type = 'sell'
          AND EXISTS (
            SELECT 1 FROM PurchaseLotAllocations allocation
            JOIN PurchaseLots lot ON lot.id = allocation.purchaseLotId AND lot.userId = @userId
            WHERE allocation.saleTransactionId = sale.id AND allocation.userId = @userId
              AND allocation.quantityConsumed > 0 AND lot.unitCost > sale.price
          );
        SELECT @error AS error, @ticker AS ticker, @type AS type, @previousRestriction AS previousRestriction;
      `);
    const row = validation.recordset[0];
    if (row.error) {
      throw new TransactionDateError(row.error === 'not-found' ? 404 : 409,
        row.error === 'not-found' ? 'Stock transaction not found.' : row.error);
    }

    await new sql.Request(tx)
      .input('userId', sql.NVarChar, userId)
      .input('id', sql.UniqueIdentifier, id)
      .input('date', sql.DateTime2, date)
      .query(`
        UPDATE StockTransactions SET transactionDate = @date, updatedAt = GETUTCDATE()
        WHERE id = @id AND userId = @userId;
        UPDATE PurchaseLots SET purchaseDate = @date, updatedAt = GETUTCDATE()
        WHERE transactionId = @id AND userId = @userId;
      `);

    if (row.type === 'sell') {
      await new sql.Request(tx)
        .input('userId', sql.NVarChar, userId)
        .input('ticker', sql.NVarChar, row.ticker)
        .input('previousRestriction', sql.Date, row.previousRestriction)
        .query(`
          DECLARE @restriction DATE;
          SELECT @restriction = MAX(DATEADD(day, 31, CONVERT(date, sale.transactionDate)))
          FROM StockTransactions sale
          WHERE sale.userId = @userId AND sale.ticker = @ticker AND sale.type = 'sell'
            AND EXISTS (
              SELECT 1 FROM PurchaseLotAllocations allocation
              JOIN PurchaseLots lot ON lot.id = allocation.purchaseLotId AND lot.userId = @userId
              WHERE allocation.saleTransactionId = sale.id AND allocation.userId = @userId
                AND allocation.quantityConsumed > 0 AND lot.unitCost > sale.price
            );
          UPDATE UserTickerPreferences
          SET buyRestrictedUntil = @restriction,
              buyRestricted = CASE WHEN @restriction IS NULL THEN 0 ELSE 1 END,
              updatedAt = GETUTCDATE()
          WHERE userId = @userId AND ticker = @ticker AND buyRestricted = 1
            AND buyRestrictedUntil = @previousRestriction;
        `);
      await restrictBuyingAfterLossSale(tx, userId, id);
    }
    await tx.commit();
    return { id, transactionDate: date.toISOString() };
  } catch (error) {
    try {
      await tx.rollback();
    } catch (rollbackError) {
      console.error('Unable to roll back stock transaction date change:', rollbackError);
    }
    throw error;
  }
}
