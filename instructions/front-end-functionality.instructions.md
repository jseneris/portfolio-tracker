---
applyTo: "stock-tracker-frontend/src/db/**/*.ts"
excludeAgent: "code-review"
---

Login -
   - User navigates to login page.
   - User enters valid credentials and submits form.
   - User is redirected to dashboard upon successful login.
   - Invalid credentials show error message.

Dashboard -
   - User sees summary of portfolio including cash and stock holdings.
   - User can navigate to different sections such as cash transactions, stock purchases, and portfolio summary.
   - User can log out from the dashboard.

Cash Transactions -
   - User can view a list of cash transactions.
   - User can add a new cash transaction.
   - User can edit or delete existing cash transactions.

Stock Transactions -
   - User can view a list of stock transactions.
   - User can add a new stock transaction.
   - User can edit or delete existing stock transactions.

Portfolio Summary -
   - User can view overall portfolio performance.
   - User can see breakdown of holdings by asset type.
   - User can view historical performance charts.

