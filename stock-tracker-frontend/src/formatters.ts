function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

const usd2Formatter = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const usd4Formatter = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})

export function formatCurrency2(value: number | null | undefined, fallback = '--') {
  if (!isFiniteNumber(value)) {
    return fallback
  }
  return usd2Formatter.format(value)
}

export function formatStockPrice4(value: number | null | undefined, fallback = '--') {
  if (!isFiniteNumber(value)) {
    return fallback
  }
  return usd4Formatter.format(value)
}
