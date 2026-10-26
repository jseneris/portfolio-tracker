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

    await expect(updateAppBadge(123)).resolves.toEqual({ status: 'updated' })
    await expect(updateAppBadge(2)).resolves.toEqual({ status: 'updated' })
    await expect(updateAppBadge(0)).resolves.toEqual({ status: 'updated' })

    expect(setAppBadge.mock.calls).toEqual([[123], [2]])
    expect(clearAppBadge).toHaveBeenCalledOnce()
  })

  it('does nothing in browsers without the Badging API', async () => {
    vi.stubGlobal('navigator', {})
    await expect(updateAppBadge(3)).resolves.toEqual({ status: 'unsupported' })
    await expect(updateAppBadge(0)).resolves.toEqual({ status: 'unsupported' })
  })

  it.each([0, 3])('logs badge failures without breaking messages (count %s)', async (count) => {
    const error = new Error('Permission denied')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('navigator', {
      setAppBadge: vi.fn().mockRejectedValue(error),
      clearAppBadge: vi.fn().mockRejectedValue(error),
    })

    await expect(updateAppBadge(count)).resolves.toEqual({ status: 'failed', error })
    expect(log).toHaveBeenCalledWith('[badge] Unable to update the app badge:', error)
  })
})
