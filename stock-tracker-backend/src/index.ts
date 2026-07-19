import dotenv from 'dotenv';
const envPath = process.env.NODE_ENV === 'test' ? '.env.test' : '.env.local';
dotenv.config({ path: envPath });
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { initializeDatabase, closeDatabase } from './db/connection.js';
import cashRoutes from './routes/cash.js';
import stockRoutes from './routes/stocks.js';
import lotsRoutes from './routes/lots.js';
import displayLotsRoutes from './routes/display-lots.js';
import userSettingsRoutes from './routes/user-settings.js';


const app: Express = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Auth middleware (simplified - in production, use proper JWT validation with Auth0)
app.use((req: Request, res: Response, next: NextFunction) => {
  // For now, accept Bearer token or x-user-id header
  const authHeader = req.headers.authorization;
  const userId = req.headers['x-user-id'] as string;
  
  if (authHeader?.startsWith('Bearer ')) {
    // In production, validate the JWT token here
    req.user = { id: userId || 'dev-user' };
  } else if (userId) {
    req.user = { id: userId };
  } else {
    // Development mode - use default user
    req.user = { id: 'dev-user' };
  }
  next();
});

// Type augmentation for Request
declare global {
  namespace Express {
    interface Request {
      user?: { id: string };
    }
  }
}

// Routes
app.use('/api/cash', cashRoutes);
app.use('/api/stocks', stockRoutes);
app.use('/api/lots', lotsRoutes);
app.use('/api/display-lots', displayLotsRoutes);
app.use('/api/user-settings', userSettingsRoutes);

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

export async function startServer() {
  try {
    await initializeDatabase();
    
    return app.listen(PORT, () => {
      console.log(`\n🚀 Stock Tracker API running on http://localhost:${PORT}`);
      console.log(`📊 Database: ${process.env.DB_NAME || 'StockTracker'}`);
      console.log(`🔌 Frontend: ${process.env.FRONTEND_URL || 'http://localhost:5173'}\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await closeDatabase();
  process.exit(0);
});

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;
