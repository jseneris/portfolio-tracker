import { useEffect, useState } from 'react'
import { AppMessage, getMessages, markAllMessagesRead, openMessage } from '../api'

export const MESSAGES_UPDATED_EVENT = 'messages-updated'

function notifyMessagesUpdated() {
  window.dispatchEvent(new Event(MESSAGES_UPDATED_EVENT))
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<AppMessage[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
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

  async function onMarkAllRead() {
    try {
      await markAllMessagesRead()
      setMessages((previous) => previous.map((row) => ({ ...row, isRead: true })))
      notifyMessagesUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to mark messages read')
    }
  }

  const unreadCount = messages.filter((message) => !message.isRead).length

  return (
    <section>
      <div className="panel messages-header">
        <div>
          <h2>Messages</h2>
          <p>Price target alerts checked every 30 minutes while the US market is open.</p>
        </div>
        <button className="button" onClick={() => void onMarkAllRead()} disabled={unreadCount === 0}>
          Mark all read
        </button>
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
                <button className="message-summary" onClick={() => void toggleMessage(message)}>
                  <span className={`message-type message-type-${message.type === 'sell-target-hit' ? 'sell' : 'buy'}`}>
                    {message.type === 'sell-target-hit' ? 'Sell' : 'Buy'}
                  </span>
                  <strong>{message.ticker}</strong>
                  <span className="message-date">{new Date(message.createdAt).toLocaleString()}</span>
                </button>
                {expandedId === message.id ? <p className="message-body">{message.body}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
