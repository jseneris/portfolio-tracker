import cron from 'node-cron';
import { runDailyEodSync } from '../routes/stocks.js';

// 4:30pm America/New_York, weekdays only; node-cron applies DST for the given timezone automatically.
const DAILY_EOD_SYNC_CRON_EXPRESSION = '30 16 * * 1-5';

export function startScheduledJobs(): void {
  cron.schedule(DAILY_EOD_SYNC_CRON_EXPRESSION, async () => {
    try {
      const summary = await runDailyEodSync();
      console.log('[scheduler] Daily EOD sync complete:', summary);
    } catch (error) {
      console.error('[scheduler] Daily EOD sync failed:', error);
    }
  }, { timezone: 'America/New_York' });

  console.log('[scheduler] Daily EOD sync scheduled for 4:30pm America/New_York on weekdays.');
}
