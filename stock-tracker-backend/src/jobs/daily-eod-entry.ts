import dotenv from 'dotenv';
import { closeDatabase, initializeDatabase } from '../db/connection.js';
import { runDailyEodSync } from '../routes/stocks.js';

dotenv.config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env.local' });

async function runDailyEodJob(): Promise<void> {
  try {
    await initializeDatabase();
    const summary = await runDailyEodSync();
    console.log('[daily-eod] Sync complete:', summary);

    if (summary.failedTickers.length > 0) {
      console.warn(
        `[daily-eod] Completed with ${summary.failedTickers.length} ticker warning(s); successful ticker updates were retained.`
      );
    }
  } catch (error) {
    console.error('[daily-eod] Sync failed:', error);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

void runDailyEodJob();