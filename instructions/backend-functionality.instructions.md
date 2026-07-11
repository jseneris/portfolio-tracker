---
applyTo: "stock-tracker-backend/src/db/**/*.ts"
excludeAgent: "code-review"
---

Multi-user stock portfolio tracker.  This file describes what functionality it must support.

Each user has a seperate portfolio.

Each user can add or withdraw cash to/from their portfolio.  Each cash transaction has a type: deposit, withdrawal, interest, fee.  Cash basis is based only on deposits and withdrawals.  Interest and fees are adjustments to available cash but do not affect cash basis.  Stock transactions (buys, sells) affect available cash but do not affect cash basis.  Dividends are reinvested only and do not directly affect available cash. 

Stock Splits must be applied retroactively to all affected lots and transactions.  The system must support multiple sequential splits on the same ticker, and each split must be traceable in the audit trail. Stock splits affect all users' portfolios, and the system must ensure that all affected lots and transactions are adjusted correctly for each user.  

Portfolio summary, available cash, list of stocks with details (ticker, shares, cost basis, and lot count) must be available with single call to database.  All calculations must be derived on-demand and not stored in state.  All transactions must support past dates and sort by transaction_date.

