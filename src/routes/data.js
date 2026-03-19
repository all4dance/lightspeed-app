const express = require('express')
const router = express.Router()

const { apiRequest } = require('../lightspeed')

router.get('/items/:accountId', async (req, res) => {

  const { accountId } = req.params

  try {

    const data = await apiRequest(accountId, 'Item.json')

    res.json(data)

  } catch (err) {

    res.status(500).json({
      error: err.message
    })

  }

})

module.exports = router