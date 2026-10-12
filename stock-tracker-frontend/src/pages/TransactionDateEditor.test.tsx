import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { StockTransaction } from '../api'
import TransactionDateEditor from './TransactionDateEditor'

describe('transaction date editor eligibility', () => {
  const transaction: StockTransaction = {
    id: '00000000-0000-4000-8000-000000000001', userId: 'test', ticker: 'TEST',
    type: 'buy', quantity: 10, price: 100, amount: 1000, transactionDate: '2026-01-10T00:00:00Z',
  }
  const onSaved = async () => {}
  it.each(['buy', 'sell', 'div'] as const)('offers date editing for %s transactions', (type) => {
    expect(renderToStaticMarkup(createElement(TransactionDateEditor, {
      transaction: { ...transaction, type }, onSaved,
    }))).toContain('Edit date')
  })
  it('does not offer date editing for exchanges or exchange-linked transactions', () => {
    for (const blocked of [
      { ...transaction, type: 'exchange' as const },
      { ...transaction, isExchangeGenerated: true },
      { ...transaction, isDeletionLocked: true },
    ]) {
      expect(renderToStaticMarkup(createElement(TransactionDateEditor, { transaction: blocked, onSaved }))).toBe('')
    }
  })
})
