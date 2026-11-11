type SaleLot = {
  ticker: string;
  sourceType: string;
  acquisitionDate: string;
  quantity: number;
  unitCost: number;
  closePrice: number | null;
  marketDate: string | null;
};

function dayNumber(date: string) {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) {
    throw new Error('Invalid lot sale assessment date.');
  }
  return time / 86400000;
}

export function assessLotSales(openLots: SaleLot[], saleDate: string) {
  const saleDay = dayNumber(saleDate);
  const priorWindowStartsOn = new Date((saleDay - 30) * 86400000).toISOString().slice(0, 10);
  const postSaleWindowEndsOn = new Date((saleDay + 30) * 86400000).toISOString().slice(0, 10);
  const lots = openLots.map((lot, lotIndex) => {
    if (!Number.isFinite(lot.quantity) || lot.quantity <= 0
      || !Number.isFinite(lot.unitCost) || lot.unitCost < 0
      || (lot.closePrice != null && (!Number.isFinite(lot.closePrice) || lot.closePrice < 0))) {
      throw new Error('Invalid lot sale assessment values.');
    }
    return { ...lot, lotIndex, acquisitionDay: dayNumber(lot.acquisitionDate) };
  });
  return lots.filter((lot) => lot.acquisitionDay <= saleDay).map((lot) => {
    // The entire selected lot is sold; only other shares still held can replace it.
    const candidates = lots.filter((other) => other.lotIndex !== lot.lotIndex
      && other.ticker.toUpperCase() === lot.ticker.toUpperCase()
      && other.acquisitionDay >= saleDay - 30 && other.acquisitionDay <= saleDay)
      .sort((a, b) => a.acquisitionDay - b.acquisitionDay || a.lotIndex - b.lotIndex);
    const replacementLots = candidates.filter((other) =>
      other.sourceType === 'purchase' || other.sourceType === 'dividend');
    const unknownReplacementLots = candidates.filter((other) =>
      other.sourceType !== 'purchase' && other.sourceType !== 'dividend');
    const estimatedLoss = lot.closePrice == null ? null
      : Math.max(0, lot.quantity * (lot.unitCost - lot.closePrice));
    const potentialAffectedShares = estimatedLoss == null || (estimatedLoss > 0 && unknownReplacementLots.length > 0)
      ? null : estimatedLoss === 0 ? 0
      : Math.min(lot.quantity, replacementLots.reduce((sum, other) => sum + other.quantity, 0));
    const status = estimatedLoss == null ? 'unavailable'
      : estimatedLoss === 0 ? 'no_loss'
      : unknownReplacementLots.length ? 'unavailable'
      : (potentialAffectedShares ?? 0) > 0 ? 'prior_exposure' : 'no_tracked_prior_exposure';
    return {
      lotIndex: lot.lotIndex, ticker: lot.ticker, sourceType: lot.sourceType,
      acquisitionDate: lot.acquisitionDate, quantity: lot.quantity, unitCost: lot.unitCost,
      saleDate, closePrice: lot.closePrice, marketDate: lot.marketDate, estimatedLoss,
      priorWindowStartsOn, postSaleWindowEndsOn, status,
      unavailableReason: estimatedLoss == null ? 'No stored price.'
        : status === 'unavailable' ? 'A recent same-ticker lot has an unsupported acquisition type.' : null,
      potentialAffectedShares,
      potentialDeferredLoss: potentialAffectedShares == null || lot.closePrice == null ? null
        : potentialAffectedShares * Math.max(0, lot.unitCost - lot.closePrice),
      replacementLots: candidates.map((other) => ({
        lotIndex: other.lotIndex, acquisitionDate: other.acquisitionDate,
        sourceType: other.sourceType, quantity: other.quantity,
      })),
    };
  });
}

export type LotSaleAssessment = ReturnType<typeof assessLotSales>[number];
