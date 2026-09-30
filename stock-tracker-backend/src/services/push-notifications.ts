import { createHash } from 'node:crypto';
import sql from 'mssql';
import webpush from 'web-push';
import { getPool } from '../db/connection.js';

export type PushPayload = {
  title: string;
  body: string;
  url: string;
};

type StoredSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export function hashPushEndpoint(endpoint: string): Buffer {
  return createHash('sha256').update(endpoint).digest();
}

export function getPushConfiguration() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || null;
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || null;
  const subject = process.env.VAPID_SUBJECT?.trim() || null;

  return {
    publicKey,
    privateKey,
    subject,
    available: Boolean(publicKey && privateKey && subject),
  };
}

export async function sendPushNotification(userId: string, payload: PushPayload): Promise<number> {
  const config = getPushConfiguration();
  if (!config.available || !config.publicKey || !config.privateKey || !config.subject) {
    return 0;
  }

  try {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  } catch (error) {
    console.error('[push] VAPID configuration is invalid:', error);
    return 0;
  }

  const result = await getPool().request()
    .input('userId', sql.NVarChar, userId)
    .query('SELECT endpoint, p256dh, auth FROM PushSubscriptions WHERE userId = @userId');

  const accepted = await Promise.all((result.recordset as StoredSubscription[]).map(async (subscription) => {
    const endpointHash = hashPushEndpoint(subscription.endpoint);
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify(payload), { TTL: 60 });
      return true;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        try {
          await getPool().request()
            .input('endpointHash', sql.Binary(32), endpointHash)
            .query('DELETE FROM PushSubscriptions WHERE endpointHash = @endpointHash');
        } catch (deleteError) {
          console.error('[push] Unable to remove expired subscription:', deleteError);
        }
        return false;
      }

      console.error('[push] Notification delivery failed:', error);
      return false;
    }
  }));

  return accepted.filter(Boolean).length;
}