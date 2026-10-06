import sql from 'mssql';
import { getPool } from '../db/connection.js';

export const SEEDED_AI_ASSUMPTIONS = {
  investmentHorizonYears: 10,
  riskTolerance: 'Comfortable with volatility, but avoid excessive single-stock concentration.',
  riskAssessmentScope: 'Tracked stock portfolio only; do not assess outside holdings or holistic finances.',
  lossReview: {
    requireNegativeYearlyGainLoss: true,
    minimumDisplayLots: 4,
    performanceBasis: 'App holding Yearly Gain/Loss, not stock price change.',
    unrealizedLossAssumption: 'Negative YTD performance is a user assumption of loss lots, not proof. Verify actual open-lot unrealized losses.',
    timing: 'Summarize by ticker, not individual lots. Show remaining days until the prior 30-day window clears after the latest tracked buy or dividend reinvestment; 0 means no remaining wait from those tracked transactions, not confirmed wash-sale eligibility.',
    dividends: 'Show days until the next declared dividend when a verified future date is supplied. Otherwise show days since the last tracked dividend; if none exists, say no tracked dividend. Do not extrapolate future dates.',
  },
};

export async function loadAiPreferences(userId: string) {
  const result = await getPool().request().input('userId', sql.NVarChar, userId)
    .query('SELECT aiAssumptionsEnabled FROM Users WHERE id = @userId');
  return result.recordset[0]?.aiAssumptionsEnabled ? SEEDED_AI_ASSUMPTIONS : null;
}
