import { formatCurrency2 } from '../formatters'
import { checkInsufficientSharesForSmallestLot } from '../targetPrices'

export function InsufficientSharesBanner({ ticker, buyPrice, basePurchaseSize, smallestDisplayLotShares, isOverride }: {
  ticker: string
  buyPrice: number | null
  basePurchaseSize: number
  smallestDisplayLotShares: number | null
  isOverride: boolean
}) {
  if (!checkInsufficientSharesForSmallestLot(basePurchaseSize, buyPrice, smallestDisplayLotShares)
    || buyPrice == null || smallestDisplayLotShares == null) return null

  const shares = basePurchaseSize / buyPrice
  return (
    <details className="panel insufficient-shares-notice">
      <summary><strong>Insufficient shares for next display lot</strong></summary>
      <p>
        At the {isOverride ? 'override' : 'buy target'} price of ${buyPrice.toFixed(8)},
        {' '}a {formatCurrency2(basePurchaseSize)} purchase of {ticker.toUpperCase()} buys
        {' '}<strong>{shares.toFixed(6)} shares</strong>, not more than the smallest display lot
        {' '}(<strong>{smallestDisplayLotShares.toFixed(6)} shares</strong>).
      </p>
    </details>
  )
}
