# Stock Tracker Backend API

Node.js/Express backend for the Stock Tracker application with SQL Server database connectivity.

## Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Database

Edit `.env.local` with your SQL Server connection details:

```env
DB_SERVER=your-server.com
DB_USER=your-user
DB_PASSWORD=your-password
DB_NAME=Stock Tracker
```

### 3. Start Development Server

```bash
npm run dev
```

The API will start on `http://localhost:5000` and automatically create the required database tables.

## Database Schema

### CashTransactions
- **id**: Unique identifier
- **userId**: User identifier (from Auth0)
- **type**: `deposit`, `withdrawal`, `interest`, `fee`
- **amount**: Transaction amount (decimal)
- **transactionDate**: Date of transaction
- **createdAt/updatedAt**: Timestamps

### StockTransactions
- **id**: Unique identifier
- **userId**: User identifier
- **ticker**: Stock ticker symbol (e.g., AAPL)
- **type**: `buy`, `sell`, `div`, `split`
- **quantity**: Number of shares
- **price**: Price per share
- **amount**: Total transaction amount
- **transactionDate**: Date of transaction
- **createdAt/updatedAt**: Timestamps
- **splitAdjusted**: flag to indicate if affected by stock split
- **lastSplitId**: Foreign key to the `StockSplits` record that last adjusted this transaction

### Lots
- **id**: Unique identifier
- **userId**: User identifier
- **ticker**: Stock ticker symbol
- **transactionId**: Reference to the buy or dividend transaction that created this lot
- **sourceType**: `purchase` or `dividend` - distinguishes lots created by a buy from lots created by a reinvested dividend
- **originalQuantity**: Initial shares in the lot
- **remainingQuantity**: Current shares in the lot after any sale allocations
- **unitCost**: Cost per share (adjusted by any applicable stock split)
- **purchaseDate**: Date lot was acquired
- **createdAt/updatedAt**: Timestamps
- **splitAdjusted**: flag to indicate if affected by stock split
- **lastSplitId**: Foreign key to the most recent `StockSplits` record applied to this lot

### LotAllocations
Records which lot(s) a sale transaction drew from and how much of each lot was consumed. This is the audit trail behind the user's explicit lot-selection on every sell - there is no automatic FIFO/LIFO allocation.
- **id**: Unique identifier
- **userId**: User identifier
- **saleTransactionId**: Reference to the `sell` StockTransactions row
- **lotId**: Reference to the Lots row this allocation consumed shares from
- **quantityConsumed**: Number of shares taken from the lot for this sale
- **createdAt**: Timestamp

### StockSplits
Audit record of each stock split applied to a ticker, used to retroactively adjust affected lots/transactions and to flag which records were touched.
- **id**: Unique identifier
- **userId**: User identifier
- **ticker**: Stock ticker symbol
- **multiplier**: Split ratio (e.g. `2` for a 2-for-1 split)
- **splitDate**: Effective date of the split; lots/transactions on or before this date are adjusted
- **createdAt**: Timestamp

## API Endpoints

### Cash Transactions
- `GET /api/cash` - Get all cash transactions
- `GET /api/cash/summary` - Get cash summary (deposits, withdrawals, interest, fees, available cash, cost basis)
- `POST /api/cash` - Create cash transaction
- `PUT /api/cash/:id` - Update cash transaction
- `DELETE /api/cash/:id` - Delete cash transaction

### Stock Transactions
- `GET /api/stocks` - Get all stock transactions
- `GET /api/stocks/:ticker` - Get transactions for ticker
- `GET /api/stocks/:ticker/summary` - Get ticker summary (total shares across all lots, lot count, cost basis)
- `POST /api/stocks` - Create stock transaction (`buy`, `sell`, `div`)
  - `buy`: creates a new `purchase` lot for `quantity` shares at `price`
  - `div`: creates a new `dividend` lot (reinvested shares); does not affect available cash
  - `sell`: **requires** a body field `allocations: [{ lotId, quantity }, ...]` whose quantities sum to the sale `quantity`. The API validates each referenced lot belongs to the user/ticker and has enough remaining shares, then decrements each lot's `remainingQuantity` and writes a `LotAllocations` audit row per lot. There is no default/automatic lot selection - the caller must explicitly choose which lot(s) to consume. Requests missing or mismatched allocations are rejected with `400`.
- `PUT /api/stocks/:id` - Update stock transaction
- `DELETE /api/stocks/:id` - Delete stock transaction

### Lots
- `GET /api/lots` - Get all lots
- `GET /api/lots/:ticker` - Get lots for ticker with `remainingQuantity > 0`. Supports an optional `?sourceType=purchase` or `?sourceType=dividend` query filter to scope the results to just purchase lots or just dividend lots.
- `PUT /api/lots/:id` - Update lot (adjust remaining quantity)
- `POST /api/lots/:ticker/split` - Apply a stock split. Body: `{ multiplier, splitDate }`. Inserts a `StockSplits` audit row, then for every lot/transaction on or before `splitDate`: multiplies `quantity`/`originalQuantity`/`remainingQuantity` by `multiplier`, divides `price`/`unitCost` by `multiplier` (so cost basis is unchanged), and sets `splitAdjusted = true` with `lastSplitId` pointing at the new split record.

## Authentication

Currently runs in development mode with `x-user-id` header or `Authorization: Bearer` token support.

For production, configure Auth0 domain and audience in `.env.local`:

```env
AUTH0_DOMAIN=your-domain.auth0.com
AUTH0_AUDIENCE=your-api-identifier
```

## Scripts

- `npm run dev` - Start development server with watch mode
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run compiled server
- `npm run seed` - (Future) Seed database with sample data
# GitHub write access verified 2026-07-05T20:43:01Z
