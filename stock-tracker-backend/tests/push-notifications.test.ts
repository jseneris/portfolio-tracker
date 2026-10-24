import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendPushNotification } from '../src/services/push-notifications.js';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  input: vi.fn(),
  request: vi.fn(),
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock('../src/db/connection.js', () => ({
  getPool: () => ({ request: mocks.request }),
}));
vi.mock('web-push', () => ({
  default: {
    sendNotification: mocks.sendNotification,
    setVapidDetails: mocks.setVapidDetails,
  },
}));

const payload = { title: 'Target reached', body: 'A new message is available.', url: '/messages' };
const subscription = { endpoint: 'https://push.example.test/device', p256dh: 'key', auth: 'auth' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VAPID_PUBLIC_KEY', 'public');
  vi.stubEnv('VAPID_PRIVATE_KEY', 'private');
  vi.stubEnv('VAPID_SUBJECT', 'mailto:push@example.test');
  mocks.input.mockReturnThis();
  mocks.request.mockReturnValue({ input: mocks.input, query: mocks.query });
  mocks.sendNotification.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('push unread message counts', () => {
  it.each([0, 1, 124])('includes the exact total unread count (%s) on every device', async (count) => {
    mocks.query
      .mockResolvedValueOnce({ recordset: [subscription, { ...subscription, endpoint: `${subscription.endpoint}-2` }] })
      .mockResolvedValueOnce({ recordset: [{ count }] });

    expect(await sendPushNotification('user-a', payload)).toBe(2);

    expect(mocks.input.mock.calls).toEqual([['userId', expect.anything(), 'user-a'], ['userId', expect.anything(), 'user-a']]);
    expect(mocks.query).toHaveBeenLastCalledWith('SELECT COUNT(*) AS count FROM Messages WHERE userId = @userId AND isRead = 0');
    for (const call of mocks.sendNotification.mock.calls) {
      expect(JSON.parse(call[1])).toEqual({ ...payload, unreadCount: count });
      expect(call[2]).toEqual({ TTL: 60 });
    }
  });

  it('avoids querying messages when no devices are subscribed', async () => {
    mocks.query.mockResolvedValueOnce({ recordset: [] });
    expect(await sendPushNotification('user-a', payload)).toBe(0);
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('does not invent an unread count if the database returns no count', async () => {
    mocks.query
      .mockResolvedValueOnce({ recordset: [subscription] })
      .mockResolvedValueOnce({ recordset: [] });
    await expect(sendPushNotification('user-a', payload)).rejects.toThrow('Unable to determine the unread message count');
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('preserves the unconfigured push behavior', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    expect(await sendPushNotification('user-a', payload)).toBe(0);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
