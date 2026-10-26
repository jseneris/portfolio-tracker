export type AppBadgeUpdateResult =
  | { status: 'updated' }
  | { status: 'unsupported' }
  | { status: 'failed'; error: unknown }

export async function updateAppBadge(count: number): Promise<AppBadgeUpdateResult> {
  try {
    if (count === 0) {
      if ('clearAppBadge' in navigator && typeof navigator.clearAppBadge === 'function') {
        await navigator.clearAppBadge()
        return { status: 'updated' }
      }
      if ('setAppBadge' in navigator && typeof navigator.setAppBadge === 'function') {
        await navigator.setAppBadge(0)
        return { status: 'updated' }
      }
    } else if ('setAppBadge' in navigator) {
      if (typeof navigator.setAppBadge !== 'function') return { status: 'unsupported' }
      await navigator.setAppBadge(count)
      return { status: 'updated' }
    }
  } catch (error) {
    console.error('[badge] Unable to update the app badge:', error)
    return { status: 'failed', error }
  }
  return { status: 'unsupported' }
}
