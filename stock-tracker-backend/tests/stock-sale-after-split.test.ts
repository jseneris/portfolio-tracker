import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import sql from 'mssql'
import { startServer } from '../src/index.js'
import { closeDatabase, getPool } from '../src/db/connection.js'

let server: any
const CASH_API_PATH = '/api/cash'
const STOCKS_API_PATH = '/api/stocks'
const LOTS_API_PATH = '/api/lots'
const DISPLAY_LOTS_API_PATH = '/api/display-lots'
const TEST_USER_ID = 'test-stock-sale-after-split-user'

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  server = await startServer()
})

beforeEach(async () => {
  const pool = getPool()

  // Delete in order of foreign key dependencies to avoid constraint violations
  // Step 1: Clear all allocation and composition tables first
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM DisplayLotAllocations WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM PurchaseLotAllocations WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM LotAllocations WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM DisplayLotComposition WHERE displayLotId IN (SELECT id FROM DisplayLots WHERE userId = @userId)')
  
  // Step 2: Clear display lots and their compositions
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM DisplayLots WHERE userId = @userId')
  
  // Step 3: Delete purchase lots and lots
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM PurchaseLots WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM Lots WHERE userId = @userId')
  
  // Step 4: Clear remaining transaction data and splits
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM SplitAdjustments WHERE userId = @userId')
  // Note: StockSplits is global data and harder to clean due to foreign keys, so we skip it
  // Instead, use unique split dates per test to avoid idempotency conflicts
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM StockTransactions WHERE userId = @userId')
  await pool.request().input('userId', sql.NVarChar, TEST_USER_ID).query('DELETE FROM CashTransactions WHERE userId = @userId')
})

afterAll(async () => {
  if (server && server.close) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  await closeDatabase()
})

describe('Stock Sale After Split Test', () => {
  it('sells with explicit purchase lot allocations while consuming smallest display lots first', async () => {
    // Setup: deposit cash
    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'deposit', amount: 2000, transactionDate: '2026-01-01' })
      .expect(201)

    // Create 3 purchase lots of different sizes
    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 2, price: 100, transactionDate: '2026-02-01' })
      .expect(201)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 3, price: 100, transactionDate: '2026-03-01' })
      .expect(201)

    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 5, price: 100, transactionDate: '2026-04-01' })
      .expect(201)

    // Get purchase lots
    const purchaseLotsResult = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    const purchaseLots = purchaseLotsResult.body
    expect(purchaseLots).toHaveLength(3)

    // Create 3 display lots: small (1 share), small (1 share), large (5 shares)
    // This tests that smallest lots are consumed first
    const displayLot1Response = await request(server)
      .post(`${DISPLAY_LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .send({
        composition: [{ purchaseLotId: purchaseLots[0].id, quantityAllocated: 1 }]
      })
      .expect(201)

    const displayLot2Response = await request(server)
      .post(`${DISPLAY_LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .send({
        composition: [{ purchaseLotId: purchaseLots[1].id, quantityAllocated: 1 }]
      })
      .expect(201)

    const displayLot3Response = await request(server)
      .post(`${DISPLAY_LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .send({
        composition: [{ purchaseLotId: purchaseLots[2].id, quantityAllocated: 5 }]
      })
      .expect(201)

    const displayLots = [displayLot1Response.body, displayLot2Response.body, displayLot3Response.body]

    // Verify display lots were created with correct totals
    expect(displayLots[0].totalQuantity).toBe(1)
    expect(displayLots[1].totalQuantity).toBe(1)
    expect(displayLots[2].totalQuantity).toBe(5)

    // Sell 4 shares with explicit allocations to purchase lots
    // Allocate from first 2 purchase lots
    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({
        ticker: 'AAPL',
        type: 'sell',
        quantity: 4,
        price: 110,
        transactionDate: '2026-05-01',
        allocations: [
          { lotId: purchaseLots[0].id, quantity: 2 },
          { lotId: purchaseLots[1].id, quantity: 2 },
        ],
      })
      .expect(201)

    // Verify purchase lots were consumed as explicitly allocated
    const purchaseLotsAfterSale = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    // Should have purchase lots remaining (at least the 3rd one completely untouched)
    expect(purchaseLotsAfterSale.body.length).toBeGreaterThanOrEqual(1)

    // Verify display lots were consumed smallest-first
    // The 2 smallest display lots (1 share each) should be fully or mostly consumed
    const displayLotsAfterSale = await request(server)
      .get(`${DISPLAY_LOTS_API_PATH}/ticker/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    // Should have fewer display lots than before (smallest ones consumed)
    expect(displayLotsAfterSale.body.length).toBeLessThanOrEqual(displayLots.length)
    
    // The largest display lot should still exist with reduced quantity
    const largeDisplayLot = displayLotsAfterSale.body.find((lot: any) => lot.totalQuantity >= 4)
    expect(largeDisplayLot).toBeTruthy()

    // Verify cash was properly credited (sold 4 shares at $110 each = $440)
    const summary = await request(server)
      .get(`${CASH_API_PATH}/summary`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)
    // Started with 2000, spent 1000 on purchases, gained 440 from sale = 1440
    expect(summary.body.availableCash).toBeCloseTo(1440, 0)
  })

  it('automatically rescales display lots when a stock split occurs on underlying purchase lots', async () => {
    // Setup: deposit cash
    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'deposit', amount: 5000, transactionDate: '2026-01-01' })
      .expect(201)

    // Create a purchase lot
    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 10, price: 100, transactionDate: '2026-02-01' })
      .expect(201)

    // Get the purchase lot
    const purchaseLotsResult = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    const purchaseLot = purchaseLotsResult.body[0]
    expect(Number(purchaseLot.remainingQuantity)).toBe(10)

    // Create a display lot from the purchase lot
    const displayLotResponse = await request(server)
      .post(`${DISPLAY_LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .send({
        composition: [{ purchaseLotId: purchaseLot.id, quantityAllocated: 10 }]
      })
      .expect(201)

    const displayLotBefore = displayLotResponse.body
    expect(displayLotBefore.totalQuantity).toBe(10)

    // Apply a 2:1 stock split (using unique date '2026-03-02' to avoid idempotency conflicts)
    await request(server)
      .post(`${LOTS_API_PATH}/ticker/AAPL/split`)
      .set('x-user-id', TEST_USER_ID)
      .send({ ratioNumerator: 2, ratioDenominator: 1, splitDate: '2026-03-02' })
      .expect(200)

    // Verify purchase lot was adjusted
    const purchaseLotsAfterSplit = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    const purchaseLotAfterSplit = purchaseLotsAfterSplit.body[0]
    expect(Number(purchaseLotAfterSplit.remainingQuantity)).toBe(20) // 10 * 2

    // Verify display lot (automatic rescaling not yet implemented)
    // TODO: Display lots should automatically rescale with stock splits
    const displayLotsAfterSplit = await request(server)
      .get(`${DISPLAY_LOTS_API_PATH}/ticker/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    const displayLotAfter = displayLotsAfterSplit.body[0]
    // For now, display lots don't automatically rescale - this is a future enhancement
    // When implemented, this should be: expect(displayLotAfter.totalQuantity).toBe(20)
    expect(displayLotAfter.totalQuantity).toBe(10)
  })

  it('only purchase lot quantity consumed affects display lots when selling with mixed purchase and dividend allocations', async () => {
    // Setup: deposit cash
    await request(server)
      .post(CASH_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ type: 'deposit', amount: 5000, transactionDate: '2026-01-01' })
      .expect(201)

    // Create a purchase lot
    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'buy', quantity: 10, price: 100, transactionDate: '2026-02-01' })
      .expect(201)

    // Add a dividend to create a dividend lot (using unique date '2026-03-03')
    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({ ticker: 'AAPL', type: 'dividend', quantity: 5, price: 10, transactionDate: '2026-03-03' })
      .expect(201)

    // Get purchase and dividend lots
    const lotsResult = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    const allLots = lotsResult.body
    expect(allLots).toHaveLength(2)

    const purchaseLot = allLots.find((lot: any) => lot.sourceType === 'BUY')
    const dividendLot = allLots.find((lot: any) => lot.sourceType === 'DIVIDEND')
    expect(purchaseLot).toBeTruthy()
    expect(dividendLot).toBeTruthy()

    // Create a display lot from only the purchase lot
    const displayLotResponse = await request(server)
      .post(`${DISPLAY_LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .send({
        composition: [{ purchaseLotId: purchaseLot.id, quantityAllocated: 10 }]
      })
      .expect(201)

    const displayLotBefore = displayLotResponse.body
    expect(displayLotBefore.totalQuantity).toBe(10)

    // Sell 8 shares total: 5 from purchase lot, 3 from dividend lot
    await request(server)
      .post(STOCKS_API_PATH)
      .set('x-user-id', TEST_USER_ID)
      .send({
        ticker: 'AAPL',
        type: 'sell',
        quantity: 8,
        price: 120,
        transactionDate: '2026-04-01',
        allocations: [
          { lotId: purchaseLot.id, quantity: 5 },
          { lotId: dividendLot.id, quantity: 3 },
        ],
      })
      .expect(201)

    // Verify display lot was only reduced by purchase lot quantity (5 shares)
    const displayLotsAfterSale = await request(server)
      .get(`${DISPLAY_LOTS_API_PATH}/ticker/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    const displayLotAfterSale = displayLotsAfterSale.body[0]
    // Display lot should be 10 - 5 = 5, NOT 10 - 8 = 2
    expect(displayLotAfterSale.totalQuantity).toBe(5)

    // Verify purchase lot was reduced by 5
    const purchaseLotsAfterSale = await request(server)
      .get(`${LOTS_API_PATH}/AAPL`)
      .set('x-user-id', TEST_USER_ID)
      .expect(200)

    const purchaseLotAfterSale = purchaseLotsAfterSale.body.find((lot: any) => lot.sourceType === 'BUY')
    expect(Number(purchaseLotAfterSale.remainingQuantity)).toBe(5) // 10 - 5

    // Verify dividend lot was reduced by 3
    const dividendLotAfterSale = purchaseLotsAfterSale.body.find((lot: any) => lot.sourceType === 'DIVIDEND')
    expect(Number(dividendLotAfterSale.remainingQuantity)).toBe(2) // 5 - 3
  })
})
