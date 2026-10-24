export async function updateAppBadge(count: number): Promise<void> {
  try {
    if (count === 0) {
      if ('clearAppBadge' in navigator) await navigator.clearAppBadge()
    } else if ('setAppBadge' in navigator) {
      await navigator.setAppBadge(count)
    }
  } catch (error) {
    console.error('[badge] Unable to update the app badge:', error)
  }
}
