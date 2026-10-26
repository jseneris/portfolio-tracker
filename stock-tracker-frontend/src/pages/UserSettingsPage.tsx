import { FormEvent, useEffect, useState } from 'react'
import {
  deletePushSubscription,
  getPushNotificationConfig,
  getUnreadMessageCount,
  getUserTargetSettings,
  savePushSubscription,
  updateUserTargetSettings,
  type PushSubscriptionPayload,
} from '../api'
import { updateAppBadge } from '../appBadge'

const DEFAULT_SALE_TARGET_PERCENT = 10
const DEFAULT_BUY_TARGET_PERCENT_UNDER_3_DISPLAY_LOTS = 5
const DEFAULT_BUY_TARGET_PERCENT_FOR_3_DISPLAY_LOTS = 10
const DEFAULT_BUY_TARGET_PERCENT_FOR_4_DISPLAY_LOTS = 15
const DEFAULT_BUY_TARGET_PERCENT_FOR_5_DISPLAY_LOTS = 20
const DEFAULT_BUY_TARGET_PERCENT_FOR_6_OR_MORE_DISPLAY_LOTS = 25
const DEFAULT_BUY_ON_DIP_BUY_TARGET_PERCENT = 1

function decodeApplicationServerKey(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const decoded = window.atob(`${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/'))
  const buffer = new ArrayBuffer(decoded.length)
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }
  return buffer
}

function getSubscriptionPayload(subscription: PushSubscription): PushSubscriptionPayload {
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('The browser returned an incomplete notification subscription.')
  }

  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  }
}

export default function UserSettingsPage() {
  const [saleTargetPercent, setSaleTargetPercent] = useState(String(DEFAULT_SALE_TARGET_PERCENT))
  const [buyTargetPercentUnder3DisplayLots, setBuyTargetPercentUnder3DisplayLots] = useState(String(DEFAULT_BUY_TARGET_PERCENT_UNDER_3_DISPLAY_LOTS))
  const [buyTargetPercentFor3DisplayLots, setBuyTargetPercentFor3DisplayLots] = useState(String(DEFAULT_BUY_TARGET_PERCENT_FOR_3_DISPLAY_LOTS))
  const [buyTargetPercentFor4DisplayLots, setBuyTargetPercentFor4DisplayLots] = useState(String(DEFAULT_BUY_TARGET_PERCENT_FOR_4_DISPLAY_LOTS))
  const [buyTargetPercentFor5DisplayLots, setBuyTargetPercentFor5DisplayLots] = useState(String(DEFAULT_BUY_TARGET_PERCENT_FOR_5_DISPLAY_LOTS))
  const [buyTargetPercentFor6OrMoreDisplayLots, setBuyTargetPercentFor6OrMoreDisplayLots] = useState(String(DEFAULT_BUY_TARGET_PERCENT_FOR_6_OR_MORE_DISPLAY_LOTS))
  const [buyOnDipBuyTargetPercent, setBuyOnDipBuyTargetPercent] = useState(String(DEFAULT_BUY_ON_DIP_BUY_TARGET_PERCENT))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pushSupported, setPushSupported] = useState<boolean | null>(null)
  const [pushAvailable, setPushAvailable] = useState(false)
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)
  const [pushNotice, setPushNotice] = useState<string | null>(null)
  const [pushPermission, setPushPermission] = useState<NotificationPermission | null>(null)
  const [badgeRefreshBusy, setBadgeRefreshBusy] = useState(false)
  const [badgeRefreshStatus, setBadgeRefreshStatus] = useState<string | null>(null)
  const [badgeRefreshError, setBadgeRefreshError] = useState<string | null>(null)
  const appBadgeSupported = typeof navigator.setAppBadge === 'function'

  useEffect(() => {
    let cancelled = false
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    setPushSupported(supported)
    if (!supported) return

    setPushPermission(Notification.permission)
    getPushNotificationConfig()
      .then(async (config) => {
        if (cancelled) return
        setPushAvailable(config.available)
        setPushPublicKey(config.publicKey)
        await navigator.serviceWorker.register('/service-worker.js')
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        if (!cancelled && subscription && config.available) {
          await savePushSubscription(getSubscriptionPayload(subscription))
          if (!cancelled) setPushEnabled(true)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPushError(err instanceof Error ? err.message : 'Unable to check phone notification settings.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

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
          setBuyOnDipBuyTargetPercent(String(settings.buyOnDipBuyTargetPercent))
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

    const parsedBuyOnDipBuyTargetPercent = Number(buyOnDipBuyTargetPercent)
    if (!Number.isFinite(parsedBuyOnDipBuyTargetPercent) || parsedBuyOnDipBuyTargetPercent <= 0 || parsedBuyOnDipBuyTargetPercent >= 100) {
      setError('Buy on Dip buy target percent must be greater than 0 and less than 100.')
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
        buyOnDipBuyTargetPercent: parsedBuyOnDipBuyTargetPercent,
      })
      setSaleTargetPercent(String(updated.saleTargetPercent))
      setBuyTargetPercentUnder3DisplayLots(String(updated.buyTargetPercentUnder3DisplayLots))
      setBuyTargetPercentFor3DisplayLots(String(updated.buyTargetPercentFor3DisplayLots))
      setBuyTargetPercentFor4DisplayLots(String(updated.buyTargetPercentFor4DisplayLots))
      setBuyTargetPercentFor5DisplayLots(String(updated.buyTargetPercentFor5DisplayLots))
      setBuyTargetPercentFor6OrMoreDisplayLots(String(updated.buyTargetPercentFor6OrMoreDisplayLots))
      setBuyOnDipBuyTargetPercent(String(updated.buyOnDipBuyTargetPercent))
      setSuccess('User settings saved.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save user settings.')
    } finally {
      setSaving(false)
    }
  }

  async function onTogglePushNotifications() {
    setPushBusy(true)
    setPushError(null)
    setPushNotice(null)

    try {
      await navigator.serviceWorker.register('/service-worker.js')
      const registration = await navigator.serviceWorker.ready
      const currentSubscription = await registration.pushManager.getSubscription()

      if (pushEnabled) {
        if (currentSubscription) {
          await deletePushSubscription(getSubscriptionPayload(currentSubscription))
          await currentSubscription.unsubscribe()
        }
        setPushEnabled(false)
        setPushNotice('Phone notifications are off on this device.')
        return
      }

      if (!pushAvailable || !pushPublicKey) {
        throw new Error('Phone notifications are not configured on the server.')
      }

      const permission = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission
      setPushPermission(permission)
      if (permission !== 'granted') {
        throw new Error('Notification permission was not granted. Check this site’s browser settings.')
      }

      const subscription = currentSubscription || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(pushPublicKey),
      })
      await savePushSubscription(getSubscriptionPayload(subscription))
      setPushEnabled(true)
      setPushNotice('Phone notifications are enabled on this device.')
    } catch (err: unknown) {
      setPushError(err instanceof Error ? err.message : 'Unable to update phone notification settings.')
    } finally {
      setPushBusy(false)
    }
  }

  async function onRefreshAppBadge() {
    setBadgeRefreshBusy(true)
    setBadgeRefreshStatus(null)
    setBadgeRefreshError(null)
    try {
      const unreadCount = await getUnreadMessageCount()
      const badgeResult = await updateAppBadge(unreadCount)
      if (badgeResult.status === 'unsupported') {
        setBadgeRefreshError('This browser context does not support app icon badges. On iPhone or iPad, open Stock Tracker from its Home Screen icon on iOS/iPadOS 16.4 or newer.')
        return
      }
      if (badgeResult.status === 'failed') {
        const errorDetails = badgeResult.error instanceof Error
          ? ` ${badgeResult.error.name}: ${badgeResult.error.message}`
          : ''
        setBadgeRefreshError(`The browser rejected the badge update.${errorDetails} Check notification permission and the iPhone/iPad Badges setting.`)
        return
      }
      setBadgeRefreshStatus(`Requested an icon badge update for ${unreadCount} unread message${unreadCount === 1 ? '' : 's'}.`)
    } catch (err: unknown) {
      setBadgeRefreshError(err instanceof Error ? err.message : 'Unable to refresh the app icon badge.')
    } finally {
      setBadgeRefreshBusy(false)
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

      <div className="panel push-settings-panel">
        <div>
          <h3>Phone Notifications</h3>
          <p>Get a phone alert when a new price-target message is created.</p>
          {pushSupported === false ? <p className="push-settings-detail">This browser does not support Web Push notifications.</p> : null}
          {pushSupported && !pushAvailable ? <p className="push-settings-detail">Phone notifications are not configured on the server.</p> : null}
          {pushSupported && pushPermission === 'denied' ? <p className="push-settings-detail">Notifications are blocked in this browser’s site settings.</p> : null}
          {pushSupported && /iPhone|iPad|iPod/.test(navigator.userAgent) ? (
            <p className="push-settings-detail">On iPhone or iPad, icon badges require iOS/iPadOS 16.4 or newer, opening Stock Tracker from its Home Screen icon, notification permission, and Badges enabled in Settings &gt; Notifications &gt; Stock Tracker. Enable Phone Notifications here to grant permission and receive background updates.</p>
          ) : null}
        </div>
        <button
          className={pushEnabled ? 'button' : 'button button-primary'}
          type="button"
          onClick={() => void onTogglePushNotifications()}
          disabled={pushSupported !== true || (!pushAvailable && !pushEnabled) || pushBusy}
        >
          {pushBusy ? 'Updating...' : pushEnabled ? 'Turn Off on This Device' : 'Enable Phone Notifications'}
        </button>
        {pushError ? <p className="status status-error">{pushError}</p> : null}
        {pushNotice ? <p className="status status-success">{pushNotice}</p> : null}
        <div className="push-settings-detail">
          <p>App icon badge API: {appBadgeSupported ? 'available' : 'unavailable in this browser context'}.</p>
          <p>Notification permission: {pushPermission ?? (pushSupported ? 'checking' : 'unavailable')}.</p>
          <button className="button" type="button" onClick={() => void onRefreshAppBadge()} disabled={badgeRefreshBusy}>
            {badgeRefreshBusy ? 'Refreshing...' : 'Refresh App Icon Badge'}
          </button>
          {badgeRefreshStatus ? <p className="status status-success">{badgeRefreshStatus} If it is not visible, check the iPhone/iPad Badges setting.</p> : null}
          {badgeRefreshError ? <p className="status status-error">{badgeRefreshError}</p> : null}
        </div>
      </div>

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
                  step="0.0001"
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
                  step="0.0001"
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
                  step="0.0001"
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
                  step="0.0001"
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
                  step="0.0001"
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
                  step="0.0001"
                  value={buyTargetPercentFor6OrMoreDisplayLots}
                  onChange={(event) => setBuyTargetPercentFor6OrMoreDisplayLots(event.target.value)}
                  disabled={saving}
                />
              </label>
            </div>

            <div className="target-settings-section target-settings-divider">
              <h3>Buy on Dip</h3>
              <label>
                New Buy Target Percent Below Buy on Dip Price
                <input
                  type="number"
                  min="0.0001"
                  max="99.9999"
                  step="0.0001"
                  value={buyOnDipBuyTargetPercent}
                  onChange={(event) => setBuyOnDipBuyTargetPercent(event.target.value)}
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
