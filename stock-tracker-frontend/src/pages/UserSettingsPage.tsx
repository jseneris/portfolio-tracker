import { FormEvent, useEffect, useState } from 'react'
import { getUserTargetSettings, updateUserTargetSettings } from '../api'

const DEFAULT_SALE_TARGET_PERCENT = 10
const DEFAULT_BUY_TARGET_PERCENT_UNDER_3_DISPLAY_LOTS = 5
const DEFAULT_BUY_TARGET_PERCENT_FOR_3_DISPLAY_LOTS = 10
const DEFAULT_BUY_TARGET_PERCENT_FOR_4_DISPLAY_LOTS = 15
const DEFAULT_BUY_TARGET_PERCENT_FOR_5_DISPLAY_LOTS = 20
const DEFAULT_BUY_TARGET_PERCENT_FOR_6_OR_MORE_DISPLAY_LOTS = 25

export default function UserSettingsPage() {
  const [saleTargetPercent, setSaleTargetPercent] = useState(String(DEFAULT_SALE_TARGET_PERCENT))
  const [buyTargetPercentUnder3DisplayLots, setBuyTargetPercentUnder3DisplayLots] = useState(String(DEFAULT_BUY_TARGET_PERCENT_UNDER_3_DISPLAY_LOTS))
  const [buyTargetPercentFor3DisplayLots, setBuyTargetPercentFor3DisplayLots] = useState(String(DEFAULT_BUY_TARGET_PERCENT_FOR_3_DISPLAY_LOTS))
  const [buyTargetPercentFor4DisplayLots, setBuyTargetPercentFor4DisplayLots] = useState(String(DEFAULT_BUY_TARGET_PERCENT_FOR_4_DISPLAY_LOTS))
  const [buyTargetPercentFor5DisplayLots, setBuyTargetPercentFor5DisplayLots] = useState(String(DEFAULT_BUY_TARGET_PERCENT_FOR_5_DISPLAY_LOTS))
  const [buyTargetPercentFor6OrMoreDisplayLots, setBuyTargetPercentFor6OrMoreDisplayLots] = useState(String(DEFAULT_BUY_TARGET_PERCENT_FOR_6_OR_MORE_DISPLAY_LOTS))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadSettings() {
      setLoading(true)
      setError(null)
      try {
        const settings = await getUserTargetSettings()
        if (!cancelled) {
          setSaleTargetPercent(String(settings.saleTargetPercent))
          setBuyTargetPercentUnder3DisplayLots(String(settings.buyTargetPercentUnder3DisplayLots))
          setBuyTargetPercentFor3DisplayLots(String(settings.buyTargetPercentFor3DisplayLots))
          setBuyTargetPercentFor4DisplayLots(String(settings.buyTargetPercentFor4DisplayLots))
          setBuyTargetPercentFor5DisplayLots(String(settings.buyTargetPercentFor5DisplayLots))
          setBuyTargetPercentFor6OrMoreDisplayLots(String(settings.buyTargetPercentFor6OrMoreDisplayLots))
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load user settings.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadSettings()

    return () => {
      cancelled = true
    }
  }, [])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const parsedPercent = Number(saleTargetPercent)
    if (!Number.isFinite(parsedPercent) || parsedPercent <= 0) {
      setError('Sale target percent must be greater than 0.')
      return
    }

    const parsedBuyTargetPercentUnder3DisplayLots = Number(buyTargetPercentUnder3DisplayLots)
    if (!Number.isFinite(parsedBuyTargetPercentUnder3DisplayLots) || parsedBuyTargetPercentUnder3DisplayLots <= 0) {
      setError('Buy target percent for less than 3 display lots must be greater than 0.')
      return
    }

    const parsedBuyTargetPercentFor3DisplayLots = Number(buyTargetPercentFor3DisplayLots)
    if (!Number.isFinite(parsedBuyTargetPercentFor3DisplayLots) || parsedBuyTargetPercentFor3DisplayLots <= 0) {
      setError('Buy target percent for 3 display lots must be greater than 0.')
      return
    }

    const parsedBuyTargetPercentFor4DisplayLots = Number(buyTargetPercentFor4DisplayLots)
    if (!Number.isFinite(parsedBuyTargetPercentFor4DisplayLots) || parsedBuyTargetPercentFor4DisplayLots <= 0) {
      setError('Buy target percent for 4 display lots must be greater than 0.')
      return
    }

    const parsedBuyTargetPercentFor5DisplayLots = Number(buyTargetPercentFor5DisplayLots)
    if (!Number.isFinite(parsedBuyTargetPercentFor5DisplayLots) || parsedBuyTargetPercentFor5DisplayLots <= 0) {
      setError('Buy target percent for 5 display lots must be greater than 0.')
      return
    }

    const parsedBuyTargetPercentFor6OrMoreDisplayLots = Number(buyTargetPercentFor6OrMoreDisplayLots)
    if (!Number.isFinite(parsedBuyTargetPercentFor6OrMoreDisplayLots) || parsedBuyTargetPercentFor6OrMoreDisplayLots <= 0) {
      setError('Buy target percent for 6 or more display lots must be greater than 0.')
      return
    }

    setSaving(true)
    try {
      const updated = await updateUserTargetSettings({
        saleTargetPercent: parsedPercent,
        buyTargetPercentUnder3DisplayLots: parsedBuyTargetPercentUnder3DisplayLots,
        buyTargetPercentFor3DisplayLots: parsedBuyTargetPercentFor3DisplayLots,
        buyTargetPercentFor4DisplayLots: parsedBuyTargetPercentFor4DisplayLots,
        buyTargetPercentFor5DisplayLots: parsedBuyTargetPercentFor5DisplayLots,
        buyTargetPercentFor6OrMoreDisplayLots: parsedBuyTargetPercentFor6OrMoreDisplayLots,
      })
      setSaleTargetPercent(String(updated.saleTargetPercent))
      setBuyTargetPercentUnder3DisplayLots(String(updated.buyTargetPercentUnder3DisplayLots))
      setBuyTargetPercentFor3DisplayLots(String(updated.buyTargetPercentFor3DisplayLots))
      setBuyTargetPercentFor4DisplayLots(String(updated.buyTargetPercentFor4DisplayLots))
      setBuyTargetPercentFor5DisplayLots(String(updated.buyTargetPercentFor5DisplayLots))
      setBuyTargetPercentFor6OrMoreDisplayLots(String(updated.buyTargetPercentFor6OrMoreDisplayLots))
      setSuccess('User settings saved.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save user settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="panel">
        <h2>User Settings</h2>
        <p>Configure how stock sale and buy target prices are calculated.</p>
      </div>

      {error ? <div className="panel status status-error">{error}</div> : null}
      {success ? <div className="panel status status-success">{success}</div> : null}

      <div className="panel">
        {loading ? (
          <p>Loading user settings...</p>
        ) : (
          <form className="form-grid" onSubmit={onSubmit}>
            <div className="target-settings-section">
              <h3>Sale Target</h3>
              <label>
                Sale Target Percent Above Last Buy/Sell Price
                <input
                  type="number"
                  min="0.0001"
                  step="0.01"
                  value={saleTargetPercent}
                  onChange={(event) => setSaleTargetPercent(event.target.value)}
                  disabled={saving}
                />
              </label>
            </div>

            <div className="target-settings-section target-settings-divider">
              <h3>Buy Targets</h3>
              <label>
                Buy Target Percent Below Last Buy/Sell Price (Display Lots Less Than 3)
                <input
                  type="number"
                  min="0.0001"
                  step="0.01"
                  value={buyTargetPercentUnder3DisplayLots}
                  onChange={(event) => setBuyTargetPercentUnder3DisplayLots(event.target.value)}
                  disabled={saving}
                />
              </label>

              <label>
                Buy Target Percent Below Last Buy/Sell Price (Display Lots = 3)
                <input
                  type="number"
                  min="0.0001"
                  step="0.01"
                  value={buyTargetPercentFor3DisplayLots}
                  onChange={(event) => setBuyTargetPercentFor3DisplayLots(event.target.value)}
                  disabled={saving}
                />
              </label>

              <label>
                Buy Target Percent Below Last Buy/Sell Price (Display Lots = 4)
                <input
                  type="number"
                  min="0.0001"
                  step="0.01"
                  value={buyTargetPercentFor4DisplayLots}
                  onChange={(event) => setBuyTargetPercentFor4DisplayLots(event.target.value)}
                  disabled={saving}
                />
              </label>

              <label>
                Buy Target Percent Below Last Buy/Sell Price (Display Lots = 5)
                <input
                  type="number"
                  min="0.0001"
                  step="0.01"
                  value={buyTargetPercentFor5DisplayLots}
                  onChange={(event) => setBuyTargetPercentFor5DisplayLots(event.target.value)}
                  disabled={saving}
                />
              </label>

              <label>
                Buy Target Percent Below Last Buy/Sell Price (Display Lots 6 Or More)
                <input
                  type="number"
                  min="0.0001"
                  step="0.01"
                  value={buyTargetPercentFor6OrMoreDisplayLots}
                  onChange={(event) => setBuyTargetPercentFor6OrMoreDisplayLots(event.target.value)}
                  disabled={saving}
                />
              </label>
            </div>

            <div className="form-actions">
              <button className="button button-primary" type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
