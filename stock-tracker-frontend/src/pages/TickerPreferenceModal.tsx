import { FormEvent, useEffect, useState } from 'react'
import { TickerPreference, UpdateTickerPreferenceInput, updateTickerPreference } from '../api'
import { formatStockPrice4 } from '../formatters'

export interface TickerPreferenceModalProps {
  ticker: string
  preference: TickerPreference | null
  basePurchaseSize: number
  currentPrice: number | null
  onClose: () => void
  onSuccess: (preference: TickerPreference) => void
}

export function TickerPreferenceModal({
  ticker,
  preference,
  basePurchaseSize,
  currentPrice,
  onClose,
  onSuccess,
}: TickerPreferenceModalProps) {
  const [baseSize, setBaseSize] = useState<string>('3')
  const [buyOnDip, setBuyOnDip] = useState(false)
  const [buyOnDipPrice, setBuyOnDipPrice] = useState<string>('')
  const [buyRestricted, setBuyRestricted] = useState(false)
  const [buyRestrictedUntil, setBuyRestrictedUntil] = useState<string>('')
  const [targetBuyPriceOverride, setTargetBuyPriceOverride] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (preference) {
      setBaseSize(String(preference.baseSize ?? 3))
      setBuyOnDip(preference.buyOnDip ?? false)
      setBuyOnDipPrice(preference.buyOnDipPrice != null ? String(preference.buyOnDipPrice) : '')
      setBuyRestricted(preference.buyRestricted ?? false)
      setBuyRestrictedUntil(preference.buyRestrictedUntil ?? '')
      setTargetBuyPriceOverride(preference.targetBuyPriceOverride != null ? String(preference.targetBuyPriceOverride) : '')
      setNote(preference.note ?? '')
    } else {
      setBaseSize('3')
      setBuyOnDip(false)
      setBuyOnDipPrice('')
      setBuyRestricted(false)
      setBuyRestrictedUntil('')
      setTargetBuyPriceOverride('')
      setNote('')
    }
    setError(null)
  }, [preference])

  const suggestedOverridePrice = calculateSuggestedOverridePrice(basePurchaseSize, currentPrice)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const parsedBaseSize = Number(baseSize)
    if (!Number.isSafeInteger(parsedBaseSize) || parsedBaseSize < 0) {
      setError('Base size must be a non-negative integer.')
      return
    }

    if (buyOnDipPrice && Number(buyOnDipPrice) <= 0) {
      setError('Buy on Dip price must be positive.')
      return
    }

    if (buyRestrictedUntil && !/^\d{4}-\d{2}-\d{2}$/.test(buyRestrictedUntil)) {
      setError('Buy restricted until date must be in YYYY-MM-DD format.')
      return
    }

    if (targetBuyPriceOverride && Number(targetBuyPriceOverride) <= 0) {
      setError('Target Buy Price Override must be positive.')
      return
    }

    setSaving(true)
    try {
      const payload: UpdateTickerPreferenceInput = {
        baseSize: parsedBaseSize || undefined,
        buyOnDip,
        buyOnDipPrice: buyOnDipPrice ? Number(buyOnDipPrice) : undefined,
        buyRestricted,
        buyRestrictedUntil: buyRestricted ? buyRestrictedUntil : null,
        note: note || undefined,
        targetBuyPriceOverride: targetBuyPriceOverride ? Number(targetBuyPriceOverride) : undefined,
      }
      const result = await updateTickerPreference(ticker, payload)
      onSuccess(result)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save preference.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="ticker-pref-title">
      <div className="modal-card">
        <h3 id="ticker-pref-title">Settings for {ticker.toUpperCase()}</h3>

        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Base Size (display lots)
            <input
              type="number"
              min="0"
              step="1"
              value={baseSize}
              onChange={(e) => setBaseSize(e.target.value)}
              disabled={saving}
            />
          </label>

          <label>
            <input
              type="checkbox"
              checked={buyOnDip}
              onChange={(e) => setBuyOnDip(e.target.checked)}
              disabled={saving}
            />
            Buy on Dip Enabled
          </label>

          {buyOnDip && (
            <label>
              Buy on Dip Price
              <input
                type="number"
                min="0.00000001"
                step="0.00000001"
                placeholder="Optional"
                value={buyOnDipPrice}
                onChange={(e) => setBuyOnDipPrice(e.target.value)}
                disabled={saving}
              />
            </label>
          )}

          <label>
            <input
              type="checkbox"
              checked={buyRestricted}
              onChange={(e) => setBuyRestricted(e.target.checked)}
              disabled={saving}
            />
            Buy Restricted
          </label>

          {buyRestricted && (
            <label>
              Buy Restricted Until (YYYY-MM-DD)
              <input
                type="date"
                value={buyRestrictedUntil}
                onChange={(e) => setBuyRestrictedUntil(e.target.value)}
                disabled={saving}
              />
            </label>
          )}

          <label>
            Target Buy Price Override
            <input
              type="number"
              min="0.00000001"
              step="0.00000001"
              placeholder="Optional"
              value={targetBuyPriceOverride}
              onChange={(e) => setTargetBuyPriceOverride(e.target.value)}
              disabled={saving}
            />
            {suggestedOverridePrice != null && (
              <small style={{ marginTop: '0.25rem', display: 'block' }}>
                Suggested: {formatStockPrice4(suggestedOverridePrice)} (would buy more shares than smallest display lot)
                {' '}
                <button
                  type="button"
                  onClick={() => setTargetBuyPriceOverride(String(suggestedOverridePrice))}
                  disabled={saving}
                  style={{ fontSize: 'inherit', padding: '0.125rem 0.5rem' }}
                >
                  Use
                </button>
              </small>
            )}
          </label>

          <label>
            Note
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note for this ticker..."
              disabled={saving}
              style={{ minHeight: '80px' }}
            />
          </label>

          <div className="form-actions">
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button className="button" type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>

        {error && <div className="status status-error">{error}</div>}
      </div>
    </div>
  )
}

function calculateSuggestedOverridePrice(basePurchaseSize: number, currentPrice: number | null): number | null {
  if (!Number.isFinite(basePurchaseSize) || basePurchaseSize <= 0 || !Number.isFinite(currentPrice) || !currentPrice || currentPrice <= 0) {
    return null
  }
  return basePurchaseSize + currentPrice * 0.01
}
