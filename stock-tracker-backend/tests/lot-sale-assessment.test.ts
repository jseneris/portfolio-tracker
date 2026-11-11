import { describe, expect, it } from 'vitest';
import { assessLotSales } from '../src/services/lot-sale-assessment.js';

const lot = {
  ticker: 'TEST', sourceType: 'purchase', acquisitionDate: '2025-01-01',
  quantity: 100, unitCost: 100, closePrice: 90, marketDate: '2026-11-09',
};
const today = '2026-11-10';

describe('independent full-lot proposed sale assessment', () => {
  it('estimates partial loss exposure from remaining purchases and fractional dividend shares', () => {
    const assessment = assessLotSales([
      lot,
      { ...lot, acquisitionDate: '2026-11-01', quantity: 20 },
      { ...lot, sourceType: 'dividend', acquisitionDate: '2026-11-05', quantity: 0.5 },
    ], today)[0];
    expect(assessment).toMatchObject({
      lotIndex: 0, saleDate: today, marketDate: '2026-11-09', estimatedLoss: 1000,
      priorWindowStartsOn: '2026-10-11', postSaleWindowEndsOn: '2026-12-10',
      status: 'prior_exposure', potentialAffectedShares: 20.5, potentialDeferredLoss: 205,
    });
    expect(assessment.replacementLots).toEqual([
      { lotIndex: 1, sourceType: 'purchase', acquisitionDate: '2026-11-01', quantity: 20 },
      { lotIndex: 2, sourceType: 'dividend', acquisitionDate: '2026-11-05', quantity: 0.5 },
    ]);
  });

  it.each([
    ['2026-10-10', 0], ['2026-10-11', 20], ['2026-11-10', 20], ['2026-11-11', 0],
  ])('uses inclusive calendar-day boundaries for acquisition %s', (acquisitionDate, expected) => {
    const assessment = assessLotSales([lot, { ...lot, acquisitionDate, quantity: 20 }], today)[0];
    expect(assessment.potentialAffectedShares).toBe(expected);
    expect(assessment.status).toBe(expected ? 'prior_exposure' : 'no_tracked_prior_exposure');
  });

  it('does not use shares in the entire sold lot as its own replacements', () => {
    const assessment = assessLotSales([{ ...lot, acquisitionDate: today }], today)[0];
    expect(assessment.status).toBe('no_tracked_prior_exposure');
    expect(assessment.potentialAffectedShares).toBe(0);
    expect(assessment.replacementLots).toEqual([]);
  });

  it('caps exposure at the sale quantity and keeps same-day identical lots separate', () => {
    const assessments = assessLotSales([
      { ...lot, acquisitionDate: today, quantity: 10 },
      { ...lot, acquisitionDate: today, quantity: 20 },
    ], today);
    expect(assessments.map((assessment) => assessment.potentialAffectedShares)).toEqual([10, 10]);
    expect(assessments[0].potentialDeferredLoss).toBe(100);
    expect(assessments[0].replacementLots[0].lotIndex).toBe(1);
    expect(assessments[1].replacementLots[0].lotIndex).toBe(0);
  });

  it('uses normalized remaining quantities and split-adjusted costs without changing input', () => {
    const lots = [lot, { ...lot, acquisitionDate: today, quantity: 2, unitCost: 50 }];
    const original = JSON.stringify(lots);
    const assessments = assessLotSales(lots, today);
    expect(assessments[0].potentialAffectedShares).toBe(2);
    expect(assessments[0].potentialDeferredLoss).toBe(20);
    expect(assessments[1].status).toBe('no_loss');
    expect(JSON.stringify(lots)).toBe(original);
  });

  it('does not treat other tickers or future open lots as prior replacements', () => {
    const assessments = assessLotSales([
      lot, { ...lot, ticker: 'OTHER', acquisitionDate: today },
      { ...lot, acquisitionDate: '2026-11-11' },
    ], today);
    expect(assessments).toHaveLength(2);
    expect(assessments[0].status).toBe('no_tracked_prior_exposure');
    expect(assessments[0].replacementLots).toEqual([]);
    expect(assessLotSales([lot, { ...lot, ticker: 'test', acquisitionDate: today }], today)[0].status)
      .toBe('prior_exposure');
  });

  it.each([90, 100, 110])('assesses gains and break-even prices without wash-sale loss exposure (cost %s)', (unitCost) => {
    const assessment = assessLotSales([{ ...lot, unitCost, closePrice: 110 }], today)[0];
    expect(assessment.status).toBe('no_loss');
    expect(assessment.estimatedLoss).toBe(0);
    expect(assessment.potentialAffectedShares).toBe(0);
    expect(assessment.potentialDeferredLoss).toBe(0);
  });

  it('keeps unpriced lots visible as unavailable, not cleared', () => {
    const assessment = assessLotSales([{ ...lot, closePrice: null, marketDate: null }], today)[0];
    expect(assessment.status).toBe('unavailable');
    expect(assessment.unavailableReason).toBe('No stored price.');
    expect(assessment.estimatedLoss).toBeNull();
    expect(assessment.potentialAffectedShares).toBeNull();
    expect(assessment.potentialDeferredLoss).toBeNull();
  });

  it('flags unsupported recent replacement acquisitions rather than claiming no exposure', () => {
    const assessment = assessLotSales([
      lot, { ...lot, acquisitionDate: today, sourceType: 'exchange' },
    ], today)[0];
    expect(assessment.status).toBe('unavailable');
    expect(assessment.unavailableReason).toContain('unsupported acquisition type');
    expect(assessment.potentialAffectedShares).toBeNull();
    expect(assessment.potentialDeferredLoss).toBeNull();
    expect(assessment.replacementLots[0].sourceType).toBe('exchange');
  });

  it('accepts a zero stored close as an estimated total loss', () => {
    expect(assessLotSales([{ ...lot, closePrice: 0 }], today)[0].estimatedLoss).toBe(10000);
  });

  it('handles year changes and leap days', () => {
    expect(assessLotSales([lot], '2026-12-15')[0].postSaleWindowEndsOn).toBe('2027-01-14');
    expect(assessLotSales([lot], '2028-03-01')[0].priorWindowStartsOn).toBe('2028-01-31');
  });

  it('rejects malformed dates and non-finite or invalid values explicitly', () => {
    expect(() => assessLotSales([lot], '2026-02-30')).toThrow('Invalid lot sale assessment date');
    expect(() => assessLotSales([{ ...lot, acquisitionDate: 'bad' }], today)).toThrow('Invalid lot sale assessment date');
    for (const invalid of [{ quantity: 0 }, { quantity: NaN }, { unitCost: -1 }, { closePrice: Infinity }, { closePrice: -1 }]) {
      expect(() => assessLotSales([{ ...lot, ...invalid }], today)).toThrow('Invalid lot sale assessment values');
    }
    expect(assessLotSales([], today)).toEqual([]);
  });
});
