import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { getPool } from '../db/connection.js';
import { MAX_CHAT_QUESTION_CHARACTERS, MAX_CHAT_ANSWER_CHARACTERS } from '../services/portfolio-chat-limits.js';

const router = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseSelectedIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_LIMIT) return null;
  if (value.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))) return null;
  return Array.from(new Set(value as string[]));
}

function mapMessage(row: any) {
  return {
    id: String(row.id).toLowerCase(),
    type: row.type,
    ticker: row.ticker,
    targetPrice: row.targetPrice == null ? null : Number(row.targetPrice),
    triggerPrice: row.triggerPrice == null ? null : Number(row.triggerPrice),
    body: row.body,
    isRead: Boolean(row.isRead),
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

router.post(['/ai-chat', '/review-section'], async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });

  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim() : '';
  const isSection = req.path === '/review-section';
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (isSection && (
    !['Largest concentrations', 'Loss-review timing'].includes(title) ||
    !content || content.length > 50000
  )) {
    return res.status(400).json({ error: 'A supported review section title and content of up to 50000 characters are required.' });
  }
  if (!isSection && (!question || question.length > MAX_CHAT_QUESTION_CHARACTERS || !answer || answer.length > MAX_CHAT_ANSWER_CHARACTERS)) {
    return res.status(400).json({ error: `A question of up to ${MAX_CHAT_QUESTION_CHARACTERS} characters and an answer of up to ${MAX_CHAT_ANSWER_CHARACTERS} characters are required.` });
  }

  try {
    const access = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .query('SELECT aiInsightsEnabled FROM Users WHERE id = @userId');
    if (!access.recordset[0]?.aiInsightsEnabled) {
      return res.status(403).json({ error: 'Portfolio insights are not enabled for this user.' });
    }
    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .input('body', sql.NVarChar(sql.MAX), isSection
        ? `Review section: ${title}\n\n${content}`
        : `Question:\n${question}\n\nAI response:\n${answer}`)
      .query(`
        INSERT INTO Messages (userId, type, ticker, targetPrice, triggerPrice, body)
        OUTPUT inserted.id, inserted.type, inserted.ticker, inserted.targetPrice, inserted.triggerPrice,
               inserted.body, inserted.isRead, inserted.readAt, inserted.createdAt
        VALUES (@userId, 'ai-chat', NULL, NULL, NULL, @body)
      `);
    const row = result.recordset[0];
    if (!row) throw new Error('Saved AI chat message was not returned.');
    res.status(201).json(mapMessage(row));
  } catch (error) {
    console.error('Unable to save AI chat message:', error);
    res.status(500).json({ error: 'Unable to save this response to Messages. Please try again.' });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id!;
    const unreadOnly = String(req.query.unreadOnly || '').toLowerCase() === 'true';
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

    const result = await getPool().request()
      .input('userId', sql.NVarChar, userId)
      .input('limit', sql.Int, limit)
      .input('unreadOnly', sql.Bit, unreadOnly)
      .query(`
        SELECT TOP (@limit) id, type, ticker, targetPrice, triggerPrice, body, isRead, readAt, createdAt
        FROM Messages
        WHERE userId = @userId AND (@unreadOnly = 0 OR isRead = 0)
        ORDER BY createdAt DESC
      `);

    res.json(result.recordset.map(mapMessage));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const result = await getPool().request()
      .input('userId', sql.NVarChar, req.user?.id!)
      .query('SELECT COUNT(*) AS count FROM Messages WHERE userId = @userId AND isRead = 0');

    res.json({ count: Number(result.recordset[0]?.count || 0) });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/read-all', async (req: Request, res: Response) => {
  try {
    const result = await getPool().request()
      .input('userId', sql.NVarChar, req.user?.id!)
      .query(`
        UPDATE Messages
        SET isRead = 1, readAt = GETUTCDATE()
        WHERE userId = @userId AND isRead = 0
      `);

    res.json({ updated: result.rowsAffected[0] ?? 0 });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/read-selected', async (req: Request, res: Response) => {
  const ids = parseSelectedIds(req.body?.ids);
  if (!ids) {
    return res.status(400).json({ error: 'Select between 1 and 200 valid message IDs.' });
  }

  try {
    const dbRequest = getPool().request().input('userId', sql.NVarChar, req.user?.id!);
    const idParameters = ids.map((id, index) => {
      dbRequest.input(`id${index}`, sql.UniqueIdentifier, id);
      return `@id${index}`;
    });
    const result = await dbRequest.query(`
      UPDATE Messages
      SET isRead = 1, readAt = COALESCE(readAt, GETUTCDATE())
      WHERE userId = @userId AND isRead = 0 AND id IN (${idParameters.join(', ')})
    `);

    res.json({ updated: result.rowsAffected[0] ?? 0 });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/', async (req: Request, res: Response) => {
  const ids = parseSelectedIds(req.body?.ids);
  if (!ids) {
    return res.status(400).json({ error: 'Select between 1 and 200 valid message IDs.' });
  }

  try {
    const dbRequest = getPool().request().input('userId', sql.NVarChar, req.user?.id!);
    const idParameters = ids.map((id, index) => {
      dbRequest.input(`id${index}`, sql.UniqueIdentifier, id);
      return `@id${index}`;
    });
    const result = await dbRequest.query(`
      DELETE FROM Messages
      WHERE userId = @userId AND id IN (${idParameters.join(', ')})
    `);

    res.json({ deleted: result.rowsAffected[0] ?? 0 });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Opening a message marks it read.
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!UUID_PATTERN.test(id)) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const result = await getPool().request()
      .input('id', sql.UniqueIdentifier, id)
      .input('userId', sql.NVarChar, req.user?.id!)
      .query(`
        UPDATE Messages
        SET isRead = 1, readAt = COALESCE(readAt, GETUTCDATE())
        OUTPUT inserted.id, inserted.type, inserted.ticker, inserted.targetPrice, inserted.triggerPrice,
               inserted.body, inserted.isRead, inserted.readAt, inserted.createdAt
        WHERE id = @id AND userId = @userId
      `);

    const row = result.recordset[0];
    if (!row) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json(mapMessage(row));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
