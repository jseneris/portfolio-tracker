import { defineConfig } from 'vitest/config'
import dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.test for testing
dotenv.config({ path: resolve(process.cwd(), '.env.test') })

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    passWithNoTests: false,
    threads: false,  // Disable parallel execution to avoid database contention
    testTimeout: 30000,  // Increase timeout to 30s
  },
})
