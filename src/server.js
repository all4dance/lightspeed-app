require('dotenv').config()

const express = require('express')
const cors = require('cors')
const authRoutes = require('./routes/auth')
const dataRoutes = require('./routes/data')

const cron = require('node-cron')
const {
  refreshItemsCache,
  refreshSalesRange
} = require('./cache/reportCache')
const app = express()

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://reports.all4dance.ca')
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204)
  }

  next()
})
app.use(cors({
  origin: [
    'https://reports.all4dance.ca',
    'http://reports.all4dance.ca',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.use(express.json())

app.get('/', (req, res) => {
  res.send('Lightspeed API bridge is running')
})

app.use('/auth', authRoutes)
app.use('/api', dataRoutes)

// Add this block for debug routes
const debugRoutes = require('./routes/debug');
app.use('/api/debug', debugRoutes);   // ← your line


const CACHE_ACCOUNT_ID = '223888'

// Refresh items every 6 hours
cron.schedule('0 */6 * * *', async () => {
  try {
    console.log('Refreshing item cache...')
    await refreshItemsCache(CACHE_ACCOUNT_ID)
    console.log('Item cache refreshed')
  } catch (err) {
    console.error('Item cache refresh failed:', err.message)
  }
})

// Refresh sales every 10 minutes (SAFE version)
cron.schedule('*/10 * * * *', async () => {
  try {
    console.log('Running background sales cache...')
    await refreshSalesRange(CACHE_ACCOUNT_ID, 1)
    console.log('Sales cache updated')
  } catch (err) {
    console.error('Sales cache failed:', err.message)
  }
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})