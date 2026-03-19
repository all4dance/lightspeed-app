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

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})