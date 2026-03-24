// src/routes/debug.js
const express = require('express');
const router = express.Router();
const { apiRequest } = require('../lightspeed');  // adjust if lightspeed.js is in src/services/ or elsewhere

router.get('/shops/:accountId', async (req, res) => {
  const { accountId } = req.params;
  try {
    const data = await apiRequest(accountId, 'Shop.json?limit=100');
    res.json(data.Shop || data); // handles { Shop: [...] } or direct array
  } catch (err) {
    console.error('Shops fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Optional: quick test for items with shops (useful for debugging QOH fields)
router.get('/items-sample/:accountId', async (req, res) => {
  const { accountId } = req.params;
  try {
    const data = await apiRequest(accountId, 'Item.json?load_relations=["ItemShops"]&limit=2');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

 // DEBUG ITEMS SAMPLE
router.get('/reports/debug-items/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params

    const itemsData = await apiRequest(
      accountId,
      'Item.json?load_relations=["ItemShops"]&limit=5'
    )

    const items = getItemArray(itemsData)

    return res.json({
      success: true,
      count: items.length,
      sample: items.slice(0, 5)
    })
  } catch (err) {
    console.error('Debug items error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

module.exports = router;