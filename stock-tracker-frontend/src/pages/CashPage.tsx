import { FormEvent, useEffect, useState } from 'react'
import {
  CashSummary,
  CashTransaction,
  CashTransactionType,
  CreateCashInput,
  createCashTransaction,
  deleteCashTransaction,
  emitPortfolioUpdated,
  getCashSummary,
  getCashTransactions,
} from '../api'

type CashFormState = {
  type: CashTransactionType
  amount: string
  transactionDate: string
}

const EMPTY_FORM: CashFormState = {
  type: 'deposit',
  amount: '',
  transactionDate: new Date().toISOString().slice(0, 10),
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleDateString(undefined, { timeZone: 'UTC' })
}

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`
}

function validateCashForm(form: CashFormState): string | null {
  if (!form.type) {
    return 'Transaction type is required.'
  }

  const amount = Number(form.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Amount must be greater than 0.'
  }

  if (!form.transactionDate) {
    return 'Transaction date is required.'
  }

  const selectedDate = new Date(form.transactionDate)
  if (Number.isNaN(selectedDate.getTime())) {
    return 'Transaction date is invalid.'
  }

  const now = new Date()
  const selectedUtc = Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), selectedDate.getUTCDate())
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (selectedUtc > nowUtc) {
    return 'Transaction date cannot be in the future.'
  }

  return null
}

export default function CashPage() {
  const [transactions, setTransactions] = useState<CashTransaction[]>([])
  const [summary, setSummary] = useState<CashSummary | null>(null)
  const [form, setForm] = useState<CashFormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function loadCashData() {
    setLoading(true)
    setError(null)
    try {
      const [transactionsResult, summaryResult] = await Promise.all([
        getCashTransactions(),
        getCashSummary(),
      ])
      setTransactions(transactionsResult)
      setSummary(summaryResult)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load cash data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCashData()
  }, [])

  function clearForm() {
    setForm(EMPTY_FORM)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const validationError = validateCashForm(form)
    if (validationError) {
      setError(validationError)
      return
    }

    const payload: CreateCashInput = {
      type: form.type,
      amount: Number(form.amount),
      transactionDate: new Date(form.transactionDate).toISOString(),
    }

    setSaving(true)
    try {
      await createCashTransaction(payload)
      setSuccess('Cash transaction created.')
      clearForm()
      await loadCashData()
      emitPortfolioUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to create cash transaction.')
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(transaction: CashTransaction) {
    const shouldDelete = window.confirm(`Delete ${transaction.type} transaction for ${formatMoney(Number(transaction.amount))}?`)
    if (!shouldDelete) {
      return
    }

    setError(null)
    setSuccess(null)
    try {
      await deleteCashTransaction(transaction.id)
      setSuccess('Cash transaction deleted.')
      await loadCashData()
      emitPortfolioUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to delete cash transaction.')
    }
  }

  return (
    <section>
      <div className="panel">
        <h2>Cash (MVP)</h2>
        <p>Create and delete cash transactions. Summary updates after each successful transaction.</p>
      </div>

      <div className="panel">
        <h3>Add Transaction</h3>
        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            Type
            <select
              value={form.type}
              onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value as CashTransactionType }))}
              disabled={saving}
            >
              <option value="deposit">Deposit</option>
              <option value="withdrawal">Withdrawal</option>
              <option value="interest">Interest</option>
              <option value="fee">Fee</option>
            </select>
          </label>

          <label>
            Amount
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
              disabled={saving}
            />
          </label>

          <label>
            Transaction Date
            <input
              type="date"
              value={form.transactionDate}
              onChange={(event) => setForm((prev) => ({ ...prev, transactionDate: event.target.value }))}
              disabled={saving}
            />
          </label>

          <div className="form-actions">
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? 'Creating...' : 'Add Transaction'}
            </button>
          </div>
        </form>

        {error ? <div className="status status-error">{error}</div> : null}
        {success ? <div className="status status-success">{success}</div> : null}
      </div>

      {summary ? (
        <div className="panel stat-grid">
          <div className="stat"><div className="label">Available Cash</div><div className="value">{formatMoney(summary.availableCash)}</div></div>
          <div className="stat"><div className="label">Cost Basis</div><div className="value">{formatMoney(summary.costBasis)}</div></div>
          <div className="stat"><div className="label">Adjustments</div><div className="value">{formatMoney(summary.adjustments)}</div></div>
          <div className="stat"><div className="label">Deposits</div><div className="value">{formatMoney(summary.deposits)}</div></div>
          <div className="stat"><div className="label">Withdrawals</div><div className="value">{formatMoney(summary.withdrawals)}</div></div>
          <div className="stat"><div className="label">Fees</div><div className="value">{formatMoney(summary.fees)}</div></div>
        </div>
      ) : null}

      <div className="panel">
        <h3>Cash Transactions</h3>
        {loading ? (
          <p>Loading cash transactions...</p>
        ) : transactions.length === 0 ? (
          <p>No cash transactions yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{formatDate(transaction.transactionDate)}</td>
                  <td>{transaction.type}</td>
                  <td>{formatMoney(Number(transaction.amount))}</td>
                  <td>
                    <button className="button button-danger" type="button" onClick={() => onDelete(transaction)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: '2rem', textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>Cash Page</div>
    </section>
  )
}
