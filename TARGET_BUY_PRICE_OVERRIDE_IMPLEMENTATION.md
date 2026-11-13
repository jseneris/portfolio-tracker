# Target Buy Price Override Feature - Implementation Complete

## Summary

This feature has been successfully implemented and tested. It allows portfolio tracker users to override the default purchase price calculation with a custom target buy price per ticker. This is especially useful when the base purchase size at the current market price would not result in enough shares to exceed the portfolio's smallest display lot size.

## What's New

### 1. **Target Buy Price Override Field**
- Users can now set a custom purchase price for any ticker
- Stored per-ticker in user preferences
- Optional field (defaults to null when not set)
- Displayed on the dashboard with a 💰 badge indicator

### 2. **Suggested Override Calculation**
- The system suggests a price that would result in more shares than the smallest display lot
- The suggested price is `basePurchaseSize / (floor(smallestDisplayLotShares) + 1)`, rounded down to eight-decimal price precision.
- Selecting the override prefills the input with the suggestion when available.

### 3. **Insufficient Shares Banner**
- New warning banner for stock pages
- Shows when base purchase size won't buy more shares than the smallest display lot
- Uses the saved override when active, otherwise the calculated buy target.
- The warning is collapsed by default.

### 4. **Dashboard Integration**
- 💰 badge indicates when override is active; a red `!` indicates an insufficient buy target.
- Tooltip shows the override price
- Works alongside existing buy on dip and restriction badges

## Technical Implementation

### Database Changes
```sql
ALTER TABLE UserTickerPreferences 
ADD targetBuyPriceOverride DECIMAL(18,8) NULL;
```

### Backend API
- **PUT /api/ticker-preferences/:ticker**
  - Accepts: `targetBuyPriceOverride` (number or null)
  - Validates: Must be positive, within range 0.00000001-9999999999.99
  - Returns: Full preference object including new field

- **GET /api/ticker-preferences**
  - Returns all preferences with `targetBuyPriceOverride`

- **GET /api/ticker-preferences/:ticker**
  - Returns single preference with `targetBuyPriceOverride` (null if no override set)

### Frontend Components

#### Components
1. **StockHistoryPage** (`src/pages/StockHistoryPage.tsx`) contains the ticker settings form.
2. **InsufficientSharesBanner** (`src/pages/InsufficientSharesBanner.tsx`) displays a collapsible warning and share calculation.

#### Modified Components
1. **tickerBadges.tsx**
   - Updated `getTickerInfoBadges()` to show 💰 badge when override is set
   - Shared target calculations and lot comparisons live in `targetPrices.ts`.

2. **DashboardPage.tsx**
   - Updated ticker badge rendering to include override field

#### Test Updates
- All test fixtures updated to include `targetBuyPriceOverride` field
- New tests for override functionality in backend tests

## Testing

### Backend Tests ✅
All 20 tests in `22-user-ticker-preferences.test.ts` pass:
- ✅ Returns defaults when no preference exists
- ✅ Persists and updates override values
- ✅ Keeps other preferences intact when updating
- ✅ Rejects invalid override values
- ✅ Accepts valid override values
- ✅ Isolates preferences by user
- ✅ And 14 more existing tests (all passing)

### Frontend Type Checking ✅
- TypeScript compilation successful
- All component types properly defined
- No type errors in tests

### Frontend Build ✅
- Production build successful
- All 67 modules compile and minify correctly
- Ready for deployment

## Usage Guide

### For End Users

#### Setting a Target Buy Price Override
1. Open a ticker from the dashboard, then click the **...** settings button.
2. Select **Target Buy Price Override** and enter or accept the suggested price.
3. Click **Save Preferences**.

#### Dashboard Display
- When override is set, a 💰 badge appears beside Buy Target, or beside the ticker on small screens.
- An insufficient target is marked with a red `!` badge.
- Hover to see the override price

#### Stock Page Display
- If the effective buy target won't result in sufficient shares, a collapsible warning appears.
- Shows:
  - Buy target and resulting shares
  - Smallest display lot size for comparison
  - Whether the price is an override

### For Developers

#### UI Integration
The stock page renders `InsufficientSharesBanner` with the effective buy target and smallest individual lot. The dashboard uses the same shared comparison, and the alert service applies the stored override to buy alerts.

#### API Usage
```typescript
// Update preference with override
await updateTickerPreference('AAPL', {
  buyOnDip: false,
  buyRestricted: false,
  buyRestrictedUntil: null,
  targetBuyPriceOverride: 250.50
})

// Clear override (set to null)
await updateTickerPreference('AAPL', {
  buyOnDip: false,
  buyRestricted: false,
  buyRestrictedUntil: null,
  targetBuyPriceOverride: null
})
```

## Files Modified

### Backend
- `stock-tracker-backend/src/db/connection.ts` - Database migration
- `stock-tracker-backend/src/routes/ticker-preferences.ts` - API routes
- `stock-tracker-backend/tests/22-user-ticker-preferences.test.ts` - Tests

### Frontend
- `stock-tracker-frontend/src/api.ts` - Type definitions
- `stock-tracker-frontend/src/tickerBadges.tsx` - Badge logic
- `stock-tracker-frontend/src/pages/DashboardPage.tsx` - Dashboard integration
- `stock-tracker-frontend/src/pages/DashboardPage.test.ts` - Tests
- `stock-tracker-frontend/src/pages/TargetDistanceSection.test.tsx` - Tests
- `stock-tracker-frontend/src/pages/InsufficientSharesBanner.tsx` - New component
- `stock-tracker-frontend/src/pages/TickerPreferenceModal.tsx` - New component
- `stock-tracker-frontend/src/simulation.ts` - Simulation support
- `stock-tracker-frontend/src/simulation.test.ts` - Tests

## Validation Rules

✅ **Valid Ranges:**
- Minimum: 0.00000001
- Maximum: 9999999999.99
- Type: Decimal number
- Nullable: Yes (represents "no override")

✅ **Constraints:**
- Per-ticker setting (isolated by ticker and user)
- Independent from Buy on Dip setting
- Persisted in database
- Updated via standard preference API

## Next Steps (Optional Enhancements)

1. **UI Integration**
   - Add button to dashboard row for each ticker
   - Add "Manage all ticker settings" page in user settings
   - Add keyboard shortcut to open settings modal

2. **Display Enhancements**
   - Show override price in holdings table
   - Compare override vs actual market price
   - Historical tracking of override prices

3. **Automation**
   - Apply suggested override automatically
   - Sync override with Buy on Dip price
   - Alerts when override becomes obsolete

4. **Analytics**
   - Track how often overrides are used
   - Compare performance with/without overrides
   - Suggest optimal override prices

## Support

For issues or questions:
1. Check the test files for usage examples
2. Review component prop types in TypeScript definitions
3. Check backend route handler for validation rules
4. Refer to this documentation for feature overview
