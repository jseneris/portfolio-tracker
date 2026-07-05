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
- **multiplier**: For stock splits
- **transactionDate**: Date of transaction
- **createdAt/updatedAt**: Timestamps
- **splitAdjusted**: flag to indicate if affected by stock split 
- **lastSplitId**: Foriegn Key to Split Info

### Lots
- **id**: Unique identifier
- **userId**: User identifier
- **ticker**: Stock ticker symbol
- **transactionId**: Reference to buy transaction
- **soureceType**: 
- **originalQuantity**: Initial shares purchased
- **remainingQuantity**: Current shares in lot
- **unitCost**: Cost per share
- **purchaseDate**: Date lot was acquired
- **createdAt/updatedAt**: Timestamps
- **splitAdjusted**: flag to indicate if affected by stock split 
- **lastSplitId**: Foriegn Key to Split Info

### LotAllocations

### StockSplits

## API Endpoints

### Cash Transactions
- `GET /api/cash` - Get all cash transactions
- `GET /api/cash/summary` - Get cash summary (deposits, withdrawals, interest, fees)
- `POST /api/cash` - Create cash transaction
- `PUT /api/cash/:id` - Update cash transaction
- `DELETE /api/cash/:id` - Delete cash transaction

### Stock Transactions
- `GET /api/stocks` - Get all stock transactions
- `GET /api/stocks/:ticker` - Get transactions for ticker
- `GET /api/stocks/:ticker/summary` - Get ticker summary
- `POST /api/stocks` - Create stock transaction
- `PUT /api/stocks/:id` - Update stock transaction
- `DELETE /api/stocks/:id` - Delete stock transaction

### Lots
- `GET /api/lots` - Get all lots
- `GET /api/lots/:ticker` - Get lots for ticker
- `PUT /api/lots/:id` - Update lot (adjust remaining quantity)
- `POST /api/lots/:ticker/split` - Apply stock split

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
