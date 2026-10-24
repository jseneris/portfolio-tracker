import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8')

function createWorker(supported = true) {
  type PushEvent = {
    data: { json: () => unknown; text: () => string }
    waitUntil: (work: Promise<unknown>) => void
  }
  const handlers: Record<string, (event: PushEvent) => void> = {}
  const setAppBadge = vi.fn().mockResolvedValue(undefined)
  const clearAppBadge = vi.fn().mockResolvedValue(undefined)
  const showNotification = vi.fn().mockResolvedValue(undefined)
  const postMessage = vi.fn()
  const error = vi.fn()
  runInNewContext(source, {
    self: {
      navigator: supported ? { setAppBadge, clearAppBadge } : {},
      registration: { showNotification },
      clients: { matchAll: vi.fn().mockResolvedValue([{ postMessage }]) },
      addEventListener: (type: string, handler: (event: PushEvent) => void) => {
        handlers[type] = handler
      },
    },
    console: { error },
  })

  async function push(payload: unknown, plainText = false) {
    let work: Promise<unknown> | undefined
    handlers.push({
      data: {
        json: () => {
          if (plainText) throw new SyntaxError('Not JSON')
          return payload
        },
        text: () => String(payload),
      },
      waitUntil: (promise) => { work = promise },
    })
    expect(work).toBeDefined()
    await work
  }

  return { push, setAppBadge, clearAppBadge, showNotification, postMessage, error }
}

describe('push message badges', () => {
  it('sets the server count in the background, displays the notification, and refreshes open apps', async () => {
    const worker = createWorker()
    await worker.push({ title: 'Target reached', body: 'New message', url: '/messages', unreadCount: 124 })

    expect(worker.setAppBadge).toHaveBeenCalledWith(124)
    expect(worker.showNotification).toHaveBeenCalledWith('Target reached', expect.objectContaining({
      body: 'New message', data: { url: '/messages' },
    }))
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'messages-updated' })
  })

  it('clears the badge for zero unread messages', async () => {
    const worker = createWorker()
    await worker.push({ unreadCount: 0 })
    expect(worker.clearAppBadge).toHaveBeenCalledOnce()
    expect(worker.setAppBadge).not.toHaveBeenCalled()
  })

  it.each([undefined, -1, 1.5, '3', Number.MAX_SAFE_INTEGER + 1])('does not change the badge for an absent or invalid count (%s)', async (unreadCount) => {
    const worker = createWorker()
    await worker.push({ unreadCount })
    expect(worker.setAppBadge).not.toHaveBeenCalled()
    expect(worker.clearAppBadge).not.toHaveBeenCalled()
    expect(worker.showNotification).toHaveBeenCalledOnce()
    if (unreadCount === undefined) expect(worker.error).not.toHaveBeenCalled()
    else expect(worker.error).toHaveBeenCalledOnce()
  })

  it('preserves notifications when badging is unsupported', async () => {
    const worker = createWorker(false)
    await worker.push({ unreadCount: 3 })
    expect(worker.showNotification).toHaveBeenCalledOnce()
    expect(worker.postMessage).toHaveBeenCalledOnce()
  })

  it('still displays notifications and refreshes open apps if badging fails', async () => {
    const worker = createWorker()
    worker.setAppBadge.mockRejectedValue(new Error('Permission denied'))
    await worker.push({ unreadCount: 3 })
    expect(worker.error).toHaveBeenCalledOnce()
    expect(worker.showNotification).toHaveBeenCalledOnce()
    expect(worker.postMessage).toHaveBeenCalledOnce()
  })

  it('preserves plain text push support without inventing a badge count', async () => {
    const worker = createWorker()
    await worker.push('Legacy notification', true)
    expect(worker.showNotification).toHaveBeenCalledWith('Stock Tracker', expect.objectContaining({
      body: 'Legacy notification',
    }))
    expect(worker.setAppBadge).not.toHaveBeenCalled()
  })
})
