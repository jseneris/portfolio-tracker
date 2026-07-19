# Plan: Cash & Stock Transaction Tracking System

**TL;DR**: Build a stock and cash portfolio management system with a Cash page for deposits/withdrawals/interest/fees, and a Stock Detail page for buy/sell/div/split transactions with lot tracking. Cost Basis = deposits − withdrawals. Available Cash = Cost Basis + adjustments − stock impacts. Dividends are reinvested only and don't affect Available Cash directly.
For sell transactions, the user must explicitly choose which existing lots are consumed, and the system should apply that allocation to update lot balances.  Both front end and backend should enforce data integrity, and all calculations should be derived on-demand rather than stored in state.  All transactions should support past dates and sort by `transaction_date`.
Multiple User accounts should be supported
Front end will be written in React with AUTH0 authentication. Backend will be MS-Sql

### Verification
- Cash Cost Basis calculation must use deposits minus withdrawals only
- Stock Cost Basis calculation based on Buys + Divs - Sales
- Available Cash must update with stock transactions (buys/sells)
- Splits must retroactively apply to past transactions and lots
- All transactions support past dates and sort by `transaction_date`

### Decisions
- Case Cost Basis is base cash only; interest/fees are adjustments
- Available Cash includes all cash transaction types and stock transaction impact
- Dividends are reinvested only, not direct cash
- Full lot tracking implemented immediately with user defined allocation
- Calculations are derived on-demand, not stored in state
