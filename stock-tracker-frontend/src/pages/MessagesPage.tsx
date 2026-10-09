import { useEffect, useState } from 'react'
import { AppMessage, deleteMessages, getMessages, markSelectedMessagesRead, openMessage } from '../api'
import { SavedReviewMessage } from '../reviewMessages'

export const MESSAGES_UPDATED_EVENT = 'messages-updated'

function notifyMessagesUpdated() {
  window.dispatchEvent(new Event(MESSAGES_UPDATED_EVENT))
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<AppMessage[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectionAction, setSelectionAction] = useState<'read' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    getMessages()
      .then((result) => {
        if (!cancelled) setMessages(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load messages')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function toggleMessage(message: AppMessage) {
    if (expandedId === message.id) {
      setExpandedId(null)
      return
    }

    setExpandedId(message.id)
    if (message.isRead) {
      return
    }

    try {
      const opened = await openMessage(message.id)
      setMessages((previous) => previous.map((row) => (row.id === opened.id ? opened : row)))
      notifyMessagesUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to open message')
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function onMarkSelectedRead() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setSelectionAction('read')
    setError(null)
    try {
      await markSelectedMessagesRead(ids)
      const selected = new Set(ids)
      setMessages((previous) => previous.map((row) => (
        selected.has(row.id) ? { ...row, isRead: true, readAt: row.readAt || new Date().toISOString() } : row
      )))
      setSelectedIds(new Set())
      notifyMessagesUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to mark selected messages read')
    } finally {
      setSelectionAction(null)
    }
  }

  async function onDeleteSelected() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0 || !window.confirm(`Delete ${ids.length} selected message${ids.length === 1 ? '' : 's'}?`)) return
    setSelectionAction('delete')
    setError(null)
    try {
      await deleteMessages(ids)
      const selected = new Set(ids)
      setMessages((previous) => previous.filter((row) => !selected.has(row.id)))
      setSelectedIds(new Set())
      setExpandedId((current) => current && selected.has(current) ? null : current)
      notifyMessagesUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to delete selected messages')
    } finally {
      setSelectionAction(null)
    }
  }

  const unreadCount = messages.filter((message) => !message.isRead).length

  return (
    <section>
      <div className="panel messages-header">
        <div>
          <h2>Messages</h2>
          <p>Saved AI questions and responses appear here alongside price target alerts, which are checked every five minutes while the US market is open.</p>
        </div>
        <div className="messages-actions">
          <button className="button" onClick={() => void onMarkSelectedRead()} disabled={selectedIds.size === 0 || selectionAction !== null}>
            {selectionAction === 'read' ? 'Marking...' : 'Mark selected read'}
          </button>
          <button className="button button-danger" onClick={() => void onDeleteSelected()} disabled={selectedIds.size === 0 || selectionAction !== null}>
            {selectionAction === 'delete' ? 'Deleting...' : 'Delete selected'}
          </button>
        </div>
      </div>

      {error ? <div className="panel status status-error">{error}</div> : null}

      <div className="panel">
        {loading ? (
          <p>Loading messages...</p>
        ) : messages.length === 0 ? (
          <p>No messages yet.</p>
        ) : (
          <ul className="message-list">
            {messages.map((message) => (
              <li key={message.id} className={`message-item${message.isRead ? '' : ' message-unread'}`}>
                <div className="message-row">
                  <label className="message-select">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(message.id)}
                      disabled={selectionAction !== null}
                      onChange={() => toggleSelected(message.id)}
                      aria-label={`Select ${message.type === 'ai-chat' ? 'AI chat' : message.ticker} message`}
                    />
                  </label>
                  <button className="message-summary" onClick={() => void toggleMessage(message)}>
                    <span className={`message-type message-type-${message.type === 'ai-chat' ? 'ai' : message.type === 'sell-target-hit' ? 'sell' : 'buy'}`}>
                      {message.type === 'ai-chat' ? 'AI' : message.type === 'sell-target-hit' ? 'Sell' : 'Buy'}
                    </span>
                    <strong>{message.type === 'ai-chat'
                      ? message.body.startsWith('Review section: ') ? message.body.split('\n')[0].slice('Review section: '.length) : 'Portfolio Q&A'
                      : message.ticker}</strong>
                    <span className="message-date">{new Date(message.createdAt).toLocaleString()}</span>
                  </button>
                </div>
                {expandedId === message.id ? message.type === 'ai-chat'
                  ? <SavedReviewMessage body={message.body} />
                  : <p className="message-body">{message.body}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
