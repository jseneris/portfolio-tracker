import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

export interface ICurrentPricePoint {
  ticker: string;
  price: number;
  changePercent: number | null;
  source: string;
  asOf: string;
}

export async function fetchCurrentPrices(tickers: string[]): Promise<{ prices: ICurrentPricePoint[]; missingTickers: string[] }> {
  const prices: ICurrentPricePoint[] = [];
  const missingTickers: string[] = [];

  for (const ticker of tickers) {
    try {
      const quote = await yahooFinance.quote(ticker) as any;
      const price = Number(
        quote?.regularMarketPrice
        ?? quote?.postMarketPrice
        ?? quote?.preMarketPrice
        ?? quote?.bid
        ?? quote?.ask
      );

      if (!Number.isFinite(price) || price <= 0) {
        missingTickers.push(ticker);
        continue;
      }

      const changePercent = Number(quote?.regularMarketChangePercent);

      prices.push({
        ticker,
        price,
        changePercent: Number.isFinite(changePercent) ? changePercent : null,
        source: 'yahoo-finance',
        asOf: new Date().toISOString(),
      });
    } catch {
      missingTickers.push(ticker);
    }
  }

  return { prices, missingTickers };
}
