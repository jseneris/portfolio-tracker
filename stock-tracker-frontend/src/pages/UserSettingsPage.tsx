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
import { BUY_TARGET_PRESETS } from '../buyTargetPresets'
export { BUY_TARGET_PRESETS } from '../buyTargetPresets'

const DEFAULT_TARGET_FORM = {
  basePurchaseSize: '300',
  saleTargetPercent: '10',
  buyOnDipBuyTargetPercent: '1',
  buyTargetPercentAtBaseSize: '10',
  buyTargetPercentBasePlus1: '15',
  buyTargetPercentBasePlus2: '20',
  buyTargetPercentBasePlus3OrMore: '25',
}

type TargetFormValues = typeof DEFAULT_TARGET_FORM

const BUY_TARGET_FIELDS = [
  'buyTargetPercentAtBaseSize',
  'buyTargetPercentBasePlus1',
  'buyTargetPercentBasePlus2',
  'buyTargetPercentBasePlus3OrMore',
] as const

export function BuyTargetPresetSlider({ form, disabled, onChange }: {
  form: Pick<TargetFormValues, typeof BUY_TARGET_FIELDS[number]>
  disabled: boolean
  onChange: (values: Pick<TargetFormValues, typeof BUY_TARGET_FIELDS[number]>) => void
}) {
  const presetIndex = BUY_TARGET_PRESETS.findIndex((preset) =>
    BUY_TARGET_FIELDS.every((field, index) => form[field].trim() !== '' && Number(form[field]) === preset.percentages[index]))
  const presetName = presetIndex < 0 ? 'Custom' : BUY_TARGET_PRESETS[presetIndex].name

  function applyPreset(index: number) {
    const preset = BUY_TARGET_PRESETS[index]
    onChange({
      buyTargetPercentAtBaseSize: String(preset.percentages[0]),
      buyTargetPercentBasePlus1: String(preset.percentages[1]),
      buyTargetPercentBasePlus2: String(preset.percentages[2]),
      buyTargetPercentBasePlus3OrMore: String(preset.percentages[3]),
    })
  }

  return (
    <div className="buy-target-presets">
      <label htmlFor="buy-target-preset">Buy Target Preset: {presetName}</label>
      <input
        id="buy-target-preset"
        type="range"
        min="0"
        max="3"
        step="1"
        value={Math.max(0, presetIndex)}
        aria-valuetext={presetName}
        aria-describedby="buy-target-preset-help"
        disabled={disabled}
        onChange={(event) => applyPreset(Number(event.target.value))}
      />
      <div className="buy-target-preset-labels">
        {BUY_TARGET_PRESETS.map((preset, index) => (
          <button key={preset.name} type="button" disabled={disabled}
            aria-pressed={presetIndex === index} onClick={() => applyPreset(index)}>
            {preset.name}
          </button>
        ))}
      </div>
      <small id="buy-target-preset-help">
        Choose a preset to fill all four percentages, or edit them individually.
        {presetIndex < 0 ? ' Custom values do not match a preset; the slider applies a preset when moved.' : ''}
        {' '}Changes take effect when you save settings.
      </small>
    </div>
  )
}

function toFormValues(settings: {
  basePurchaseSize: number
  saleTargetPercent: number
  buyOnDipBuyTargetPercent: number
  buyTargetPercentAtBaseSize: number
  buyTargetPercentBasePlus1: number
  buyTargetPercentBasePlus2: number
  buyTargetPercentBasePlus3OrMore: number
}): TargetFormValues {
  return {
    basePurchaseSize: String(settings.basePurchaseSize),
    saleTargetPercent: String(settings.saleTargetPercent),
    buyOnDipBuyTargetPercent: String(settings.buyOnDipBuyTargetPercent),
    buyTargetPercentAtBaseSize: String(settings.buyTargetPercentAtBaseSize),
    buyTargetPercentBasePlus1: String(settings.buyTargetPercentBasePlus1),
    buyTargetPercentBasePlus2: String(settings.buyTargetPercentBasePlus2),
    buyTargetPercentBasePlus3OrMore: String(settings.buyTargetPercentBasePlus3OrMore),
  }
}

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
  const [form, setForm] = useState<TargetFormValues>(DEFAULT_TARGET_FORM)
  const [savedForm, setSavedForm] = useState<TargetFormValues>(DEFAULT_TARGET_FORM)
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
          const values = toFormValues(settings)
          setForm(values)
          setSavedForm(values)
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

  const isDirty = (Object.keys(form) as Array<keyof TargetFormValues>).some((field) => form[field] !== savedForm[field])

  function updateField(field: keyof TargetFormValues, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function onCancel() {
    setForm(savedForm)
    setError(null)
    setSuccess(null)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const parsedBasePurchaseSize = Number(form.basePurchaseSize)
    if (!Number.isFinite(parsedBasePurchaseSize) || parsedBasePurchaseSize < 0.01
      || parsedBasePurchaseSize > 9999999999.99
      || Math.abs(parsedBasePurchaseSize * 100 - Math.round(parsedBasePurchaseSize * 100)) > 0.000001) {
      setError('Base Purchase Size must be a positive dollar amount with at most 2 decimal places.')
      return
    }

    const parsedPercent = Number(form.saleTargetPercent)
    if (!Number.isFinite(parsedPercent) || parsedPercent <= 0) {
      setError('Sale target percent must be greater than 0.')
      return
    }

    const parsedBuyOnDipBuyTargetPercent = Number(form.buyOnDipBuyTargetPercent)
    if (!Number.isFinite(parsedBuyOnDipBuyTargetPercent) || parsedBuyOnDipBuyTargetPercent <= 0 || parsedBuyOnDipBuyTargetPercent >= 100) {
      setError('Buy on Dip buy target percent must be greater than 0 and less than 100.')
      return
    }

    const parsedBuyTargetPercentAtBaseSize = Number(form.buyTargetPercentAtBaseSize)
    if (!Number.isFinite(parsedBuyTargetPercentAtBaseSize) || parsedBuyTargetPercentAtBaseSize <= 0) {
      setError('Buy target percent at base size must be greater than 0.')
      return
    }

    const parsedBuyTargetPercentBasePlus1 = Number(form.buyTargetPercentBasePlus1)
    if (!Number.isFinite(parsedBuyTargetPercentBasePlus1) || parsedBuyTargetPercentBasePlus1 <= 0) {
      setError('Buy target percent for base size +1 must be greater than 0.')
      return
    }

    const parsedBuyTargetPercentBasePlus2 = Number(form.buyTargetPercentBasePlus2)
    if (!Number.isFinite(parsedBuyTargetPercentBasePlus2) || parsedBuyTargetPercentBasePlus2 <= 0) {
      setError('Buy target percent for base size +2 must be greater than 0.')
      return
    }

    const parsedBuyTargetPercentBasePlus3OrMore = Number(form.buyTargetPercentBasePlus3OrMore)
    if (!Number.isFinite(parsedBuyTargetPercentBasePlus3OrMore) || parsedBuyTargetPercentBasePlus3OrMore <= 0) {
      setError('Buy target percent for base size +3 or more must be greater than 0.')
      return
    }

    setSaving(true)
    try {
      const updated = await updateUserTargetSettings({
        basePurchaseSize: parsedBasePurchaseSize,
        saleTargetPercent: parsedPercent,
        buyOnDipBuyTargetPercent: parsedBuyOnDipBuyTargetPercent,
        buyTargetPercentAtBaseSize: parsedBuyTargetPercentAtBaseSize,
        buyTargetPercentBasePlus1: parsedBuyTargetPercentBasePlus1,
        buyTargetPercentBasePlus2: parsedBuyTargetPercentBasePlus2,
        buyTargetPercentBasePlus3OrMore: parsedBuyTargetPercentBasePlus3OrMore,
      })
      const values = toFormValues(updated)
      setForm(values)
      setSavedForm(values)
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
              <h3>Purchase Size</h3>
              <label>
                Base Purchase Size ($)
                <input
                  type="number"
                  min="0.01"
                  max="9999999999.99"
                  step="0.01"
                  required
                  value={form.basePurchaseSize}
                  onChange={(event) => updateField('basePurchaseSize', event.target.value)}
                  disabled={saving}
                />
              </label>
              <small>The dashboard's red 5 badge marks a largest display lot worth more than 5 times this amount, using the latest stored close.</small>
            </div>
            <div className="target-settings-section">
              <h3>Sale Target</h3>
              <label>
                Sale Target Percent Above Last Buy/Sell Price
                <input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={form.saleTargetPercent}
                  onChange={(event) => updateField('saleTargetPercent', event.target.value)}
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
                  value={form.buyOnDipBuyTargetPercent}
                  onChange={(event) => updateField('buyOnDipBuyTargetPercent', event.target.value)}
                  disabled={saving}
                />
              </label>
              <small>Tickers with fewer display lots than their Base Size are automatically treated as Buy on Dip.</small>
            </div>

            <div className="target-settings-section target-settings-divider">
              <h3>Buy Targets</h3>
              <BuyTargetPresetSlider
                form={form}
                disabled={saving}
                onChange={(values) => {
                  setForm((current) => ({ ...current, ...values }))
                  setSuccess(null)
                }}
              />
              <label>
                Buy Target Percent Below Last Buy/Sell Price (Display Lots = Base Size)
                <input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={form.buyTargetPercentAtBaseSize}
                  onChange={(event) => updateField('buyTargetPercentAtBaseSize', event.target.value)}
                  disabled={saving}
                />
              </label>

              <label>
                Buy Target Percent Below Last Buy/Sell Price (Base Size +1)
                <input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={form.buyTargetPercentBasePlus1}
                  onChange={(event) => updateField('buyTargetPercentBasePlus1', event.target.value)}
                  disabled={saving}
                />
              </label>

              <label>
                Buy Target Percent Below Last Buy/Sell Price (Base Size +2)
                <input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={form.buyTargetPercentBasePlus2}
                  onChange={(event) => updateField('buyTargetPercentBasePlus2', event.target.value)}
                  disabled={saving}
                />
              </label>

              <label>
                Buy Target Percent Below Last Buy/Sell Price (Base Size +3 or More)
                <input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={form.buyTargetPercentBasePlus3OrMore}
                  onChange={(event) => updateField('buyTargetPercentBasePlus3OrMore', event.target.value)}
                  disabled={saving}
                />
              </label>
            </div>

            <div className="form-actions">
              <button className="button button-primary" type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
              <button className="button" type="button" onClick={onCancel} disabled={!isDirty || saving}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
