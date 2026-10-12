import { useState } from 'react'
import { emitPortfolioUpdated, StockTransaction, updateStockTransactionDate } from '../api'

export default function TransactionDateEditor({ transaction, onSaved }: {
  transaction: StockTransaction
  onSaved: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(transaction.transactionDate.slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!['buy', 'sell', 'div'].includes(transaction.type) || transaction.isExchangeGenerated || transaction.isDeletionLocked) return null

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await updateStockTransactionDate(transaction.id, date, transaction.transactionDate.slice(0, 10))
      emitPortfolioUpdated()
      setEditing(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to update transaction date.')
      setSaving(false)
      return
    }
    try {
      await onSaved()
    } catch (err: unknown) {
      setEditing(true)
      setError(`Date saved, but refresh failed: ${err instanceof Error ? err.message : 'Unable to refresh transactions.'}`)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return <button className="button button-secondary" type="button" onClick={() => {
      setDate(transaction.transactionDate.slice(0, 10))
      setError(null)
      setEditing(true)
    }}>Edit date</button>
  }

  return (
    <div className="transaction-date-editor">
      <label>
        Transaction date
        <input type="date" value={date} disabled={saving} onChange={(event) => setDate(event.target.value)} />
      </label>
      <div className="inline-actions">
        <button className="button button-primary" type="button" disabled={saving || !date || date === transaction.transactionDate.slice(0, 10)} onClick={() => void save()}>
          {saving ? 'Saving...' : 'Save date'}
        </button>
        <button className="button" type="button" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
      </div>
      {error ? <p className="status status-error" role="alert">{error}</p> : null}
    </div>
  )
}
