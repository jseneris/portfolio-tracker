import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import router from '../src/routes/user-settings.js';

const mocks = vi.hoisted(() => ({ input: vi.fn(), query: vi.fn() }));
vi.mock('../src/db/connection.js', () => ({
  getPool: () => ({ request: () => ({ input: mocks.input, query: mocks.query }) }),
}));

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 'settings-test-user' };
  next();
});
app.use('/settings', router);

const settings = {
  basePurchaseSize: 450.25,
  saleTargetPercent: 10,
  buyTargetPercentAtBaseSize: 10,
  buyTargetPercentBasePlus1: 15,
  buyTargetPercentBasePlus2: 20,
  buyTargetPercentBasePlus3OrMore: 25,
  buyOnDipBuyTargetPercent: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.input.mockImplementation(() => ({ input: mocks.input, query: mocks.query }));
});

describe('Base Purchase Size settings', () => {
  it('defaults to $300 when the user has no settings row', async () => {
    mocks.query.mockResolvedValue({ recordset: [] });
    const response = await request(app).get('/settings/targets').expect(200);
    expect(response.body).toEqual({ ...settings, basePurchaseSize: 300 });
    expect(mocks.query.mock.calls[0][0]).toContain('basePurchaseSize,');
  });

  it('saves the user-specific value for both inserts and updates and returns it on GET', async () => {
    mocks.query.mockResolvedValueOnce({ rowsAffected: [1] });
    const saved = await request(app).put('/settings/targets').send(settings).expect(200);
    expect(saved.body).toEqual(settings);
    expect(mocks.input).toHaveBeenCalledWith('userId', expect.anything(), 'settings-test-user');
    expect(mocks.input).toHaveBeenCalledWith('basePurchaseSize', expect.anything(), 450.25);
    const merge = mocks.query.mock.calls[0][0];
    expect(merge).toContain('ON target.userId = source.userId');
    expect(merge).toContain('UPDATE SET basePurchaseSize = @basePurchaseSize');
    expect(merge).toMatch(/INSERT\s*\([\s\S]*basePurchaseSize[\s\S]*VALUES\s*\([\s\S]*@basePurchaseSize/);

    mocks.query.mockResolvedValueOnce({ recordset: [settings] });
    const loaded = await request(app).get('/settings/targets').expect(200);
    expect(loaded.body).toEqual(settings);
  });

  it.each([0, -1, 0.001, 300.123, 10000000000, 'abc', null, undefined])('rejects invalid amount %s without writing', async (value) => {
    const response = await request(app).put('/settings/targets').send({ ...settings, basePurchaseSize: value }).expect(400);
    expect(response.body.error).toContain('basePurchaseSize');
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('surfaces database errors instead of claiming the settings were saved', async () => {
    mocks.query.mockRejectedValue(new Error('Database unavailable'));
    const response = await request(app).put('/settings/targets').send(settings).expect(500);
    expect(response.body.error).toContain('Database unavailable');
  });
});
