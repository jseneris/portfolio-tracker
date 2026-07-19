import sql from 'mssql';

let pool: sql.ConnectionPool | null = null;

export async function initializeDatabase() {
  const config: sql.config = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'YourStrongPassword123!',
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_NAME || 'StockTracker',
    authentication: { type: 'default' },
    options: {
      encrypt: true,
      trustServerCertificate: true,
      enableKeepAlive: true,
      enableArithAbort: true
    }
  };

  try {
    pool = new sql.ConnectionPool(config);
    await pool.connect();
    console.log('✓ Database connected to', config.server);
    await createTablesIfNotExist();
    return pool;
  } catch (error) {
    console.error('✗ Database connection failed:', error);
    throw error;
  }
}

export function getPool(): sql.ConnectionPool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initializeDatabase first.');
  }
  return pool;
}

async function createTablesIfNotExist() {
  const request = getPool().request();

  await request.batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CashTransactions')
      CREATE TABLE CashTransactions (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        userId NVARCHAR(255) NOT NULL,
        type NVARCHAR(50) NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'interest', 'fee')),
        amount DECIMAL(18, 4) NOT NULL,
        transactionDate DATETIME2 NOT NULL,
        createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT CK_CashAmount CHECK (amount > 0)
      );

    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'StockTransactions')
      CREATE TABLE StockTransactions (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        userId NVARCHAR(255) NOT NULL,
        ticker NVARCHAR(10) NOT NULL,
        type NVARCHAR(50) NOT NULL CHECK (type IN ('buy', 'sell', 'div')),
        quantity DECIMAL(18, 8),
        price DECIMAL(18, 8),
        amount DECIMAL(18, 4),
        transactionDate DATETIME2 NOT NULL,
        splitAdjusted BIT NOT NULL DEFAULT 0,
        lastSplitId UNIQUEIDENTIFIER NULL,
        createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT CK_StockTransactions_PositiveValues CHECK (
          (type IN ('buy', 'sell') AND quantity IS NOT NULL AND quantity > 0 AND price IS NOT NULL AND price > 0 AND amount IS NOT NULL AND amount > 0)
          OR (type = 'div' AND amount IS NOT NULL AND amount > 0)
        ),
        CONSTRAINT CK_StockTransactions_Type CHECK (type IN ('buy', 'sell', 'div'))
      );

    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'StockSplits')
      CREATE TABLE StockSplits (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        ticker NVARCHAR(10) NOT NULL,
        ratioNumerator DECIMAL(18, 8) NOT NULL,
        ratioDenominator DECIMAL(18, 8) NOT NULL,
        multiplier DECIMAL(18, 8) NOT NULL,
        splitDate DATETIME2 NOT NULL,
        createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT CK_StockSplits_PositiveRatio CHECK (ratioNumerator > 0 AND ratioDenominator > 0 AND multiplier > 0)
      );

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CashTransactions_UserId')
      CREATE INDEX IX_CashTransactions_UserId ON CashTransactions(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CashTransactions_Date')
      CREATE INDEX IX_CashTransactions_Date ON CashTransactions(transactionDate);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CashTransactions_UserId_TransactionDate')
      CREATE INDEX IX_CashTransactions_UserId_TransactionDate ON CashTransactions(userId, transactionDate);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockTransactions_UserId')
      CREATE INDEX IX_StockTransactions_UserId ON StockTransactions(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockTransactions_Ticker')
      CREATE INDEX IX_StockTransactions_Ticker ON StockTransactions(ticker);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockTransactions_Date')
      CREATE INDEX IX_StockTransactions_Date ON StockTransactions(transactionDate);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockTransactions_UserId_Ticker_TransactionDate')
      CREATE INDEX IX_StockTransactions_UserId_Ticker_TransactionDate ON StockTransactions(userId, ticker, transactionDate);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockSplits_Ticker')
      CREATE INDEX IX_StockSplits_Ticker ON StockSplits(ticker);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_StockSplits_Ticker_Ratio_Date')
      CREATE UNIQUE INDEX UX_StockSplits_Ticker_Ratio_Date ON StockSplits(ticker, ratioNumerator, ratioDenominator, splitDate);
  `);

  await request.batch(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_StockTransactions_LastSplit'
    )
      ALTER TABLE StockTransactions
      ADD CONSTRAINT FK_StockTransactions_LastSplit FOREIGN KEY (lastSplitId) REFERENCES StockSplits(id);
  `);

  await request.batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PurchaseLots')
      CREATE TABLE PurchaseLots (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        userId NVARCHAR(255) NOT NULL,
        ticker NVARCHAR(10) NOT NULL,
        transactionId UNIQUEIDENTIFIER NOT NULL,
        sourceType NVARCHAR(20) NOT NULL DEFAULT 'purchase' CHECK (sourceType IN ('purchase', 'dividend')),
        originalQuantity DECIMAL(18, 8) NOT NULL,
        remainingQuantity DECIMAL(18, 8) NOT NULL,
        unitCost DECIMAL(18, 8) NOT NULL,
        purchaseDate DATETIME2 NOT NULL,
        splitAdjusted BIT NOT NULL DEFAULT 0,
        lastSplitId UNIQUEIDENTIFIER NULL,
        createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        FOREIGN KEY (transactionId) REFERENCES StockTransactions(id) ON DELETE CASCADE,
        FOREIGN KEY (lastSplitId) REFERENCES StockSplits(id)
      );

    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PurchaseLotAllocations')
      CREATE TABLE PurchaseLotAllocations (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        userId NVARCHAR(255) NOT NULL,
        saleTransactionId UNIQUEIDENTIFIER NOT NULL,
        purchaseLotId UNIQUEIDENTIFIER NOT NULL,
        quantityConsumed DECIMAL(18, 8) NOT NULL CHECK (quantityConsumed > 0),
        createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        FOREIGN KEY (saleTransactionId) REFERENCES StockTransactions(id) ON DELETE CASCADE,
        FOREIGN KEY (purchaseLotId) REFERENCES PurchaseLots(id)
      );

    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SplitAdjustments')
      CREATE TABLE SplitAdjustments (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        userId NVARCHAR(255) NOT NULL,
        splitId UNIQUEIDENTIFIER NOT NULL,
        entityType NVARCHAR(20) NOT NULL CHECK (entityType IN ('lot', 'transaction', 'allocation')),
        entityId UNIQUEIDENTIFIER NOT NULL,
        multiplier DECIMAL(18, 8) NOT NULL,
        createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        FOREIGN KEY (splitId) REFERENCES StockSplits(id)
      );

    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DisplayLots')
      CREATE TABLE DisplayLots (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        userId NVARCHAR(255) NOT NULL,
        ticker NVARCHAR(10) NOT NULL,
        totalQuantity DECIMAL(18, 8) NOT NULL CHECK (totalQuantity >= 0),
        createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      );

    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DisplayLotComposition')
      CREATE TABLE DisplayLotComposition (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        displayLotId UNIQUEIDENTIFIER NOT NULL,
        purchaseLotId UNIQUEIDENTIFIER NOT NULL,
        quantityAllocated DECIMAL(18, 8) NOT NULL CHECK (quantityAllocated > 0),
        createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        FOREIGN KEY (displayLotId) REFERENCES DisplayLots(id) ON DELETE CASCADE,
        FOREIGN KEY (purchaseLotId) REFERENCES PurchaseLots(id)
      );

    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DisplayLotAllocations')
      CREATE TABLE DisplayLotAllocations (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        userId NVARCHAR(255) NOT NULL,
        saleTransactionId UNIQUEIDENTIFIER NOT NULL,
        displayLotId UNIQUEIDENTIFIER NOT NULL,
        quantityConsumed DECIMAL(18, 8) NOT NULL CHECK (quantityConsumed > 0),
        createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        FOREIGN KEY (saleTransactionId) REFERENCES StockTransactions(id) ON DELETE CASCADE,
        FOREIGN KEY (displayLotId) REFERENCES DisplayLots(id)
      );

    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'HistoricalPrices')
      CREATE TABLE HistoricalPrices (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        ticker NVARCHAR(10) NOT NULL,
        priceDate DATE NOT NULL,
        marketDate DATE NOT NULL,
        closePrice DECIMAL(18, 8) NOT NULL,
        source NVARCHAR(50) NOT NULL DEFAULT 'yahoo-finance',
        createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      );

    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UserSettings')
      CREATE TABLE UserSettings (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        userId NVARCHAR(255) NOT NULL,
        saleTargetPercent DECIMAL(9, 4) NOT NULL DEFAULT 10,
        buyTargetPercentUnder3DisplayLots DECIMAL(9, 4) NOT NULL DEFAULT 5,
        buyTargetPercentFor3DisplayLots DECIMAL(9, 4) NOT NULL DEFAULT 10,
        buyTargetPercentFor4DisplayLots DECIMAL(9, 4) NOT NULL DEFAULT 15,
        buyTargetPercentFor5DisplayLots DECIMAL(9, 4) NOT NULL DEFAULT 20,
        buyTargetPercentFor6OrMoreDisplayLots DECIMAL(9, 4) NOT NULL DEFAULT 25,
        createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      );

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLots_UserId')
      CREATE INDEX IX_PurchaseLots_UserId ON PurchaseLots(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLots_Ticker')
      CREATE INDEX IX_PurchaseLots_Ticker ON PurchaseLots(ticker);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLots_Date')
      CREATE INDEX IX_PurchaseLots_Date ON PurchaseLots(purchaseDate);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLots_SourceType')
      CREATE INDEX IX_PurchaseLots_SourceType ON PurchaseLots(sourceType);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLots_UserId_Ticker_PurchaseDate')
      CREATE INDEX IX_PurchaseLots_UserId_Ticker_PurchaseDate ON PurchaseLots(userId, ticker, purchaseDate);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLots_OpenPositions_UserId_Ticker_PurchaseDate')
      CREATE INDEX IX_PurchaseLots_OpenPositions_UserId_Ticker_PurchaseDate
      ON PurchaseLots(userId, ticker, purchaseDate)
      INCLUDE (remainingQuantity, unitCost)
      WHERE remainingQuantity > 0;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLotAllocations_UserId')
      CREATE INDEX IX_PurchaseLotAllocations_UserId ON PurchaseLotAllocations(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLotAllocations_SaleTransactionId')
      CREATE INDEX IX_PurchaseLotAllocations_SaleTransactionId ON PurchaseLotAllocations(saleTransactionId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLotAllocations_PurchaseLotId')
      CREATE INDEX IX_PurchaseLotAllocations_PurchaseLotId ON PurchaseLotAllocations(purchaseLotId);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SplitAdjustments_UserId')
      CREATE INDEX IX_SplitAdjustments_UserId ON SplitAdjustments(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SplitAdjustments_SplitId')
      CREATE INDEX IX_SplitAdjustments_SplitId ON SplitAdjustments(splitId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SplitAdjustments_EntityId')
      CREATE INDEX IX_SplitAdjustments_EntityId ON SplitAdjustments(entityId);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisplayLots_UserId')
      CREATE INDEX IX_DisplayLots_UserId ON DisplayLots(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisplayLots_Ticker')
      CREATE INDEX IX_DisplayLots_Ticker ON DisplayLots(ticker);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisplayLotComposition_DisplayLotId')
      CREATE INDEX IX_DisplayLotComposition_DisplayLotId ON DisplayLotComposition(displayLotId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisplayLotComposition_PurchaseLotId')
      CREATE INDEX IX_DisplayLotComposition_PurchaseLotId ON DisplayLotComposition(purchaseLotId);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisplayLotAllocations_UserId')
      CREATE INDEX IX_DisplayLotAllocations_UserId ON DisplayLotAllocations(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisplayLotAllocations_SaleTransactionId')
      CREATE INDEX IX_DisplayLotAllocations_SaleTransactionId ON DisplayLotAllocations(saleTransactionId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisplayLotAllocations_DisplayLotId')
      CREATE INDEX IX_DisplayLotAllocations_DisplayLotId ON DisplayLotAllocations(displayLotId);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_HistoricalPrices_Ticker')
      CREATE INDEX IX_HistoricalPrices_Ticker ON HistoricalPrices(ticker);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_HistoricalPrices_PriceDate')
      CREATE INDEX IX_HistoricalPrices_PriceDate ON HistoricalPrices(priceDate);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_HistoricalPrices_Ticker_Date_Source')
      CREATE UNIQUE INDEX UX_HistoricalPrices_Ticker_Date_Source
      ON HistoricalPrices(ticker, priceDate, source);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_UserSettings_UserId')
      CREATE UNIQUE INDEX UX_UserSettings_UserId ON UserSettings(userId);
  `);

  console.log('✓ Database tables initialized');
}

export async function closeDatabase() {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('✓ Database connection closed');
  }
}
