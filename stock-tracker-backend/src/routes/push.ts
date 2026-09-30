import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { getPool } from '../db/connection.js';
import { getPushConfiguration, hashPushEndpoint, sendPushNotification } from '../services/push-notifications.js';

const router = Router();

function readSubscription(value: any) {
  const endpoint = typeof value?.endpoint === 'string' ? value.endpoint.trim() : '';
  const p256dh = typeof value?.keys?.p256dh === 'string' ? value.keys.p256dh.trim() : '';
  const auth = typeof value?.keys?.auth === 'string' ? value.keys.auth.trim() : '';

  if (!endpoint || endpoint.length > 2048 || !p256dh || p256dh.length > 255 || !auth || auth.length > 255) {
    return null;
  }

  try {
    if (new URL(endpoint).protocol !== 'https:') {
      return null;
    }
  } catch {
    return null;
  }

  return { endpoint, p256dh, auth };
}

router.get('/config', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query('SELECT COUNT(*) AS count FROM PushSubscriptions WHERE userId = @userId');
    const config = getPushConfiguration();

    res.json({
      available: config.available,
      publicKey: config.available ? config.publicKey : null,
      subscriptionCount: Number(result.recordset[0]?.count || 0),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/test', async (req: Request, res: Response) => {
  const config = getPushConfiguration();
  if (!config.available) {
    return res.status(503).json({ error: 'Phone notifications are not configured on the server.' });
  }

  try {
    const userId = req.user?.id!;
    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query('SELECT COUNT(*) AS count FROM PushSubscriptions WHERE userId = @userId');
    if (Number(result.recordset[0]?.count || 0) === 0) {
      return res.status(409).json({ error: 'Enable phone notifications in User Settings before sending a test.' });
    }

    const sent = await sendPushNotification(userId, {
      title: 'Stock Tracker test',
      body: 'Phone notifications are working on this device.',
      url: '/messages',
    });
    if (sent === 0) {
      return res.status(502).json({ error: 'The push service did not accept the test notification.' });
    }

    res.json({ sent });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/subscription', async (req: Request, res: Response) => {
  const config = getPushConfiguration();
  if (!config.available) {
    return res.status(503).json({ error: 'Phone notifications are not configured on the server.' });
  }

  const subscription = readSubscription(req.body);
  if (!subscription) {
    return res.status(400).json({ error: 'A valid push subscription is required.' });
  }

  try {
    const endpointHash = hashPushEndpoint(subscription.endpoint);
    await getPool().request()
      .input('userId', sql.NVarChar, req.user?.id!)
      .input('endpointHash', sql.Binary(32), endpointHash)
      .input('endpoint', sql.NVarChar(2048), subscription.endpoint)
      .input('p256dh', sql.NVarChar(255), subscription.p256dh)
      .input('auth', sql.NVarChar(255), subscription.auth)
      .query(`
        MERGE PushSubscriptions WITH (HOLDLOCK) AS target
        USING (SELECT @endpointHash AS endpointHash) AS source
        ON target.endpointHash = source.endpointHash
        WHEN MATCHED THEN
          UPDATE SET userId = @userId, endpoint = @endpoint, p256dh = @p256dh,
                     auth = @auth, updatedAt = GETUTCDATE()
        WHEN NOT MATCHED THEN
          INSERT (userId, endpointHash, endpoint, p256dh, auth)
          VALUES (@userId, @endpointHash, @endpoint, @p256dh, @auth);
      `);

    res.json({ enabled: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/subscription', async (req: Request, res: Response) => {
  const subscription = readSubscription(req.body);
  if (!subscription) {
    return res.status(400).json({ error: 'A valid push subscription is required.' });
  }

  try {
    await getPool().request()
      .input('userId', sql.NVarChar, req.user?.id!)
      .input('endpointHash', sql.Binary(32), hashPushEndpoint(subscription.endpoint))
      .query('DELETE FROM PushSubscriptions WHERE userId = @userId AND endpointHash = @endpointHash');

    res.json({ enabled: false });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;