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

router.get('/sales/:accountId', async (req, res) => {
  const { accountId } = req.params

  try {
    const data = await apiRequest(accountId, 'Sale.json')
    res.json(data)
  } catch (err) {
    res.status(500).json({
      error: err.message
    })
  }
})

// DUST REPORT
router.get('/reports/dust/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params
    const { days = 30, store = 'both' } = req.query

    const STORE_MAP = {
      west: '1',
      south: '3'
    }

    if (!['west', 'south', 'both'].includes(store)) {
      return res.status(400).json({
        error: 'Invalid store. Use west, south, or both.'
      })
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - Number(days))
    const startIso = startDate.toISOString()

    // 1) Pull items with ItemShops so we can see QOH per store
    const itemsData = await apiRequest(
      accountId,
      'Item.json?load_relations=["ItemShops"]&limit=10000'
    )

    const items = itemsData?.Item || []

    // 2) Pull sales since start date
    // We will use SaleLine relations if available
    const salesData = await apiRequest(
      accountId,
      `Sale.json?timeStamp=>,${encodeURIComponent(startIso)}&load_relations=["SaleLines"]&limit=10000`
    )

    const sales = salesData?.Sale || []

    // 3) Build sold qty map by itemID
    const soldMap = {}

    for (const sale of sales) {
      const saleLinesContainer = sale.SaleLines

      let saleLines = []
      if (Array.isArray(saleLinesContainer)) {
        saleLines = saleLinesContainer
      } else if (Array.isArray(saleLinesContainer?.SaleLine)) {
        saleLines = saleLinesContainer.SaleLine
      } else if (saleLinesContainer?.SaleLine) {
        saleLines = [saleLinesContainer.SaleLine]
      }

      for (const line of saleLines) {
        const itemId = String(line.itemID || line.ItemID || '').trim()
        if (!itemId) continue

        const qty = Number(line.unitQuantity || line.UnitQuantity || line.quantity || 0)

        if (!soldMap[itemId]) soldMap[itemId] = 0
        soldMap[itemId] += qty
      }
    }

    // 4) Build dust rows
    const rows = []

    for (const item of items) {
      const itemId = String(item.itemID || item.ItemID || '').trim()
      if (!itemId) continue

      const description = item.description || item.Description || ''
      const customSku = item.customSku || item.CustomSKU || ''
      const upc = item.upc || item.UPC || ''

      const itemShopsContainer = item.ItemShops

      let itemShops = []
      if (Array.isArray(itemShopsContainer)) {
        itemShops = itemShopsContainer
      } else if (Array.isArray(itemShopsContainer?.ItemShop)) {
        itemShops = itemShopsContainer.ItemShop
      } else if (itemShopsContainer?.ItemShop) {
        itemShops = [itemShopsContainer.ItemShop]
      }

      let westQty = 0
      let southQty = 0

      for (const shop of itemShops) {
        const shopId = String(shop.shopID || shop.ShopID || '').trim()
        const qoh = Number(shop.qoh || shop.QOH || shop.quantity || 0)

        if (shopId === STORE_MAP.west) westQty += qoh
        if (shopId === STORE_MAP.south) southQty += qoh
      }

      let selectedQty = 0
      if (store === 'west') selectedQty = westQty
      else if (store === 'south') selectedQty = southQty
      else selectedQty = westQty + southQty

      const qtySold = Number(soldMap[itemId] || 0)

      if (selectedQty > 0 && qtySold === 0) {
        rows.push({
          itemId,
          description,
          customSku,
          upc,
          westQty,
          southQty,
          totalQty: westQty + southQty,
          qtyInSelectedStore: selectedQty,
          qtySold
        })
      }
    }

    // 5) Sort biggest dust qty first
    rows.sort((a, b) => b.qtyInSelectedStore - a.qtyInSelectedStore)

    return res.json({
      success: true,
      report: 'dust',
      filters: {
        accountId,
        store,
        days: Number(days),
        startDate: startIso
      },
      count: rows.length,
      rows
    })
  } catch (err) {
    console.error('Dust report error:', err.message)
    return res.status(500).json({
      error: err.message
    })
  }
})

module.exports = router