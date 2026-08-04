---
applyTo: "stock-tracker-backend/src/db/**/*.ts"
excludeAgent: "code-review"
---

Multi-user stock portfolio tracker.  This file describes what functionality it must support.

Each user has a seperate portfolio.

Each user can add or withdraw cash to/from their portfolio.  Each cash transaction has a type: deposit, withdrawal, interest, fee.  Cash basis is based only on deposits and withdrawals.  Interest and fees are adjustments to available cash but do not affect cash basis.  Stock transactions (buys, sells) affect available cash but do not affect cash basis.  Dividends are reinvested only and do not directly affect available cash. 

Stock Splits must be applied retroactively to all affected lots and transactions.  The system must support multiple sequential splits on the same ticker, and each split must be traceable in the audit trail. Stock splits must be activated by each user individually, either manually or by user entering a transaction after the split has occurred.  Activating a stock split does not change the share amount or cost basis in the transaction table, the adjustments are applied dynamically when calculating portfolio metrics.
Only holdings that are actively held after the split should reflect the adjustments from the stock split.

Portfolio summary, available cash, list of stocks with details (ticker, shares, cost basis, and lot count) must be available with single call to database.  All calculations must be derived on-demand and not stored in state.  All transactions must support past dates and sort by transaction_date.

Display lots are used to show the current the weight of each holding.  Display lots are only affected by purchases, sales, and stock splits.  Display lots should always reflect the number of puchased shares.


--
sql queries for manual adjustment of historical prices stock split values.  This is only needed for historical data that was not adjusted for stock splits at the time of the split.  The system will automatically adjust all future prices for stock splits.
--
SELECT [ticker]
      ,[stocksplitId]
  FROM [barneris_stock_tracker].[dbo].[HistoricalPrices]
  group by ticker, stocksplitId
  order by ticker, stocksplitId

  update [barneris_stock_tracker].[dbo].[HistoricalPrices]
set stockSplitId = 'e4ad32fb-a08e-4fc7-a483-9d1dd632522e',
    closePrice = closePrice  * 1243/1000
  where ticker = 'MIDD' and priceDate <= '2026-07-07'
  and stocksplitId is null;

  update [barneris_stock_tracker].[dbo].[HistoricalPrices]
set stockSplitId = 'b94fdcf1-a7cd-4711-98b3-81a9848c9bca',
    closePrice = closePrice  * 4
  where ticker = 'CRWD' and priceDate <= '2026-07-02'
  and stocksplitId is null;

  
  update [barneris_stock_tracker].[dbo].[HistoricalPrices]
set stockSplitId = '5173660c-0d04-4cc3-9077-4093b88af19a',
    closePrice = closePrice  * 10
  where ticker = 'NVDA' and priceDate <= '2024-06-10'
  and stocksplitId is null;

  update [barneris_stock_tracker].[dbo].[HistoricalPrices]
set stockSplitId = '5912b3f8-d826-4308-bb17-1af4680ee229',
    closePrice = closePrice  * 2
  where ticker = 'ODFL' and priceDate <= '2024-03-28'
  and stocksplitId is null;



  --
  not needed
  ==

      update [barneris_stock_tracker].[dbo].[HistoricalPrices]
set stockSplitId = 'a33972d3-c737-4066-98a4-21d479f02643',
    closePrice = closePrice  * 1033/1000
  where ticker = 'LEN' and priceDate <= '2025-01-21'
  and stocksplitId is null;

