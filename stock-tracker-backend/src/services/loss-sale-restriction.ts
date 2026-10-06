import sql from 'mssql';

export async function restrictBuyingAfterLossSale(
  transaction: sql.Transaction, userId: string, saleTransactionId: string
): Promise<void> {
  await new sql.Request(transaction)
    .input('userId', sql.NVarChar, userId)
    .input('saleTransactionId', sql.UniqueIdentifier, saleTransactionId)
    .query(`
      MERGE UserTickerPreferences WITH (HOLDLOCK) AS target
      USING (
        SELECT st.userId, st.ticker,
          DATEADD(day, 31, CONVERT(date, st.transactionDate)) AS restrictionUntil
        FROM StockTransactions st
        WHERE st.id = @saleTransactionId AND st.userId = @userId AND st.type = 'sell'
          AND EXISTS (
            SELECT 1
            FROM PurchaseLotAllocations allocation
            INNER JOIN PurchaseLots lot ON lot.id = allocation.purchaseLotId AND lot.userId = @userId
            WHERE allocation.saleTransactionId = st.id AND allocation.userId = @userId
              AND allocation.quantityConsumed > 0 AND lot.unitCost > st.price
          )
      ) AS source
        ON target.userId = source.userId AND target.ticker = source.ticker
      WHEN MATCHED THEN
        UPDATE SET buyRestricted = 1,
          buyRestrictedUntil = CASE
            WHEN target.buyRestricted = 1 AND target.buyRestrictedUntil > source.restrictionUntil
              THEN target.buyRestrictedUntil
            ELSE source.restrictionUntil
          END,
          updatedAt = GETUTCDATE()
      WHEN NOT MATCHED THEN
        INSERT (id, userId, ticker, buyOnDip, buyOnDipPrice, buyRestricted, buyRestrictedUntil)
        VALUES (NEWID(), source.userId, source.ticker, 0, NULL, 1, source.restrictionUntil);
    `);
}
