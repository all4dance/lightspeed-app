require('dotenv').config()

const express = require('express')

const authRoutes = require('./routes/auth')
const dataRoutes = require('./routes/data')

const app = express()

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