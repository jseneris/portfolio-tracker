---
applyTo: "stock-tracker-backend/tests/**/*.ts"
excludeAgent: "code-review"
---

This files lists the current test cases for the backend. 

### Test Cases
 - Cash TransactionTest
   1) Add $1000 cash on 1/1/2026
   2) Available cash should be $1000
   3) withdraw $200 cash on 1/15/2026
   4) Available cash should be $800   
   5) Add $50 interest on 1/31/2026
   6) Available cash should be $850
   7) Add $10 fee on 2/1/2026
   8) Available cash should be $840
   9) Cash Cost Basis should be $1000 - $200 = $800

 - Stock Purchase Test 
   1)Add $1000 cash on 1/1/2026
   2)Buy 2 shares of AAPL for $100 each on 2/1/2026
   3)Available cash prior to stock purchase should be $1000
   4)Available cash after stock purchase should be $800
   5)AAPL should have one purchase lot of 2 shares

- Stock Multiple Purchase Test
   1)Add $1000 cash on 1/1/2026
   2)Buy 3 shares of AAPL for $100 each on 2/1/2026
   3)AAPL should have one purchase lot of 3 shares
   4)AAPL Lot count should be 1
   5)Buy 2 shares of AAPL for $100 each on 3/1/2026
   6)Available cash after stock purchases should be $500
   7)AAPL should have two purchase lots; 3 and 2 shares respectively
   8)AAPL Lot count should be 2

- Stock Sale Test
   1)Add $1000 cash on 1/1/2026
   2)Buy 3 shares of AAPL for $100 each on 2/1/2026
   3)Buy 2 shares of AAPL for $100 each on 3/1/2026
   4)Sell 2 shares at $110 each of AAPL on 4/1/2026
   5)Available cash after stock sale should be $720
   6)User chooses to allocate Sold shares to 3/1 purchase
   7)AAPL should have one purchase lot of 3 shares remaining
   8)AAPL Lot count should be 1

- Stock non-LIFO sale lot Test
   1) Add $1000 cash on 1/1/2026
   2) Buy 2 shares of AAPL for $100 each on 2/1/2026
   3) Buy 3 shares of AAPL for $100 each on 3/1/2026
   4) Sell 2 shares at $110 each of AAPL on 4/1/2026
   5) Available cash after stock sale should be $720
   6) User chooses to allocation sold shares to the 3/1 lot (2 shares)
   7) AAPL should have one purchase lot of 3 shares remaining
   8) AAPL Lot count should be 1
   9) 3/1 purchase should have 1 share remaining, 2/1 purchase should have 2 shares remaining

- STock Dividend Test
   1) Add $1000 cash on 1/1/2026
   2) Buy 3 shares of AAPL for $100 each on 2/1/2026
   3) Buy 2 shares of AAPL for $100 each on 3/1/2026
   4) Apply a dividend of $10, .1 share at $100 per share on 4/1/2026
   5) AAPL should have two purchase lots; 3 and 2 shares respectively
   5) AAPL Lot count should be 2


- Stock Sale with Dividend Test
   1) Add $1000 cash on 1/1/2026
   2) Buy 3 shares of AAPL for $100 each on 2/1/2026
   3) Buy 2 shares of AAPL for $100 each on 3/1/2026
   4) Apply a dividend of $10, .1 share at $100 per share on 4/1/2026
   5) AAPL should have two purchase lots; 3 and 2 shares respectively
   6) Sell 4 shares at $110 each of AAPL on 5/1/2026
   7) Available cash after stock sale should be $840
   8) User chooses to allocate sold shares to the 3/1 lot (2 shares), and two share of 2/1 lot
   9) AAPL should have one purchase lot of 1 shares remaining
   10) AAPL Lot count should be 1
   11) AAPL should have 1.1 shares remaining (1 from 2/1 lot, .1 from dividend)

   - Stock Sale of Dividend Test
   1) Add $1000 cash on 1/1/2026
   2) Buy 3 shares of AAPL for $100 each on 2/1/2026
   3) Buy 2 shares of AAPL for $100 each on 3/1/2026
   4) Apply a dividend of $10, .1 share at $100 per share on 4/1/2026
   5) AAPL should have two purchase lots; 3 and 2 shares respectively
   6) Sell 4.1 shares at $110 each of AAPL on 5/1/2026
   7) Available cash after stock sale should be $840
   8) User chooses to allocate sold shares to the 3/1 lot (2 shares), and two share of 2/1 lot, and .1 share of dividend
   9) AAPL should have one purchase lot of 1 shares remaining
   10) AAPL Lot count should be 1
   11) AAPL should have 1 shares remaining (1 from 2/1 lot)

- Stock Split Test
   1) Add $1000 cash on 1/1/2026
   2) Buy 3 shares of AAPL for $100 each on 2/1/2026
   3) Buy 2 shares of AAPL for $100 each on 3/1/2026
   4) Apply a 2-for-1 split on AAPL on 2/10/2026
   5) AAPL should have two purchase lots; 6 and 2 shares respectively
   6) AAPL Lot count should be 2
   7) Cost basis of transactions prior to split should be the same as before
   8) Records affected by the split should have have indicator that they were split

- Stock Sale After Split Test
   1) Add $1000 cash on 1/1/2026
   2) Buy 3 shares of AAPL for $100 each on 2/1/2026`
   3) Buy 2 shares of AAPL for $100 each on 3/1/2026
   4) Apply a 2-for-1 split on AAPL on 2/10/2026
   5) Sell 4 shares at $110 each of AAPL on 5/1/2026
   6) Available cash after stock sale should be $840
   7) User chooses to allocate sold shares to the 2 shares of 3/1 lot and 2 shares of 2/1 lot
   8) AAPL should have one purchase lot of 4 shares remaining
   9) AAPL Lot count should be 1

