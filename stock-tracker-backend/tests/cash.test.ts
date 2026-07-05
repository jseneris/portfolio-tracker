import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer } from '../src/index.js'
import { closeDatabase } from '../src/db/connection.js'

let server: any
const API_PATH = '/api/cash'
const TEST_USER_ID = 'test-user'

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  server = await startServer()
})

afterAll(async () => {
  if (server && server.close) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  await closeDatabase()
})

describe('Cash transaction API', () => {
  let createdId: string

  it('creates a cash transaction', async () => {
    const response = await request(server)
      .post(API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({
        type: 'deposit',
        amount: 100.5,
        transactionDate: '2026-07-03',
      })
      .expect(201)

    expect(response.body).toHaveProperty('id')
    expect(response.body.type).toBe('deposit')
    expect(response.body.amount).toBe(100.5)
    expect(response.body.transactionDate).toBe('2026-07-03')
    createdId = response.body.id
  })

  it('retrieves saved cash transactions', async () => {
    const response = await request(server)
      .get(API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(Array.isArray(response.body)).toBe(true)
    console.log('id', response.body.map((tx: any) => tx.id))
    console.log('createdId', createdId);
    expect(response.body.some((tx: any) => tx.id === createdId.toUpperCase())).toBe(true)
  })

  it('deletes a cash transaction', async () => {
    await request(server)
      .delete(`${API_PATH}/${createdId}`)
      .set('x-user-id', TEST_USER_ID)
      .expect(204)

    const response = await request(server)
      .get(API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    expect(response.body.some((tx: any) => tx.id === createdId.toUpperCase())).toBe(false)
  })
})
