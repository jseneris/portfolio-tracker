# Target Buy Price Override Feature

## Overview
This feature allows users to replace the calculated buy target with a custom price. The dashboard, stock page, target-distance view, and buy-target alerts use the saved override.

## Changes Made

### Backend (TypeScript/Express + SQL Server)

#### Database Schema
- **File**: `stock-tracker-backend/src/db/connection.ts`
- Added migration: `targetBuyPriceOverride` column (DECIMAL(18,8), NULL) to `UserTickerPreferences` table
- This allows users to store a custom target purchase price per ticker

#### API Route Handler
- **File**: `stock-tracker-backend/src/routes/ticker-preferences.ts`
- Updated `TickerPreferenceRow` type to include `targetBuyPriceOverride`
- Updated `mapPreference()` function to include the new field
- Updated `preferenceSelect` SQL query to fetch `targetBuyPriceOverride`
- Updated GET `/:ticker` endpoint to return `targetBuyPriceOverride: null` for new preferences
- Updated PUT `/:ticker` endpoint to:
  - Accept `targetBuyPriceOverride` in request body
  - Validate it as a positive price (0.00000001 - 9999999999.99)
  - Store and return the value in responses

### Frontend (React + TypeScript)

#### API Types
- **File**: `stock-tracker-frontend/src/api.ts`
- Added `targetBuyPriceOverride: number | null` to `TickerPreference` type
- Added `targetBuyPriceOverride?: number | null` to `UpdateTickerPreferenceInput` type

#### Badge Display
- **File**: `stock-tracker-frontend/src/tickerBadges.tsx`
- Updated `getTickerInfoBadges()` to include `targetBuyPriceOverride` in the preference type
- Added new badge logic: when override is set, displays 💰 symbol with green tone showing the override price
- Shared target-price helpers compare Base Purchase Size at the buy target against the smallest individual display lot.

#### Ticker Settings
- **File**: `stock-tracker-frontend/src/pages/StockHistoryPage.tsx`
- The override checkbox activates a price input, prefilled with a suggested price when one is available.
- The suggestion divides Base Purchase Size by the smallest whole-share quantity greater than the smallest individual lot, rounding down to eight-decimal price precision.

#### Insufficient Shares Banner (New Component)
- **File**: `stock-tracker-frontend/src/pages/InsufficientSharesBanner.tsx`
- New banner component to display on stock page when current buy price is insufficient
- Shows:
  - Buy target and resulting shares at base purchase size
  - Comparison with smallest display lot size
  - The warning is collapsed by default and uses the override when active

#### Dashboard Updates
- **File**: `stock-tracker-frontend/src/pages/DashboardPage.tsx`
- Updated ticker badge display to include `targetBuyPriceOverride` field from preferences

#### Test Updates
- **Files**: 
  - `stock-tracker-frontend/src/pages/DashboardPage.test.ts`
  - `stock-tracker-frontend/src/pages/TargetDistanceSection.test.tsx`
  - `stock-tracker-frontend/src/simulation.test.ts`
  - `stock-tracker-frontend/src/simulation.ts`
- Updated all test fixtures and mock preferences to include the new `targetBuyPriceOverride` field

## Usage

### Setting Target Buy Price Override

1. Open a ticker from the dashboard and click its **...** settings button.
2. Select **Target Buy Price Override** and enter or accept the suggested price.
3. Click **Save Preferences**.

### Dashboard Display

- If override is set, a 💰 badge appears by Buy Target (and next to the ticker on small screens).
- A red `!` badge indicates that the buy target would not buy more shares than the smallest display lot.
- Tooltip shows: "Target Buy Price Override: $X.XXXX"

### Stock Page Display

- A collapsible warning appears when the effective buy target won't buy more shares than the smallest display lot.

## Validation Rules

- `targetBuyPriceOverride` must be positive and finite
- Must be within 0.00000001 to 9999999999.99
- When null/empty, no override is applied
- The override takes precedence over Buy on Dip for the buy target; it does not change the sale target or Buy on Dip setting.

## Data Flow

```
User Sets Override Price
    ↓
UpdateTickerPreferenceInput
    ↓
PUT /api/ticker-preferences/:ticker
    ↓
Database: UserTickerPreferences.targetBuyPriceOverride
    ↓
Get /api/ticker-preferences/:ticker
    ↓
Frontend: Display badge & banner
```
