require('dotenv').config()

const express = require('express')
const cors = require('cors')
const path = require('path')

const authRoutes = require('./routes/auth')
const dataRoutes = require('./routes/data')
const debugRoutes = require('./routes/debug')

const cron = require('node-cron')
const {
  refreshItemsCache,
  refreshSalesRange
} = require('./cache/reportCache')

const app = express()

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'https://reports.all4dance.ca',
  'http://reports.all4dance.ca',
  'https://lightspeed-app-production.up.railway.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin)
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.use(express.json())

// ─── SERVE FRONTEND ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')))

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.use('/auth', authRoutes)
app.use('/api', dataRoutes)
app.use('/api/debug', debugRoutes)

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── SPA FALLBACK ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
})

// ─── BACKGROUND JOBS ─────────────────────────────────────────────────────────
const CACHE_ACCOUNT_ID = '223888'

// Refresh items every 6 hours
cron.schedule('0 */6 * * *', async () => {
  try {
    console.log('[CRON] Refreshing item cache...')
    await refreshItemsCache(CACHE_ACCOUNT_ID)
    console.log('[CRON] Item cache refreshed')
  } catch (err) {
    console.error('[CRON] Item cache refresh failed:', err.message)
  }
})

// Refresh today's sales every 10 minutes
cron.schedule('*/10 * * * *', async () => {
  try {
    console.log('[CRON] Running background sales cache...')
    await refreshSalesRange(CACHE_ACCOUNT_ID, 1)
    console.log('[CRON] Sales cache updated')
  } catch (err) {
    console.error('[CRON] Sales cache failed:', err.message)
  }
})

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`✓ All 4 Dance Reports server running on port ${PORT}`)
  console.log(`  Dashboard: http://localhost:${PORT}`)
  console.log(`  API:       http://localhost:${PORT}/api`)
  console.log(`  Auth:      http://localhost:${PORT}/auth/connect`)
})
