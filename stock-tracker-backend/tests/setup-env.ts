import dotenv from 'dotenv'

// Ensure tests always load DB credentials from .env.test before app modules import.
dotenv.config({ path: '.env.test' })
process.env.NODE_ENV = 'test'
