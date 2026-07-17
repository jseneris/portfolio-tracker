# Test Scenarios Documentation

## Core Concepts

### Display Lots vs Source Lots Architecture
- **Source Lots**: Automatically created by stock transactions. Two types:
  - **Purchase Lots**: Created from stock buys
  - **Dividend Lots**: Created from dividend reinvestments
- **Display Lots**: User-created organizational views composed from Source Lots. Users can combine, split, and reorganize them.
- **Invariant**: Sum of all display lot shares = Sum of all Purchase Lot shares (Dividend Lots don't count toward display lots)
- **Sales**: Can allocate consumption to Source Lots in any order, but display lots consume smallest-to-largest
- **Dividends**: Create Dividend Lots but do NOT affect display lots

---

## Existing Test Scenarios

### Cash Management (`cash.test.ts`)
✅ **PASSING**
- Creates a cash transaction
- Retrieves saved cash transactions
- Tracks available cash and cost basis through deposits, withdrawals, interest and fees

### Stock Purchases (`stock-purchases.test.ts`)
✅ **PASSING**
- Tracks available cash and creates a lot for a stock purchase

### Multiple Purchases (`stock-multiple-purchase.test.ts`)
✅ **PASSING**
- Creates a separate lot for each purchase of the same ticker

### Stock Dividends (`stock-dividend.test.ts`)
✅ **PASSING**
- Applies a reinvested dividend without disturbing existing Purchase Lots

### Stock Sales - Basic (`stock-sale.test.ts`)
✅ **PASSING**
- Sells shares against a user-chosen Source Lot and updates available cash

### Stock Sales - Partial Lot (`stock-sale-partial-lot.test.ts`)
✅ **PASSING**
- Reduces one lot, but does not close any
- Consumes 2 lots leaving one open

### Stock Sales - Smallest Lot First (`stock-sale-smallest-lot-first.test.ts`)
✅ **PASSING**
- Fully closes one lot for a 4-share sale across three 4-share lots (even with spread allocations)
- Consumes smallest lots first: 1,1,2,3 sold by 2 leaves only 2 and 3 lots open

### Stock Sales - Non-LIFO (`stock-non-lifo-sale.test.ts`)
✅ **PASSING**
- Consumes open lots smallest-to-largest while preserving user-directed buy attribution

### Stock Sales - With Dividend (`stock-sale-with-dividend.test.ts`)
✅ **PASSING**
- Sells across Source Lots while leaving the Dividend Lot untouched

### Stock Sales - Of Dividend (`stock-sale-of-dividend.test.ts`)
✅ **PASSING**
- Allows a sale to consume shares out of the Dividend Lot as well as Purchase Lots

### Stock Splits (`stock-split.test.ts`)
✅ **PASSING**
- Applies a 2-for-1 split retroactively while preserving cost basis and flagging affected records

### Stock Splits - Global & Sequential (`stock-split-global-and-sequential.test.ts`)
✅ **PASSING**
- Applies a split across all users who hold the ticker
- Applies sequential splits correctly

### Display Lot Combine (`lot-combine.test.ts`)
✅ **PASSING**
- Combines two 1-share display lots into a single 2-share lot
- Rejects combine across different tickers

### Display Lot Split (`lot-split.test.ts`)
✅ **PASSING**
- Splits a 3-share display lot into 2 and 1
- Splits a 3-share display lot into 1, 1, and 1
- Rejects split when quantities do not sum to display lot total

### Display Lots - Advanced (`display-lots.test.ts`)
✅ **PASSING**
- Creates a display lot from a single Source Lot
- Creates a display lot from multiple Source Lots
- Maintains invariant: sum of display lot totals equals sum of Purchase Lot remaining quantities
- Restores display lot quantities when a sale transaction is deleted
- Ensures allocation records are deleted by cascade when transaction is deleted

### Stock Sale After Split (`stock-sale-after-split.test.ts`)
✅ **MOSTLY PASSING** (1/3 tests)
- ✅ Sells with explicit Source Lot allocations while consuming smallest display lots first
- ❌ Automatically rescales display lots when a stock split occurs on underlying Purchase Lots
- ❌ Only Purchase Lot quantity consumed affects display lots when selling with mixed Purchase and Dividend allocations

### Portfolio Summary (`portfolio-summary.test.ts`)
✅ **PASSING**
- Returns cash summary and stock list details from a single endpoint call

### Database CRUD (`table-crud.test.ts`)
✅ **PASSING**
- Writes to CashTransactions, StockTransactions (buy/sell), StockSplits, Lots, LotAllocations, SplitAdjustments
- Reads from all above tables
- Deletes from all above tables

### Database Hardening (`db-p0-hardening.test.ts`)
✅ **PASSING**
- Creates schema migration tracking table and records P0 migration key
- Creates required composite, filtered, and unique indexes
- Enforces stock split uniqueness on ticker + ratio + splitDate

---

## Proposed Test Scenarios

### Priority 1: Display Lot Lifecycle & Composition

#### 1️⃣ Display Lot Auto-Deletion When Fully Sold
**Status**: NOT IMPLEMENTED
**File**: `display-lots-lifecycle.test.ts`
**Scenario**:
- Create 10-share Purchase Lot and display lot
- Sell all 10 shares explicitly from the Purchase Lot
- Verify display lot is automatically deleted

**Why Important**: Ensures cleanup and no orphaned display lots in the system

---

#### 2️⃣ Display Lot With Multiple Source Lots (Complex Composition)
**Status**: NOT IMPLEMENTED
**File**: `display-lots-complex-composition.test.ts`
**Scenario**:
- Create 3 separate purchases: 2 shares, 3 shares, 5 shares (10 total)
- Create ONE display lot from all three Purchase Lots: `[PL1: 2, PL2: 3, PL3: 5]`
- Query display lot composition and verify all three allocations are preserved
- Sell 6 shares with explicit allocation: 2 from PL1, 2 from PL2, 2 from PL3
- Verify display lot reduces to 4 (NOT 6), because only Purchase Lot consumption matters
- Verify smallest display lot consumption would apply if multiple display lots existed

**Why Important**: Tests core invariant that display lots track Purchase Lot consumption, not total shares sold

---

#### 3️⃣ Combining Display Lots With Different Source Lot Compositions
**Status**: PARTIAL (basic combine exists, but not with complex compositions)
**File**: `display-lots-combine-complex.test.ts`
**Scenario**:
- Display lot A: `[PL1: 5 shares]` (from Purchase Lot 1)
- Display lot B: `[PL2: 3 shares]` (from Purchase Lot 2)
- Combine A + B
- Verify result has composition: `[PL1: 5, PL2: 3]`
- Verify merged display lot references both original Purchase Lots correctly

**Why Important**: Ensures composition merging logic is correct; tests data integrity during combine

---

#### 4️⃣ Splitting Display Lot With Mixed Composition
**Status**: NOT IMPLEMENTED
**File**: `display-lots-split-complex.test.ts`
**Scenario**:
- Create 2 Purchase Lots: PL1 (6 shares), PL2 (4 shares)
- Create display lot from both: `[PL1: 6, PL2: 4]` = 10 total
- Split into two display lots: 6 shares and 4 shares
- Verify split A gets: `[PL1: 6, PL2: 0]` OR `[PL1: 6]`
- Verify split B gets: `[PL2: 4]` OR `[PL1: 0, PL2: 4]`
- Verify composition allocations are proportionally distributed

**Why Important**: Tests that splitting preserves composition structure and doesn't lose Source Lot references

---

#### 5️⃣ Multiple Sequential Sales From Same Display Lot (Smallest-First)
**Status**: PARTIAL (single sale exists, not sequential)
**File**: `display-lots-sequential-sales.test.ts`
**Scenario**:
- Create 3 Purchase Lots: 1, 1, 5 shares each
- Create 3 display lots from each: DL1 (1), DL2 (1), DL3 (5)
- Sell 2 shares → verify DL1 fully consumed, DL2 fully consumed
- Sell 1 share → verify first share of DL3 consumed (3 left in DL3)
- Sell 3 shares → verify DL3 has 0 left and is deleted (or marked empty)
- Verify Purchase Lots were consumed in any order but display lots smallest-first

**Why Important**: Tests cumulative smallest-first behavior over multiple transactions; tests auto-deletion on empty

---

### Priority 2: Display Lot with Dividends

#### 6️⃣ Dividend Lots Don't Affect Display Lots
**Status**: NOT IMPLEMENTED
**File**: `display-lots-dividend-isolation.test.ts`
**Scenario**:
- Buy 10 shares of AAPL (creates Purchase Lot PL_buy with 10 shares)
- Receive dividend 5 shares (creates Dividend Lot DL_div with 5 shares)
- Create display lot from only the Purchase Lot: `[PL_buy: 10]`
- Sell 8 total shares with allocation: `[PL_buy: 5, DL_div: 3]`
- Verify Purchase Lot reduced to 5 (10 - 5)
- Verify Dividend Lot reduced to 2 (5 - 3)
- **CRITICAL**: Verify display lot reduced to 5 (NOT 2), because only Purchase Lot consumption matters
- Display lot tracks Purchase Lot consumption exclusively; Dividend Lots are independent

**Why Important**: Validates the fundamental invariant that Dividend Lots are independent from display lots

---

### Priority 3: Display Lot Queries & Details

#### 7️⃣ Get Display Lot By ID With Full Composition Details
**Status**: PARTIAL (basic ID query might exist)
**File**: `display-lots-query-details.test.ts`
**Scenario**:
- Create display lot from multiple Source Lots (Purchase and/or Dividend)
- `GET /api/display-lots/{id}` with full composition response
- Verify response includes:
  - `id`, `ticker`, `totalQuantity`, `createdAt`, `updatedAt`
  - `composition: [{ sourceLotId, sourceLotType, quantityAllocated }, ...]`
- Verify composition array has correct order and allocations
- Verify sourceLotType indicates whether source is from Purchase or Dividend

**Why Important**: Ensures full display lot details are queryable, not just summaries

---

### Priority 4: Error Handling & Validation

#### 8️⃣ Error Case: Combine Non-Existent Display Lots
**Status**: NOT IMPLEMENTED
**File**: `display-lots-error-cases.test.ts`
**Scenario**:
- Try to combine display lot with non-existent display lot ID
- Verify 404 or 400 error returned

**Why Important**: API robustness

---

#### 9️⃣ Error Case: Split With Mismatched Quantities
**Status**: PARTIAL (one validation exists)
**File**: `display-lots-error-cases.test.ts`
**Scenario**:
- Create 10-share display lot
- Try to split with `[6, 3]` (total 9, not 10)
- Try to split with `[6, 6]` (total 12, not 10)
- Try to split with one quantity > total
- Verify 400 error in all cases

**Why Important**: Input validation

---

#### 🔟 Error Case: Create Display Lot From Non-Existent Source Lots
**Status**: NOT IMPLEMENTED
**File**: `display-lots-error-cases.test.ts`
**Scenario**:
- Try to create display lot with non-existent sourceLotId
- Verify 400 or 404 error

**Why Important**: API robustness

---

### Priority 5: Edge Cases & Scale

#### 1️⃣1️⃣ Display Lot With 0 Shares After Sale
**Status**: NOT IMPLEMENTED
**File**: `display-lots-edge-cases.test.ts`
**Scenario**:
- Create 5-share display lot
- Sell 5 shares from all related Purchase Lots
- Verify display lot is deleted (not left with 0 shares)

**Why Important**: Ensures no orphaned zero-quantity display lots

---

#### 1️⃣2️⃣ Large Number of Display Lots For Same Ticker
**Status**: NOT IMPLEMENTED
**File**: `display-lots-scale.test.ts`
**Scenario**:
- Create 20+ display lots for same ticker
- Verify queries don't timeout
- Verify combine operation on lot 1 with lot 20 works correctly
- Verify order is maintained (by createdAt)

**Why Important**: Performance validation

---

## Test Matrix: Comprehensive Coverage

| Feature | Basic | Complex | With Dividends | Error Cases | Passing |
|---------|-------|---------|-----------------|------------|---------|
| **Display Lot Create** | ✅ | ✅ | N/A | ❌ | 2/3 |
| **Display Lot Query** | ✅ | ❌ | N/A | ❌ | 1/3 |
| **Display Lot Combine** | ✅ | ❌ | N/A | ❌ | 1/3 |
| **Display Lot Split** | ✅ | ❌ | N/A | ❌ | 1/3 |
| **Display Lot Delete** | ❌ | ❌ | N/A | ❌ | 0/3 |
| **Sales with Display Lots** | ✅ | ❌ | ❌ | ❌ | 1/4 |
| **Display Lot Invariant** | ✅ | ❌ | ❌ | ❌ | 1/3 |

---

## Implementation Priority

**Phase 1 (Critical - Core Behavior)**
1. Display Lot Auto-Deletion When Fully Sold
2. Display Lot With Multiple Source Lots (Complex Composition)
3. Multiple Sequential Sales From Same Display Lot
4. Dividend Lots Don't Affect Display Lots

**Phase 2 (Important - Data Integrity)**
5. Combining Display Lots With Different Source Lot Compositions
6. Splitting Display Lot With Mixed Composition
7. Get Display Lot By ID With Full Composition Details

**Phase 3 (Robustness - Error Handling)**
8. Error Cases: Non-existent lots, mismatched quantities, invalid references
9. Edge Cases: Zero-quantity lots, large-scale operations

**Phase 4 (Performance)**
10. Large Number of Display Lots For Same Ticker

---

## Notes for Implementation

### Key Validations to Test
- Display lots never exceed Purchase Lot total in quantity
- Composition allocations are never lost or duplicated during combine/split
- Smallest-first consumption is truly smallest-first across multiple display lots
- Cascade deletions don't leave orphaned records
- Foreign key constraints are properly enforced
- Dividend Lots and Display Lots remain isolated from each other

### Test Utilities Needed
- Helper to create N Source Lots (Purchase or Dividend type) with specific quantities
- Helper to verify composition matches expected structure and source lot types
- Helper to verify smallest-first consumption order
- Helper to query and validate total quantities match invariant (Purchase Lots only)
- Helper to verify Display Lots don't include Dividend Lot quantities
