# Test Scenarios Documentation

## Core Concepts

### Display Lots vs Source Lots Architecture
- **Source Lots**: Automatically created by stock transactions. Two types:
  - **Purchase Lots**: Created from stock buys (tracks cost basis)
  - **Dividend Lots**: Created from dividend reinvestments (tracks cost basis)
- **Display Lots**: User-created organizational views to determine target purchase price. Users can combine, split, and reorganize them.
  - More lots = lower target price (more diversified)
  - Fewer lots = higher target price (more concentrated)
- **Invariant**: Sum of all display lot shares = Sum of all Purchase Lot shares (Dividend Lots don't count toward display lots)
- **Sales**: Can allocate consumption to Source Lots in any order, but display lots consume smallest-to-largest
- **Dividends**: Create Dividend Lots but do NOT affect display lots


### Transaction Entry
- **Purchase**: date, # of shares, price.  Cost is calculated from shares * price
- **Sale**: date, # of shares, price, source lot allocation.  Cost is calculated from shares * price
- **Dividend**: date, # of shares, cost.  Price is calculated from cost / shares
---

## Necessary Tests for Workflow Coverage

### Foundation: Core Transaction Workflows

#### 1. Cash Management Workflow
**Purpose**: Verify cash tracking through deposits, withdrawals, and transactions
**Test Coverage**:
- Deposit and withdrawal transactions
- Available cash calculation after transactions
- Interest and fee calculations
- Cash balance after stock purchases and sales

#### 2. Stock Purchase Workflow
**Purpose**: Verify stock buys create Purchase Lots correctly
**Test Coverage**:
- Single stock purchase creates one Purchase Lot and One Display Lot
- Multiple purchases of same ticker create separate Purchase and Display Lots
- Purchase Lot captures quantity, price, and date (cost basis)
- Cash reduced correctly by purchase amount
- Purchase Lots are immediately available for display lot composition

#### 3. Stock Dividend Workflow
**Purpose**: Verify dividend shares create Dividend Lots independent from Purchase Lots
**Test Coverage**:
- Dividend transaction creates Dividend Lot (not a Purchase Lot)
- Dividend Lots don't affect display lot totals
- Dividend Lots can be sold independently
- Multiple dividends create separate Dividend Lots

#### 4. Stock Sale Workflow
**Purpose**: Verify sales consume Source Lots correctly and affect display lots properly
**Test Coverage**:
- Sale with explicit Source Lot allocation consumes exact amount specified
- Sale can allocate across multiple Source Lots (Purchase + Dividend mix)
- Only Purchase Lot consumption reduces related Display Lots
- Dividend Lot consumption doesn't affect Display Lots
- Cash increased correctly by sale proceeds
- Sold-out Source Lots are marked/deleted appropriately

#### 5. Stock Split Workflow
**Purpose**: Verify splits adjust all affected Source Lots retroactively
**Test Coverage**:
- Stock split applies to all users holding the ticker
- Split ratio adjusts Source Lot quantities (2:1 split doubles shares)
- Split retroactively adjusts share number and price, cost basis should stay the same
- Split retro actively adjusts display lots, so display lot share total stay in sync with Purchase Lots
- Split record created for audit trail
- Sequential splits compound correctly (2:1 then 3:1 = 6:1 total)

---

## Necessary Tests for Display Lots Feature

### Display Lot Lifecycle Tests

#### 6. Display Lot Creation
**Purpose**: Verify Display Lots can be created to organize purchase strategy
**Test Coverage**:
- Create Display Lot from single Purchase Lot
- Create Display Lot from multiple Purchase Lots
- Create Display Lot from mixed Purchase + Dividend Lots (only Purchase Lots count)
- Display Lot total quantity = sum of Purchase Lot allocations (excluding Dividend Lots)
- Display Lot tracks quantity for price target calculation

#### 7. Display Lot Combine
**Purpose**: Verify multiple Display Lots can merge to adjust target purchase price
**Test Coverage**:
- Combine two Display Lots merges into single lot
- Combined Display Lot has correct total quantity
- Cannot combine Display Lots of different tickers
- Error on combine with non-existent Display Lot

#### 8. Display Lot Split
**Purpose**: Verify Display Lot can split into multiple smaller Display Lots to adjust target price
**Test Coverage**:
- Split 10-share Display Lot into 6 and 4 shares
- Split quantities validate (must sum to original total)
- Error on invalid quantity distributions
- Multiple splits from single Display Lot work independently

#### 9. Display Lot Auto-Deletion
**Purpose**: Verify empty Display Lots are cleaned up after sales
**Test Coverage**:
- Create 5-share Display Lot from Purchase Lot
- Sell all 5 shares from Purchase Lot
- Display Lot automatically deleted (or marked empty)
- No orphaned 0-quantity Display Lots remain

#### 10. Display Lot Smallest-First Consumption
**Purpose**: Verify sales consume Display Lots in smallest-to-largest order
**Test Coverage**:
- Create 3 Display Lots: 1 share, 1 share, 5 shares (from separate Purchase Lots)
- Sale of 2 shares consumes both 1-share Display Lots
- Sale of 1 more share consumes first share of 5-share Display Lot
- Remaining Display Lot has 4 shares
- Verify Purchase Lots consumed in any order, but Display Lots always smallest-first

### Display Lot Invariant Tests

#### 11. Display Lot Invariant Maintenance
**Purpose**: Verify sum of Display Lots = sum of Purchase Lots always
**Test Coverage**:
- After purchase: display lot total = purchase lot total
- After sale: display lot total = remaining purchase lot total
- After combine: totals still equal
- After split: totals still equal
- After dividend (no impact): display lot total unchanged, purchase lots increased

#### 12. Dividend Isolation From Display Lots
**Purpose**: Verify Dividend Lots never affect Display Lot totals
**Test Coverage**:
- Create Display Lot from Purchase Lot (10 shares)
- Receive Dividend (5 shares, creates Dividend Lot)
- Display Lot still shows 10 shares (not 15)
- Sale: consume 5 from Purchase, 3 from Dividend
- Display Lot reduces to 5 (only Purchase Lot consumption matters)
- Dividend Lot reduces to 2 (independent of Display Lot)

### Display Lot Query & State Tests

#### 13. Display Lot Queries
**Purpose**: Verify Display Lots can be queried correctly with full details
**Test Coverage**:
- GET all Display Lots for user by ticker
- GET specific Display Lot by ID with full composition
- Composition shows Source Lot IDs and quantities
- Response includes Display Lot total quantity, creation date
- Correct ordering (by ticker, then by creation date)

#### 14. Display Lot State After Transaction Deletion
**Purpose**: Verify Display Lots and Source Lots restore correctly when sales are reversed
**Test Coverage**:
- Create Display Lot with 10 shares from Purchase Lot
- Sell 3 shares (Display Lot becomes 7, consumed from Purchase Lot)
- Delete sale transaction
- Source Lot allocations restored (3 shares available again)
- Display Lot creates a NEW 3-share lot (instead of restoring original composition)
- Total Display Lot shares returns to 10 (7 original + 3 new)

### Display Lot Error Handling Tests

#### 15. Display Lot Error Cases
**Purpose**: Verify proper error handling for invalid Display Lot operations
**Test Coverage**:
- Combine with non-existent Display Lot ID → 404/400
- Combine across different tickers → 400
- Split with mismatched quantities (9 instead of 10) → 400
- Split with quantity > total → 400
- Create Display Lot with non-existent Source Lot ID → 400/404
- Query non-existent Display Lot → 404

---

## Necessary Tests for Edge Cases & Scale

#### 16. Display Lot Edge Cases
**Purpose**: Verify Display Lots behave correctly in unusual scenarios
**Test Coverage**:
- Display Lot with 0.01 shares (floating point precision)
- Display Lot with 1000+ shares (large quantity)
- Display Lot composed from 10+ Source Lots
- Sequential sales from same Display Lot (multiple transactions)
- Fractional shares after dividends

#### 17. Large-Scale Display Lot Operations
**Purpose**: Verify performance and correctness with many Display Lots
**Test Coverage**:
- Create 20+ Display Lots for same ticker
- Combine operation on distant Display Lots (1st with 20th)
- Query performance with many Display Lots
- Order maintenance after operations

---

## Implementation Notes

### Key Validations to Test
- Display lots never exceed Purchase Lot total in quantity
- Smallest-first consumption is truly smallest-first across multiple display lots
- When sales are deleted, new lots are created for the returned shares
- Cascade deletions don't leave orphaned records
- Foreign key constraints are properly enforced
- Dividend Lots and Display Lots remain isolated from each other

### Test Utilities Needed
- Helper to create N Source Lots (Purchase or Dividend type) with specific quantities
- Helper to verify composition matches expected structure and source lot types
- Helper to verify smallest-first consumption order
- Helper to query and validate total quantities match invariant (Purchase Lots only)
- Helper to verify Display Lots don't include Dividend Lot quantities
