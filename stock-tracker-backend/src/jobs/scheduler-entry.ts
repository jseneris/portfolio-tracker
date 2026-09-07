import dotenv from 'dotenv';
import { closeDatabase, initializeDatabase } from '../db/connection.js';
import { startScheduledJobs } from './scheduler.js';

dotenv.config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env.local' });

let shuttingDown = false;

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  await closeDatabase();
  process.exit(exitCode);
}

async function startScheduler(): Promise<void> {
  try {
    await initializeDatabase();
    startScheduledJobs();
  } catch (error) {
    console.error('[scheduler] Failed to start:', error);
    await shutdown(1);
  }
}

process.on('SIGINT', () => {
  void shutdown(0);
});

process.on('SIGTERM', () => {
  void shutdown(0);
});

void startScheduler();