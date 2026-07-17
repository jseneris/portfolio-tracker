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

  // Create CashTransactions table
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
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CashTransactions_UserId') CREATE INDEX IX_CashTransactions_UserId ON CashTransactions(userId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CashTransactions_Date') CREATE INDEX IX_CashTransactions_Date ON CashTransactions(transactionDate);
  `);

  // Create StockTransactions table
  await request.batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'StockTransactions')
    CREATE TABLE StockTransactions (
      id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
      userId NVARCHAR(255) NOT NULL,
      ticker NVARCHAR(10) NOT NULL,
      type NVARCHAR(50) NOT NULL CHECK (type IN ('buy', 'sell', 'div')),
      quantity DECIMAL(18, 8),
      price DECIMAL(18, 4),
      amount DECIMAL(18, 4),
      transactionDate DATETIME2 NOT NULL,
      createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
      updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockTransactions_UserId') CREATE INDEX IX_StockTransactions_UserId ON StockTransactions(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockTransactions_Ticker') CREATE INDEX IX_StockTransactions_Ticker ON StockTransactions(ticker);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockTransactions_Date') CREATE INDEX IX_StockTransactions_Date ON StockTransactions(transactionDate);
  `);

  // Normalize StockTransactions.type constraint for existing databases so only
  // buy/sell/div are allowed there. Split events are tracked in StockSplits.
  await request.batch(`
    DECLARE @dropSql NVARCHAR(MAX) = N'';
    SELECT @dropSql = @dropSql + N'ALTER TABLE StockTransactions DROP CONSTRAINT [' + cc.name + N'];'
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id = OBJECT_ID('StockTransactions')
      AND cc.definition LIKE '%[[]type[]]%' 
      AND cc.definition LIKE '%split%';

    IF LEN(@dropSql) > 0
      EXEC sp_executesql @dropSql;

    IF NOT EXISTS (
      SELECT 1 FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID('StockTransactions')
        AND name = 'CK_StockTransactions_Type'
    )
      ALTER TABLE StockTransactions
      ADD CONSTRAINT CK_StockTransactions_Type
      CHECK (type IN ('buy', 'sell', 'div'));
  `);

  // Create StockSplits table (records each split event for auditability/idempotency).
  // Splits are specified as a ratio (e.g. "2-for-1", "5-for-3") rather than a raw multiplier,
  // matching how splits are actually announced; ratioNumerator/ratioDenominator preserve the
  // original ratio the caller entered, while multiplier (= numerator / denominator) is kept
  // alongside it since it's what the adjustment math actually applies.
  await request.batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'StockSplits')
    CREATE TABLE StockSplits (
      id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
      userId NVARCHAR(255) NOT NULL,
      ticker NVARCHAR(10) NOT NULL,
      ratioNumerator DECIMAL(18, 8) NOT NULL,
      ratioDenominator DECIMAL(18, 8) NOT NULL,
      multiplier DECIMAL(18, 8) NOT NULL,
      splitDate DATETIME2 NOT NULL,
      createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockSplits_UserId') CREATE INDEX IX_StockSplits_UserId ON StockSplits(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockSplits_Ticker') CREATE INDEX IX_StockSplits_Ticker ON StockSplits(ticker);
  `);

  // Migrate existing StockSplits rows created before ratioNumerator/ratioDenominator existed:
  // add the columns (backfilled as multiplier-for-1 so old rows remain valid) if missing.
  await request.batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('StockSplits') AND name = 'ratioNumerator')
      ALTER TABLE StockSplits ADD ratioNumerator DECIMAL(18, 8) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('StockSplits') AND name = 'ratioDenominator')
      ALTER TABLE StockSplits ADD ratioDenominator DECIMAL(18, 8) NULL;
  `);
  await request.batch(`
    UPDATE StockSplits SET ratioNumerator = multiplier WHERE ratioNumerator IS NULL;
    UPDATE StockSplits SET ratioDenominator = 1 WHERE ratioDenominator IS NULL;
  `);
  await request.batch(`
    ALTER TABLE StockSplits ALTER COLUMN ratioNumerator DECIMAL(18, 8) NOT NULL;
  `);
  await request.batch(`
    ALTER TABLE StockSplits ALTER COLUMN ratioDenominator DECIMAL(18, 8) NOT NULL;
  `);



  // Create PurchaseLots table (purchase/dividend attribution ledger with mutable remaining quantity).
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
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLots_UserId') CREATE INDEX IX_PurchaseLots_UserId ON PurchaseLots(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLots_Ticker') CREATE INDEX IX_PurchaseLots_Ticker ON PurchaseLots(ticker);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLots_Date') CREATE INDEX IX_PurchaseLots_Date ON PurchaseLots(purchaseDate);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLots_SourceType') CREATE INDEX IX_PurchaseLots_SourceType ON PurchaseLots(sourceType);
  `);

  // Add splitAdjusted / lastSplitId to StockTransactions so affected transactions can be flagged too
  await request.batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('StockTransactions') AND name = 'splitAdjusted')
      ALTER TABLE StockTransactions ADD splitAdjusted BIT NOT NULL DEFAULT 0;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('StockTransactions') AND name = 'lastSplitId')
      ALTER TABLE StockTransactions ADD lastSplitId UNIQUEIDENTIFIER NULL;
  `);

  await request.batch(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_StockTransactions_LastSplit'
    )
    AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('StockTransactions') AND name = 'lastSplitId')
      ALTER TABLE StockTransactions
      ADD CONSTRAINT FK_StockTransactions_LastSplit FOREIGN KEY (lastSplitId) REFERENCES StockSplits(id);
  `);



  // Create PurchaseLotAllocations table (explicit user-directed attribution against PurchaseLots).
  await request.batch(`
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
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLotAllocations_UserId') CREATE INDEX IX_PurchaseLotAllocations_UserId ON PurchaseLotAllocations(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLotAllocations_SaleTransactionId') CREATE INDEX IX_PurchaseLotAllocations_SaleTransactionId ON PurchaseLotAllocations(saleTransactionId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLotAllocations_PurchaseLotId') CREATE INDEX IX_PurchaseLotAllocations_PurchaseLotId ON PurchaseLotAllocations(purchaseLotId);
  `);

  // Widen price/unitCost precision so repeated stock splits don't compound rounding error.
  // These columns get divided by each split's multiplier in place; DECIMAL(18,4) loses enough
  // precision after 2+ splits that "cost basis unchanged" can drift. DECIMAL(18,8) matches the
  // precision already used for share quantities and keeps that invariant solid across many splits.
  await request.batch(`
    ALTER TABLE StockTransactions ALTER COLUMN price DECIMAL(18, 8);
  `);

  // Create SplitAdjustments table: records every split that touched every individual lot,
  // transaction, or lot allocation - unlike the single lastSplitId/splitAdjusted columns (which
  // only remember the most recent split), this preserves full history when a ticker splits
  // more than once, enabling multi-split audit trails.
  await request.batch(`
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
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SplitAdjustments_UserId') CREATE INDEX IX_SplitAdjustments_UserId ON SplitAdjustments(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SplitAdjustments_SplitId') CREATE INDEX IX_SplitAdjustments_SplitId ON SplitAdjustments(splitId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SplitAdjustments_EntityId') CREATE INDEX IX_SplitAdjustments_EntityId ON SplitAdjustments(entityId);
  `);

  // P0 hardening indexes aligned to real query shapes.
  await request.batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CashTransactions_UserId_TransactionDate')
      CREATE INDEX IX_CashTransactions_UserId_TransactionDate ON CashTransactions(userId, transactionDate);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockTransactions_UserId_Ticker_TransactionDate')
      CREATE INDEX IX_StockTransactions_UserId_Ticker_TransactionDate ON StockTransactions(userId, ticker, transactionDate);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLots_UserId_Ticker_PurchaseDate')
      CREATE INDEX IX_PurchaseLots_UserId_Ticker_PurchaseDate ON PurchaseLots(userId, ticker, purchaseDate);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseLots_OpenPositions_UserId_Ticker_PurchaseDate')
      CREATE INDEX IX_PurchaseLots_OpenPositions_UserId_Ticker_PurchaseDate
      ON PurchaseLots(userId, ticker, purchaseDate)
      INCLUDE (remainingQuantity, unitCost)
      WHERE remainingQuantity > 0;
  `);

  // P0 data integrity checks for transactional positivity.
  // For buy/sell transactions, all values must be positive and NOT NULL.
  // For dividend transactions, only amount is required to be positive.
  await request.batch(`
    IF EXISTS (
      SELECT 1 FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID('StockTransactions')
        AND name = 'CK_StockTransactions_PositiveValues'
    )
      ALTER TABLE StockTransactions DROP CONSTRAINT CK_StockTransactions_PositiveValues;

    ALTER TABLE StockTransactions WITH NOCHECK
    ADD CONSTRAINT CK_StockTransactions_PositiveValues
    CHECK (
      (type IN ('buy', 'sell') AND quantity IS NOT NULL AND quantity > 0 AND price IS NOT NULL AND price > 0 AND amount IS NOT NULL AND amount > 0)
      OR (type = 'div' AND amount IS NOT NULL AND amount > 0)
    );
  `);

  await request.batch(`
    IF EXISTS (
      SELECT 1 FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID('StockSplits')
        AND name = 'CK_StockSplits_PositiveRatio'
    )
      ALTER TABLE StockSplits DROP CONSTRAINT CK_StockSplits_PositiveRatio;

    ALTER TABLE StockSplits WITH NOCHECK
    ADD CONSTRAINT CK_StockSplits_PositiveRatio
    CHECK (
      ratioNumerator > 0
      AND ratioDenominator > 0
      AND multiplier > 0
    );
  `);

  // P0 split idempotency at DB level: collapse duplicate historical rows first,
  // then enforce uniqueness by ticker + ratio + splitDate.
  await request.batch(`
    DECLARE @Dupes TABLE (
      duplicateId UNIQUEIDENTIFIER PRIMARY KEY,
      keepId UNIQUEIDENTIFIER NOT NULL
    );

    INSERT INTO @Dupes (duplicateId, keepId)
    SELECT id, keepId
    FROM (
      SELECT
        id,
        FIRST_VALUE(id) OVER (
          PARTITION BY ticker, ratioNumerator, ratioDenominator, splitDate
          ORDER BY createdAt ASC, id ASC
        ) AS keepId,
        ROW_NUMBER() OVER (
          PARTITION BY ticker, ratioNumerator, ratioDenominator, splitDate
          ORDER BY createdAt ASC, id ASC
        ) AS rn
      FROM StockSplits
    ) ranked
    WHERE ranked.rn > 1;

    UPDATE pl
    SET pl.lastSplitId = d.keepId
    FROM PurchaseLots pl
    JOIN @Dupes d ON pl.lastSplitId = d.duplicateId;

    UPDATE st
    SET st.lastSplitId = d.keepId
    FROM StockTransactions st
    JOIN @Dupes d ON st.lastSplitId = d.duplicateId;

    UPDATE sa
    SET sa.splitId = d.keepId
    FROM SplitAdjustments sa
    JOIN @Dupes d ON sa.splitId = d.duplicateId;

    DELETE ss
    FROM StockSplits ss
    JOIN @Dupes d ON ss.id = d.duplicateId;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_StockSplits_Ticker_Ratio_Date')
      CREATE UNIQUE INDEX UX_StockSplits_Ticker_Ratio_Date
      ON StockSplits(ticker, ratioNumerator, ratioDenominator, splitDate);
  `);

  // Create DisplayLots table (user-created groupings, not transaction-tied)
  await request.batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DisplayLots')
    CREATE TABLE DisplayLots (
      id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
      userId NVARCHAR(255) NOT NULL,
      ticker NVARCHAR(10) NOT NULL,
      totalQuantity DECIMAL(18, 8) NOT NULL CHECK (totalQuantity >= 0),
      createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
      updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisplayLots_UserId') CREATE INDEX IX_DisplayLots_UserId ON DisplayLots(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisplayLots_Ticker') CREATE INDEX IX_DisplayLots_Ticker ON DisplayLots(ticker);
  `);

  // Create DisplayLotComposition table (maps display lots to underlying purchase lots)
  await request.batch(`
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
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisplayLotComposition_DisplayLotId') CREATE INDEX IX_DisplayLotComposition_DisplayLotId ON DisplayLotComposition(displayLotId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisplayLotComposition_PurchaseLotId') CREATE INDEX IX_DisplayLotComposition_PurchaseLotId ON DisplayLotComposition(purchaseLotId);
  `);

  // Create DisplayLotAllocations table (tracks which display lots consumed in a sale - reversible)
  await request.batch(`
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
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisplayLotAllocations_UserId') CREATE INDEX IX_DisplayLotAllocations_UserId ON DisplayLotAllocations(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisplayLotAllocations_SaleTransactionId') CREATE INDEX IX_DisplayLotAllocations_SaleTransactionId ON DisplayLotAllocations(saleTransactionId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisplayLotAllocations_DisplayLotId') CREATE INDEX IX_DisplayLotAllocations_DisplayLotId ON DisplayLotAllocations(displayLotId);
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
