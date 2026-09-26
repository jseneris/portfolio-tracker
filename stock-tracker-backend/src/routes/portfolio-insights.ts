import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { getPool } from '../db/connection.js';
import { generateCopilotInsights } from '../services/copilot-insights.js';

const router = Router();
const REQUEST_COOLDOWN_MS = 60_000;
const lastRequestByUser = new Map<string, number>();

type LotRow = {
  ticker: string;
  sourceType: string;
  purchaseDate: string;
  remainingQuantity: number | string;
  unitCost: number | string;
  closePrice: number | string | null;
  marketDate: string | null;
  recentAcquisitionCount: number | string;
};

type InspectionFact = {
  id: string;
  type: 'concentration' | 'unrealized_loss_lot' | 'missing_price';
  ticker: string;
  marketValue?: number;
  percentOfEquities?: number;
  quantity?: number;
  costBasis?: number;
  estimatedValue?: number;
  unrealizedLoss?: number;
  acquisitionDate?: string;
  daysHeld?: number;
  marketDate?: string | null;
  recentAcquisitionCount?: number;
};

type ModelExplanation = {
  factId: string;
  explanation: string;
};

function dateOnly(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function buildPortfolioInsightsFacts(rows: LotRow[], now: Date = new Date()): InspectionFact[] {
  const holdings = new Map<string, {
    marketValue: number;
    quantity: number;
    marketDate: string | null;
  }>();
  const lossLots: Array<InspectionFact & { unrealizedLoss: number }> = [];
  const missingTickers = new Set<string>();

  for (const row of rows) {
    const ticker = row.ticker.toUpperCase();
    const quantity = Number(row.remainingQuantity);
    const unitCost = Number(row.unitCost);
    const closePrice = row.closePrice == null ? null : Number(row.closePrice);
    const holding = holdings.get(ticker) || { marketValue: 0, quantity: 0, marketDate: row.marketDate };

    holding.quantity += quantity;
    if (closePrice == null || !Number.isFinite(closePrice)) {
      missingTickers.add(ticker);
    } else {
      holding.marketValue += quantity * closePrice;
      if (!holding.marketDate || (row.marketDate && row.marketDate > holding.marketDate)) {
        holding.marketDate = row.marketDate;
      }

      const unrealizedLoss = quantity * Math.max(0, unitCost - closePrice);
      if (unrealizedLoss > 0.01) {
        const purchaseDate = dateOnly(row.purchaseDate);
        const daysHeld = Math.max(0, Math.floor((now.getTime() - new Date(`${purchaseDate}T00:00:00Z`).getTime()) / 86_400_000));
        lossLots.push({
          id: '',
          type: 'unrealized_loss_lot',
          ticker,
          quantity,
          costBasis: quantity * unitCost,
          estimatedValue: quantity * closePrice,
          unrealizedLoss,
          acquisitionDate: purchaseDate,
          daysHeld,
          marketDate: row.marketDate,
          recentAcquisitionCount: Number(row.recentAcquisitionCount),
        });
      }
    }
    holdings.set(ticker, holding);
  }

  const pricedEquityValue = Array.from(holdings.values()).reduce((total, holding) => total + holding.marketValue, 0);
  const facts: InspectionFact[] = [];

  for (const [ticker, holding] of holdings) {
    const percentOfEquities = pricedEquityValue > 0 ? (holding.marketValue / pricedEquityValue) * 100 : 0;
    if (percentOfEquities >= 20) {
      facts.push({
        id: `concentration-${ticker}`,
        type: 'concentration',
        ticker,
        marketValue: holding.marketValue,
        percentOfEquities,
      });
    }
  }

  lossLots.sort((first, second) => second.unrealizedLoss - first.unrealizedLoss);
  lossLots.slice(0, 8).forEach((fact, index) => {
    fact.id = `loss-lot-${index + 1}`;
    facts.push(fact);
  });

  for (const ticker of Array.from(missingTickers).sort()) {
    facts.push({ id: `missing-price-${ticker}`, type: 'missing_price', ticker });
  }

  return facts;
}

function parseExplanations(value: unknown, allowedFactIds: Set<string>): ModelExplanation[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid model response');
  }

  const seen = new Set<string>();
  return value.flatMap((item): ModelExplanation[] => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.factId !== 'string' ||
      !allowedFactIds.has(candidate.factId) ||
      seen.has(candidate.factId) ||
      typeof candidate.explanation !== 'string'
    ) return [];

    const explanation = candidate.explanation.trim();
    if (!explanation || explanation.length > 600) return [];
    seen.add(candidate.factId);
    return [{ factId: candidate.factId, explanation }];
  });
}

async function getModelExplanations(facts: InspectionFact[]): Promise<ModelExplanation[]> {
  const content = await generateCopilotInsights(
    `Explain these portfolio facts for an educational portfolio review. Return one concise explanation per relevant fact using only supplied facts. Do not calculate, invent, or infer missing values. Do not recommend a specific trade or claim a tax outcome. For unrealized-loss lots, describe them only as items to review with a qualified tax professional; tracked-account history cannot establish wash-sale status. Keep the tone neutral and acknowledge uncertainty.\n\nFacts:\n${JSON.stringify(facts)}`
  );
  const parsed = JSON.parse(content) as { explanations?: unknown };
  return parseExplanations(parsed.explanations, new Set(facts.map((fact) => fact.id)));
}

router.post('/', async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const accessResult = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query('SELECT aiInsightsEnabled FROM Users WHERE id = @userId');

    if (!accessResult.recordset[0]?.aiInsightsEnabled) {
      return res.status(403).json({ error: 'Portfolio insights are not enabled for this user.' });
    }

    const now = Date.now();
    const lastRequest = lastRequestByUser.get(userId) || 0;
    if (now - lastRequest < REQUEST_COOLDOWN_MS) {
      return res.status(429).json({ error: 'Please wait one minute before generating another portfolio review.' });
    }
    lastRequestByUser.set(userId, now);

    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT
          pl.ticker,
          pl.sourceType,
          pl.purchaseDate,
          pl.remainingQuantity,
          pl.unitCost,
          price.closePrice,
          CONVERT(varchar(10), price.marketDate, 23) AS marketDate,
          recent.recentAcquisitionCount
        FROM PurchaseLots pl
        OUTER APPLY (
          SELECT TOP 1 hp.closePrice, hp.marketDate
          FROM HistoricalPrices hp
          WHERE hp.ticker = pl.ticker
          ORDER BY hp.marketDate DESC
        ) price
        OUTER APPLY (
          SELECT COUNT(*) AS recentAcquisitionCount
          FROM PurchaseLots recent
          WHERE recent.userId = pl.userId
            AND recent.ticker = pl.ticker
            AND recent.purchaseDate >= DATEADD(day, -30, SYSUTCDATETIME())
        ) recent
        WHERE pl.userId = @userId AND pl.remainingQuantity > 0
        ORDER BY pl.ticker, pl.purchaseDate
      `);

    const facts = buildPortfolioInsightsFacts(result.recordset as LotRow[], new Date());
    const explanations = facts.length > 0 ? await getModelExplanations(facts) : [];
    res.json({
      generatedAt: new Date().toISOString(),
      facts,
      explanations,
      limitations: [
        'Market values use the latest stored closing price and may be stale.',
        'Tax figures are estimates based on tracked open lots, not tax calculations or trade instructions.',
        'Recent-acquisition checks cover only this tracker and cannot determine wash-sale status; outside accounts and future purchases are not represented.',
        'Portfolio facts are sent to the configured AI provider without account identifiers. Review that provider\'s data-handling terms before enabling this feature.',
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate portfolio insights.';
    console.error('Copilot portfolio inspection failed:', message);
    res.status(502).json({ error: 'Unable to generate portfolio insights. Ensure the local Copilot CLI is signed in and try again.' });
  }
});

export default router;