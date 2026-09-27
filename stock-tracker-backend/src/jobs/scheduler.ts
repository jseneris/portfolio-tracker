import cron from 'node-cron';
import { runDailyEodSync } from '../routes/stocks.js';
import { runPriceTargetAlertCycle } from '../services/price-target-alerts.js';

// 4:05pm America/New_York, weekdays only; node-cron applies DST for the given timezone automatically.
const DAILY_EOD_SYNC_CRON_EXPRESSION = '05 16 * * 1-5';
// Market-hours gating (holidays, early close, post-close buffer) happens inside the cycle.
const PRICE_TARGET_CRON_EXPRESSION = '*/30 * * * 1-5';

export function startScheduledJobs(): void {
  cron.schedule(PRICE_TARGET_CRON_EXPRESSION, async () => {
    try {
      const summary = await runPriceTargetAlertCycle();
      if (summary.marketOpen) {
        console.log('[scheduler] Price target cycle complete:', summary);
      }
    } catch (error) {
      console.error('[scheduler] Price target cycle failed:', error);
    }
  }, { timezone: 'America/New_York' });
  cron.schedule(DAILY_EOD_SYNC_CRON_EXPRESSION, async () => {
    try {
      const summary = await runDailyEodSync();
      console.log('[scheduler] Daily EOD sync complete:', summary);
    } catch (error) {
      console.error('[scheduler] Daily EOD sync failed:', error);
    }
  }, { timezone: 'America/New_York' });

  console.log('[scheduler] Daily EOD sync scheduled for 4:05pm America/New_York on weekdays.');
  console.log('[scheduler] Price target alerts scheduled every 30 minutes during US market hours.');
}
