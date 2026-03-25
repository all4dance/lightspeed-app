require('dotenv').config()

const express = require('express')
const cors = require('cors')
const authRoutes = require('./routes/auth')
const dataRoutes = require('./routes/data')

const app = express()
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

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})