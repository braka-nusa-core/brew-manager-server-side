import app from '../src/app.js'
import connectDB from '../src/config/db.js'
import { validateEnv } from '../src/config/env.js'

let isConnected = false

export default async function handler(req, res) {
  try {
    console.log('API HIT')

    validateEnv()
    console.log('ENV OK')

    if (!isConnected) {
      await connectDB()
      isConnected = true
      console.log('DB CONNECTED')
    }

    return app(req, res)
  } catch (error) {
    console.error('VERCEL RUNTIME ERROR:')
    console.error(error)
    console.error(error?.stack)

    return res.status(500).json({
      success: false,
      message: error?.message || 'Internal Server Error',
      stack: process.env.NODE_ENV === 'development'
        ? error?.stack
        : undefined,
    })
  }
}