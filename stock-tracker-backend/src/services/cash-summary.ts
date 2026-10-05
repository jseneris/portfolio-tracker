import sql from 'mssql';
import { getPool } from '../db/connection.js';

export async function getCashSummary(userId: string) {
  const cashResult = await getPool().request()
    .input('userId', sql.NVarChar, userId)
    .query(`
      SELECT
        SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END) as deposits,
        SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END) as withdrawals,
        SUM(CASE WHEN type = 'interest' THEN amount ELSE 0 END) as interest,
        SUM(CASE WHEN type = 'fee' THEN amount ELSE 0 END) as fees
      FROM CashTransactions
      WHERE userId = @userId
    `);
  const stockResult = await getPool().request()
    .input('userId', sql.NVarChar, userId)
    .query(`
      WITH ExchangeGeneratedBuys AS (
        SELECT DISTINCT targetTransactionId
        FROM StockExchangeLotMappings
        WHERE userId = @userId
      )
      SELECT
        SUM(CASE WHEN st.type = 'buy' AND e.targetTransactionId IS NULL THEN st.amount ELSE 0 END) as buys,
        SUM(CASE WHEN st.type = 'sell' THEN st.amount ELSE 0 END) as sells
      FROM StockTransactions st
      LEFT JOIN ExchangeGeneratedBuys e ON e.targetTransactionId = st.id
      WHERE st.userId = @userId
    `);
  const cashRow = cashResult.recordset[0] || {};
  const stockRow = stockResult.recordset[0] || {};
  const deposits = Number(cashRow.deposits || 0);
  const withdrawals = Number(cashRow.withdrawals || 0);
  const interest = Number(cashRow.interest || 0);
  const fees = Number(cashRow.fees || 0);
  const buys = Number(stockRow.buys || 0);
  const sells = Number(stockRow.sells || 0);
  const summary = {
    deposits, withdrawals, interest, fees, buys, sells,
    availableCash: deposits - withdrawals + interest - fees - buys + sells,
    costBasis: deposits - withdrawals,
    adjustments: interest - fees,
  };
  if (Object.values(summary).some((value) => !Number.isFinite(value))) {
    throw new Error('Invalid cash summary values.');
  }
  return summary;
}
