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
      multiplier DECIMAL(18, 8),
      transactionDate DATETIME2 NOT NULL,
      createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
      updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockTransactions_UserId') CREATE INDEX IX_StockTransactions_UserId ON StockTransactions(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockTransactions_Ticker') CREATE INDEX IX_StockTransactions_Ticker ON StockTransactions(ticker);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_StockTransactions_Date') CREATE INDEX IX_StockTransactions_Date ON StockTransactions(transactionDate);
  `);

  // Create Lots table (individual purchase batches)
  await request.batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Lots')
    CREATE TABLE Lots (
      id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
      userId NVARCHAR(255) NOT NULL,
      ticker NVARCHAR(10) NOT NULL,
      transactionId UNIQUEIDENTIFIER NOT NULL,
      originalQuantity DECIMAL(18, 8) NOT NULL,
      remainingQuantity DECIMAL(18, 8) NOT NULL,
      unitCost DECIMAL(18, 4) NOT NULL,
      purchaseDate DATETIME2 NOT NULL,
      createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
      updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
      FOREIGN KEY (transactionId) REFERENCES StockTransactions(id) ON DELETE CASCADE
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Lots_UserId') CREATE INDEX IX_Lots_UserId ON Lots(userId);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Lots_Ticker') CREATE INDEX IX_Lots_Ticker ON Lots(ticker);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Lots_Date')   CREATE INDEX IX_Lots_Date ON Lots(purchaseDate);
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
