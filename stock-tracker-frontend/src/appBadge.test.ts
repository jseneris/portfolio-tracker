import { afterEach, describe, expect, it, vi } from 'vitest'
import { updateAppBadge } from './appBadge'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Home Screen app badge', () => {
  it('uses the exact unread count and clears it when all messages are read', async () => {
    const setAppBadge = vi.fn().mockResolvedValue(undefined)
    const clearAppBadge = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { setAppBadge, clearAppBadge })

    await updateAppBadge(123)
    await updateAppBadge(2)
    await updateAppBadge(0)

    expect(setAppBadge.mock.calls).toEqual([[123], [2]])
    expect(clearAppBadge).toHaveBeenCalledOnce()
  })

  it('does nothing in browsers without the Badging API', async () => {
    vi.stubGlobal('navigator', {})
    await expect(updateAppBadge(3)).resolves.toBeUndefined()
    await expect(updateAppBadge(0)).resolves.toBeUndefined()
  })

  it.each([0, 3])('logs badge failures without breaking messages (count %s)', async (count) => {
    const error = new Error('Permission denied')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('navigator', {
      setAppBadge: vi.fn().mockRejectedValue(error),
      clearAppBadge: vi.fn().mockRejectedValue(error),
    })

    await expect(updateAppBadge(count)).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith('[badge] Unable to update the app badge:', error)
  })
})
