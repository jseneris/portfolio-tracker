---
applyTo: "stock-tracker-backend/src/routes/**/*.ts"
excludeAgent: "code-review"
---

# API Endpoints

All endpoints require `x-user-id` header or Bearer token for authentication. Response format is JSON.

---

## Cash Endpoints

### GET /api/cash
Get all cash transactions for authenticated user.

**Response:** Array of cash transactions
```json
[
  {
    "id": "uuid",
    "userId": "user-id",
    "type": "deposit|withdrawal|interest|fee",
    "amount": 1000.00,
    "transactionDate": "2026-01-15T00:00:00Z",
    "createdAt": "2026-01-15T10:30:00Z",
    "updatedAt": "2026-01-15T10:30:00Z"
  }
]
```

---

### GET /api/cash/summary
Get cash summary: deposits, withdrawals, interest, fees, stock buys/sells, available cash.

**Response:**
```json
{
  "deposits": 10000.00,
  "withdrawals": 0,
  "interest": 50.00,
  "fees": 25.00,
  "buys": 5000.00,
  "sells": 2000.00,
  "availableCash": 7025.00,
  "costBasis": 10000.00,
  "adjustments": 25.00
}
```

---

### POST /api/cash
Create a new cash transaction.

**Request Body:**
```json
{
  "type": "deposit|withdrawal|interest|fee",
  "amount": 1000.00,
  "transactionDate": "2026-01-15T00:00:00Z"
}
```

**Response:** 201 Created with transaction object

---

## Stock Endpoints

### GET /api/stocks/portfolio/summary
Get complete portfolio summary: cash info + stock holdings rollup in one call.

**Response:**
```json
{
  "deposits": 10000.00,
  "withdrawals": 0,
  "interest": 50.00,
  "fees": 25.00,
  "buys": 5000.00,
  "sells": 2000.00,
  "availableCash": 7025.00,
  "cashBasis": 10000.00,
  "adjustments": 25.00,
  "totalStockCostBasis": 5000.00,
  "stockCount": 2,
  "stocks": [
    {
      "ticker": "AAPL",
      "totalShares": 50,
      "totalCostBasis": 3000.00,
      "avgCostPerShare": 60.00
    }
  ]
}
```

---

### GET /api/stocks/holdings
Get all stock holdings organized by ticker, showing only open positions.

**Response:** Array of holdings by ticker
```json
[
  {
    "ticker": "AAPL",
    "totalShares": 50,
    "totalCostBasis": 3000.00,
    "avgCostPerShare": 60.00,
    "lotCount": 2
  }
]
```

---

### GET /api/stocks/:ticker
Get all transactions for a specific ticker (buy, sell, dividend).

**Query Parameters:**
- `type`: Optional filter by `buy`, `sell`, or `div`

**Response:** Array of transactions
```json
[
  {
    "id": "uuid",
    "userId": "user-id",
    "ticker": "AAPL",
    "type": "buy|sell|div",
    "quantity": 10,
    "price": 150.00,
    "amount": 1500.00,
    "transactionDate": "2026-01-15T00:00:00Z",
    "createdAt": "2026-01-15T10:30:00Z"
  }
]
```

---

### POST /api/stocks
Create a new stock transaction (buy, sell, or dividend).

**Request Body (Buy):**
```json
{
  "ticker": "AAPL",
  "type": "buy",
  "quantity": 10,
  "price": 150.00,
  "transactionDate": "2026-01-15T00:00:00Z"
}
```

**Request Body (Sell with explicit lot allocation):**
```json
{
  "ticker": "AAPL",
  "type": "sell",
  "quantity": 5,
  "price": 160.00,
  "transactionDate": "2026-01-20T00:00:00Z",
  "allocations": [
    {
      "lotId": "purchase-lot-uuid",
      "quantity": 5
    }
  ]
}
```

**Request Body (Dividend):**
```json
{
  "ticker": "AAPL",
  "type": "div",
  "quantity": 2,
  "amount": 100.00,
  "transactionDate": "2026-01-25T00:00:00Z"
}
```

**Response:** 201 Created with transaction object and created lot(s)

---

### POST /api/stocks/split
Record a stock split event. Retroactively adjusts all affected transactions and lots.

**Request Body:**
```json
{
  "ticker": "AAPL",
  "ratioNumerator": 2,
  "ratioDenominator": 1,
  "splitDate": "2026-01-15T00:00:00Z"
}
```

**Response:** 201 Created
```json
{
  "id": "split-uuid",
  "ticker": "AAPL",
  "ratio": "2-for-1",
  "multiplier": 2,
  "splitDate": "2026-01-15T00:00:00Z",
  "lotsAdjusted": 5,
  "transactionsAdjusted": 8
}
```

---

### DELETE /api/stocks/:transactionId
Delete a stock transaction and reverse its allocations.

**Response:** 200 OK with reversal details

---

## Purchase Lots Endpoints

### GET /api/lots
Get all purchase lots (open and closed) for authenticated user.

**Response:** Array of purchase lots
```json
[
  {
    "id": "lot-uuid",
    "userId": "user-id",
    "ticker": "AAPL",
    "transactionId": "tx-uuid",
    "sourceType": "purchase|dividend",
    "originalQuantity": 10,
    "remainingQuantity": 7,
    "unitCost": 150.00,
    "purchaseDate": "2026-01-15T00:00:00Z",
    "splitAdjusted": false,
    "createdAt": "2026-01-15T10:30:00Z"
  }
]
```

---

### GET /api/lots/:ticker
Get all purchase lots for a specific ticker.

**Query Parameters:**
- `openOnly`: Set to `true` to return only lots with `remainingQuantity > 0`

**Response:** Array of purchase lots

---

### GET /api/lots/:ticker/open
Get all open (unconsumed) purchase lots for a ticker.

**Response:** Array of purchase lots with remainingQuantity > 0

---

## Display Lots Endpoints

### GET /api/display-lots
Get all display lots for authenticated user.

**Response:** Array of display lots
```json
[
  {
    "id": "display-lot-uuid",
    "userId": "user-id",
    "ticker": "AAPL",
    "totalQuantity": 20,
    "createdAt": "2026-01-20T10:30:00Z",
    "updatedAt": "2026-01-20T10:30:00Z"
  }
]
```

---

### GET /api/display-lots/ticker/:ticker
Get all display lots for a specific ticker.

**Response:** Array of display lots for ticker, ordered by totalQuantity (smallest-first)

---

### GET /api/display-lots/:id/composition
Get the composition (purchase lot allocations) of a specific display lot.

**Response:**
```json
[
  {
    "id": "composition-row-uuid",
    "purchaseLotId": "lot-uuid",
    "quantityAllocated": 10,
    "ticker": "AAPL",
    "unitCost": 150.00,
    "sourceType": "purchase|dividend",
    "purchaseDate": "2026-01-15T00:00:00Z"
  }
]
```

---

### POST /api/display-lots/:ticker
Create a new display lot from purchase lots.

**Request Body:**
```json
{
  "composition": [
    {
      "purchaseLotId": "purchase-lot-uuid-1",
      "quantityAllocated": 10
    },
    {
      "purchaseLotId": "purchase-lot-uuid-2",
      "quantityAllocated": 10
    }
  ]
}
```

**Response:** 201 Created
```json
{
  "id": "new-display-lot-uuid",
  "ticker": "AAPL",
  "totalQuantity": 20,
  "compositionCount": 2
}
```

---

### POST /api/display-lots/:id/combine
Combine multiple display lots into one.

**Request Body:**
```json
{
  "displayLotIds": [
    "display-lot-uuid-1",
    "display-lot-uuid-2"
  ]
}
```

**Response:** 201 Created
```json
{
  "id": "new-combined-display-lot-uuid",
  "ticker": "AAPL",
  "totalQuantity": 30,
  "mergedFromCount": 2
}
```

---

### POST /api/display-lots/:id/split
Split a display lot into multiple smaller display lots.

**Request Body:**
```json
{
  "splits": [
    {
      "quantityAllocated": 10
    },
    {
      "quantityAllocated": 10
    },
    {
      "quantityAllocated": 10
    }
  ]
}
```

**Response:** 201 Created
```json
{
  "id": "original-display-lot-uuid",
  "newDisplayLotIds": [
    "new-display-lot-uuid-1",
    "new-display-lot-uuid-2",
    "new-display-lot-uuid-3"
  ],
  "splitsCreated": 3
}
```

---

### DELETE /api/display-lots/:id
Delete a display lot.

**Response:** 200 OK

---

## Error Handling

All endpoints return error responses in this format:

```json
{
  "error": "Description of the error"
}
```

**Common HTTP Status Codes:**
- `400`: Bad Request (validation error)
- `404`: Not Found (resource doesn't exist)
- `500`: Internal Server Error (database or unexpected error)

---

## Authentication

All endpoints require one of:
1. `x-user-id` header with user identifier
2. `Authorization: Bearer <token>` header (token content ignored in dev, validated in production)

Example:
```bash
curl -X GET http://localhost:5000/api/cash \
  -H "x-user-id: test-user-12345"
```

---

## Notes

- All monetary amounts use `DECIMAL` precision (18 digits, 4 decimal places)
- All share quantities use `DECIMAL(18,8)` precision for stock split accuracy
- Timestamps are in UTC, ISO 8601 format
- Display lots consume in smallest-first order when sales are recorded
- Stock splits retroactively adjust all affected quantities and prices
