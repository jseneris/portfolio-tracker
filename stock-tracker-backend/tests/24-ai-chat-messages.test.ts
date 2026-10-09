import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import sql from 'mssql';
import messagesRouter from '../src/routes/messages.js';

const mocks = vi.hoisted(() => ({ query: vi.fn(), input: vi.fn() }));
vi.mock('../src/db/connection.js', () => ({
  getPool: () => ({ request: () => ({ input: mocks.input, query: mocks.query }) }),
}));
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const id = req.header('x-user-id');
  if (id) req.user = { id };
  next();
});
app.use('/messages', messagesRouter);
const message = {
  id: 'ABCDEF01-1234-1234-1234-123456789ABC',
  type: 'ai-chat', ticker: null, targetPrice: null, triggerPrice: null,
  body: 'Question:\nMy question\n\nAI response:\nMy answer',
  isRead: false, readAt: null, createdAt: '2026-10-05T20:00:00Z',
};
function allowAccess() {
  mocks.query.mockResolvedValueOnce({ recordset: [{ aiInsightsEnabled: true }] });
}

describe('saving AI chat to Messages', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.input.mockImplementation(() => ({ input: mocks.input, query: mocks.query }));
  });

  it.each(['Largest concentrations', 'Loss-review timing', 'Recommended lot amount'])('saves a complete %s section beyond chat-answer limits', async (title) => {
    const content = 'x'.repeat(12000);
    const body = `Review section: ${title}\n\n${content}`;
    allowAccess();
    mocks.query.mockResolvedValueOnce({ recordset: [{ ...message, body }] });
    const response = await request(app).post('/messages/review-section').set('x-user-id', 'owner')
      .send({ title, content }).expect(201);
    expect(response.body.body).toBe(body);
    expect(response.body.isRead).toBe(false);
    expect(mocks.input).toHaveBeenCalledWith('body', sql.NVarChar(sql.MAX), body);
    expect(mocks.input).toHaveBeenCalledWith('userId', sql.NVarChar, 'owner');
  });

  it.each([
    { title: 'Unknown', content: 'text' },
    { title: 'Largest concentrations', content: '' },
    { title: 'Loss-review timing', content: 'x'.repeat(50001) },
  ])('rejects invalid review sections', async (payload) => {
    await request(app).post('/messages/review-section').set('x-user-id', 'owner').send(payload).expect(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('preserves structured review formatting when saving, listing and opening messages', async () => {
    const title = 'Loss-review timing';
    const content = 'Formatted review v1:\n' + JSON.stringify({
      version: 1, title, generatedAt: '2026-10-08T20:00:00Z',
      description: 'Tracked timing only.',
      headers: ['Ticker', 'Yearly Gain/Loss'],
      rows: [[{ text: 'TEST', tone: 'positive' }, { text: '-$250.00', tone: 'negative' }]],
      commentary: [], emptyText: 'No matches.', limitations: ['Not confirmed eligibility.'],
    });
    const body = `Review section: ${title}\n\n${content}`;
    const saved = { ...message, body };
    allowAccess();
    mocks.query.mockResolvedValueOnce({ recordset: [saved] });
    await request(app).post('/messages/review-section').set('x-user-id', 'owner')
      .send({ title, content }).expect(201).expect((response) => expect(response.body.body).toBe(body));
    expect(mocks.input).toHaveBeenCalledWith('body', sql.NVarChar(sql.MAX), body);
    mocks.query.mockResolvedValueOnce({ recordset: [saved] });
    const list = await request(app).get('/messages').set('x-user-id', 'owner').expect(200);
    expect(list.body[0].body).toBe(body);
    mocks.query.mockResolvedValueOnce({ recordset: [{ ...saved, isRead: true }] });
    const opened = await request(app).get(`/messages/${message.id}`).set('x-user-id', 'owner').expect(200);
    expect(opened.body.body).toBe(body);
  });

  it('saves the full question and answer as an unread message owned by the authenticated user', async () => {
    const question = 'q'.repeat(2000);
    const answer = 'a'.repeat(8000);
    const body = `Question:\n${question}\n\nAI response:\n${answer}`;
    allowAccess();
    mocks.query.mockResolvedValueOnce({ recordset: [{ ...message, body }] });
    const response = await request(app).post('/messages/ai-chat').set('x-user-id', 'owner')
      .send({ question, answer, userId: 'not-owner' }).expect(201);
    expect(response.body).toMatchObject({
      ...message, id: message.id.toLowerCase(), body, triggerPrice: null,
    });
    expect(mocks.input).toHaveBeenCalledWith('userId', sql.NVarChar, 'owner');
    expect(mocks.input).not.toHaveBeenCalledWith('userId', sql.NVarChar, 'not-owner');
    expect(mocks.input).toHaveBeenCalledWith('body', sql.NVarChar(sql.MAX), body);
    expect(mocks.query.mock.calls[1][0]).toContain("VALUES (@userId, 'ai-chat', NULL, NULL, NULL, @body)");
  });

  it('requires authentication and enabled insights', async () => {
    await request(app).post('/messages/ai-chat').send({ question: 'q', answer: 'a' }).expect(401);
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.query.mockResolvedValueOnce({ recordset: [{ aiInsightsEnabled: false }] });
    await request(app).post('/messages/ai-chat').set('x-user-id', 'owner')
      .send({ question: 'q', answer: 'a' }).expect(403);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    {}, { question: '', answer: 'a' }, { question: 'q', answer: '   ' },
    { question: 123, answer: 'a' }, { question: 'q', answer: {} },
    { question: 'q'.repeat(2001), answer: 'a' },
    { question: 'q', answer: 'a'.repeat(8001) },
  ])('rejects invalid content before any database write: %j', async (payload) => {
    await request(app).post('/messages/ai-chat').set('x-user-id', 'owner').send(payload).expect(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('lists and opens AI messages without inventing a trigger price, while preserving alerts', async () => {
    const alert = { ...message, type: 'sell-target-hit', ticker: 'AAPL', triggerPrice: '125.5', targetPrice: '120' };
    mocks.query.mockResolvedValueOnce({ recordset: [message, alert] });
    const list = await request(app).get('/messages').set('x-user-id', 'owner').expect(200);
    expect(list.body[0].triggerPrice).toBeNull();
    expect(list.body[1]).toMatchObject({ ticker: 'AAPL', triggerPrice: 125.5, targetPrice: 120 });
    mocks.query.mockResolvedValueOnce({ recordset: [{ ...message, isRead: true }] });
    const opened = await request(app).get(`/messages/${message.id}`).set('x-user-id', 'owner').expect(200);
    expect(opened.body).toMatchObject({ type: 'ai-chat', isRead: true, body: message.body });
    expect(mocks.query.mock.calls[1][0]).toContain('WHERE id = @id AND userId = @userId');
  });

  it('surfaces persistence failures without reporting success', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      allowAccess();
      mocks.query.mockRejectedValueOnce(new Error('save failed'));
      await request(app).post('/messages/ai-chat').set('x-user-id', 'owner')
        .send({ question: 'q', answer: 'a' }).expect(500);
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
