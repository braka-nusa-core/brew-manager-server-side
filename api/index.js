import app from '../src/app.js'
import connectDB from '../src/config/db.js'
import { validateEnv } from '../src/config/env.js'

let isConnected = false

export default async function handler(req, res) {
  try {
    validateEnv()
    if (!isConnected) {
      await connectDB()
      isConnected = true
    }

    return app(req, res)
  } catch (error) {
    console.error('Vercel Function Error:', error)

    return res.status(500).json({
      success: false,
      message: error.message || 'Internal Server Error',
    })
  }
}