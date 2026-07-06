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
      type NVARCHAR(50) NOT NULL CHECK (type IN ('buy', 'sell', 'div', 'split')),
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

  // Create StockSplits table (records each split event for auditability/idempotency)
  await request.batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'StockSplits')
    CREATE TABLE StockSplits (
      id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
      userId NVARCHAR(255) NOT NULL,
      ticker NVARCHAR(10) NOT NULL,
      multiplier DECIMAL(18, 8) NOT NULL,
      splitDate DATETIME2 NOT NULL,
      createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockSplits_UserId') CREATE INDEX IX_StockSplits_UserId ON StockSplits(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockSplits_Ticker') CREATE INDEX IX_StockSplits_Ticker ON StockSplits(ticker);
  `);

  // Create Lots table (individual purchase/dividend batches)
  await request.batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Lots')
    CREATE TABLE Lots (
      id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
      userId NVARCHAR(255) NOT NULL,
      ticker NVARCHAR(10) NOT NULL,
      transactionId UNIQUEIDENTIFIER NOT NULL,
      sourceType NVARCHAR(20) NOT NULL DEFAULT 'purchase' CHECK (sourceType IN ('purchase', 'dividend')),
      originalQuantity DECIMAL(18, 8) NOT NULL,
      remainingQuantity DECIMAL(18, 8) NOT NULL,
      unitCost DECIMAL(18, 4) NOT NULL,
      purchaseDate DATETIME2 NOT NULL,
      splitAdjusted BIT NOT NULL DEFAULT 0,
      lastSplitId UNIQUEIDENTIFIER NULL,
      createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
      updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
      FOREIGN KEY (transactionId) REFERENCES StockTransactions(id) ON DELETE CASCADE,
      FOREIGN KEY (lastSplitId) REFERENCES StockSplits(id)
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Lots_UserId') CREATE INDEX IX_Lots_UserId ON Lots(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Lots_Ticker') CREATE INDEX IX_Lots_Ticker ON Lots(ticker);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Lots_Date')   CREATE INDEX IX_Lots_Date ON Lots(purchaseDate);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Lots_SourceType') CREATE INDEX IX_Lots_SourceType ON Lots(sourceType);
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

  // Create LotAllocations table (records which lot(s) a sale/consuming transaction drew from,
  // and how much of each lot was consumed - required for explicit user-chosen lot allocation on sells)
  await request.batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'LotAllocations')
    CREATE TABLE LotAllocations (
      id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
      userId NVARCHAR(255) NOT NULL,
      saleTransactionId UNIQUEIDENTIFIER NOT NULL,
      lotId UNIQUEIDENTIFIER NOT NULL,
      quantityConsumed DECIMAL(18, 8) NOT NULL CHECK (quantityConsumed > 0),
      createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
      FOREIGN KEY (saleTransactionId) REFERENCES StockTransactions(id) ON DELETE CASCADE,
      FOREIGN KEY (lotId) REFERENCES Lots(id)
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LotAllocations_UserId') CREATE INDEX IX_LotAllocations_UserId ON LotAllocations(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LotAllocations_SaleTransactionId') CREATE INDEX IX_LotAllocations_SaleTransactionId ON LotAllocations(saleTransactionId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LotAllocations_LotId') CREATE INDEX IX_LotAllocations_LotId ON LotAllocations(lotId);
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
