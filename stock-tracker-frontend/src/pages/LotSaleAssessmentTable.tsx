import { Link } from 'react-router-dom'
import type { PortfolioReview } from '../api'
import { formatCurrency2, formatStockPrice4 } from '../formatters'
import { TickerInfoBadges } from '../tickerBadges'

type Assessments = PortfolioReview['snapshot']['lotSaleAssessments']

const statusLabels = {
  unavailable: 'Unable to assess',
  no_loss: 'No estimated loss',
  prior_exposure: 'Potential prior-window wash sale',
  no_tracked_prior_exposure: 'No tracked prior exposure',
}

export default function LotSaleAssessmentTable({ assessments }: { assessments?: Assessments }) {
  return <>
    <h4>Lot-specific sale assessment</h4>
    <p className="muted-text">Each row independently assumes selling that entire remaining lot today at its latest stored close,
      leaving every other lot unchanged. These are separate what-if scenarios, not a combined sale. Prices may be stale;
      actual execution prices, fees and tax-basis adjustments can change the loss. Lot numbers identify rows in this snapshot only.
      No transactions or tax bases are changed.</p>
    <p className="status status-warning">This is a U.S. wash-sale risk assessment, not tax clearance.
      Other remaining same-ticker purchase and dividend-reinvestment lots acquired in the preceding 30 calendar days
      (including the sale date) are potential replacements. Shares in the selected lot are excluded because they are all sold.
      Potential affected shares and deferred loss are upper-bound estimates: prior wash-sale matching is not tracked.
      Outside accounts, spouse purchases, IRA/Roth IRA purchases and substantially identical securities are not checked.
      Purchases or dividend reinvestments during the 30 days after a loss sale can still trigger a wash sale;
      IRA/Roth IRA replacements can permanently disallow the loss.</p>
    {assessments == null ? <p role="status">Lot-specific sale assessment is unavailable. Reload the review to update.</p>
      : !assessments.length ? <p>No open lots to assess.</p>
      : <div className="table-scroll"><table className="table">
        <thead><tr><th>Ticker / lot</th><th>Acquired / source</th><th>Shares to sell</th><th>Unit cost</th>
          <th>Stored close / price date</th><th>Assumed sale date</th><th>Estimated loss</th><th>Prior-window assessment</th>
          <th>Potential affected shares</th><th>Potential deferred loss</th><th>Other recent lots still held</th>
          <th>Post-sale window</th></tr></thead>
        <tbody>{assessments.map((assessment) => <tr key={assessment.lotIndex}>
          <td><Link className="link-button" to={`/stocks/${encodeURIComponent(assessment.ticker)}`}>{assessment.ticker}</Link>
            <TickerInfoBadges ticker={assessment.ticker} /> / lot {assessment.lotIndex + 1}</td>
          <td>{assessment.acquisitionDate} / {assessment.sourceType}</td>
          <td>{assessment.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
          <td>{formatStockPrice4(assessment.unitCost)}</td>
          <td>{formatStockPrice4(assessment.closePrice)} / {assessment.marketDate ?? 'Unknown'}</td>
          <td>{assessment.saleDate}</td>
          <td>{formatCurrency2(assessment.estimatedLoss)}</td>
          <td className={assessment.status === 'prior_exposure' ? 'value-negative' : undefined}>
            {statusLabels[assessment.status]}{assessment.unavailableReason ? `: ${assessment.unavailableReason}` : ''}
            <div className="muted-text">{assessment.priorWindowStartsOn} through {assessment.saleDate}</div>
          </td>
          <td>{assessment.potentialAffectedShares?.toLocaleString(undefined, { maximumFractionDigits: 8 }) ?? 'Unknown'}</td>
          <td>{formatCurrency2(assessment.potentialDeferredLoss)}</td>
          <td>{assessment.replacementLots.length ? assessment.replacementLots.map((lot) =>
            <div key={lot.lotIndex}>Lot {lot.lotIndex + 1}: {lot.acquisitionDate} / {lot.sourceType} / {lot.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })} shares</div>)
            : 'None tracked'}</td>
          <td>{assessment.status === 'no_loss' ? 'Not applicable at this price'
            : `Unresolved through ${assessment.postSaleWindowEndsOn} (inclusive)`}</td>
        </tr>)}</tbody>
      </table></div>}
  </>
}
