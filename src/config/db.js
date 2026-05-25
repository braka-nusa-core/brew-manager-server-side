// ============================================================
// config/db.js
// MongoDB connection via Mongoose.
//
// Design decisions:
//   - connectDB() is called only from server.js — not from app.js.
//     This keeps the HTTP server lifecycle separate from the
//     DB connection lifecycle.
//   - Connection events are logged so operators can observe
//     reconnection behavior in production without reading
//     Mongoose internals.
//   - The function is async and awaited in server.js — if the
//     initial connection fails, the server does not start.
// ============================================================

import mongoose from 'mongoose'
import { env }  from './env.js'
import logger   from '../utils/logger.js'

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(env.MONGO_URI)

    logger.info(`MongoDB connected: ${conn.connection.host}`, {
      db: conn.connection.name,
    })
  } catch (err) {
    logger.error('MongoDB connection failed', { error: err.message })
    process.exit(1)
  }
}

// Log subsequent connection events (reconnects, drops)
mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected — attempting reconnect...')
})

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected')
})

export default connectDB
