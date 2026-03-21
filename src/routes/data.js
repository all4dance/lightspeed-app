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
    const { days = 30, store = 'both', format = 'json' } = req.query

    const STORE_MAP = {
      west: '1',
      south: '3'
    }

    if (!['west', 'south', 'both'].includes(store)) {
      return res.status(400).json({
        error: 'Invalid store. Use west, south, or both.'
      })
    }

    if (!['json', 'csv'].includes(format)) {
      return res.status(400).json({
        error: 'Invalid format. Use json or csv.'
      })
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - Number(days))
    const startIso = startDate.toISOString()

    const itemsData = await apiRequest(
      accountId,
      'Item.json?load_relations=["ItemShops"]&limit=10000'
    )

    const items = itemsData?.Item || []

    const salesData = await apiRequest(
      accountId,
      `Sale.json?timeStamp=>,${encodeURIComponent(startIso)}&load_relations=["SaleLines"]&limit=10000`
    )

    const sales = salesData?.Sale || []

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

    rows.sort((a, b) => b.qtyInSelectedStore - a.qtyInSelectedStore)

    if (format === 'csv') {
      const headers = [
        'Item ID',
        'Description',
        'Custom SKU',
        'UPC',
        'West Qty',
        'South Qty',
        'Total Qty',
        'Qty In Selected Store',
        'Qty Sold'
      ]

      const escapeCsv = (value) => {
        const stringValue = String(value ?? '')
        if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`
        }
        return stringValue
      }

      const csvRows = [
        headers.join(','),
        ...rows.map(row =>
          [
            row.itemId,
            row.description,
            row.customSku,
            row.upc,
            row.westQty,
            row.southQty,
            row.totalQty,
            row.qtyInSelectedStore,
            row.qtySold
          ].map(escapeCsv).join(',')
        )
      ]

      const csv = csvRows.join('\n')

      res.setHeader('Content-Type', 'text/csv')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="dust-report-${store}-${days}days.csv"`
      )

      return res.send(csv)
    }

    return res.json({
      success: true,
      report: 'dust',
      filters: {
        accountId,
        store,
        days: Number(days),
        startDate: startIso,
        format
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

// SLOW MOVERS REPORT
router.get('/reports/slow-movers/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params
    const { days = 30, store = 'both', maxSold = 2, format = 'json' } = req.query

    const STORE_MAP = {
      west: '1',
      south: '3'
    }

    if (!['west', 'south', 'both'].includes(store)) {
      return res.status(400).json({ error: 'Invalid store' })
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - Number(days))
    const startIso = startDate.toISOString()

    const itemsData = await apiRequest(
      accountId,
      'Item.json?load_relations=["ItemShops"]&limit=10000'
    )
    const items = itemsData?.Item || []

    const salesData = await apiRequest(
      accountId,
      `Sale.json?timeStamp=>,${encodeURIComponent(startIso)}&load_relations=["SaleLines"]&limit=10000`
    )
    const sales = salesData?.Sale || []

    const soldMap = {}

    for (const sale of sales) {
      let saleLines = []

      if (Array.isArray(sale.SaleLines)) {
        saleLines = sale.SaleLines
      } else if (Array.isArray(sale.SaleLines?.SaleLine)) {
        saleLines = sale.SaleLines.SaleLine
      } else if (sale.SaleLines?.SaleLine) {
        saleLines = [sale.SaleLines.SaleLine]
      }

      for (const line of saleLines) {
        const itemId = String(line.itemID || line.ItemID || '').trim()
        if (!itemId) continue

        const qty = Number(line.unitQuantity || line.UnitQuantity || 0)

        if (!soldMap[itemId]) soldMap[itemId] = 0
        soldMap[itemId] += qty
      }
    }

    const rows = []

    for (const item of items) {
      const itemId = String(item.itemID || item.ItemID || '').trim()
      if (!itemId) continue

      const description = item.description || item.Description || ''
      const customSku = item.customSku || item.CustomSKU || ''

      let westQty = 0
      let southQty = 0

      let itemShops = []
      if (Array.isArray(item.ItemShops)) {
        itemShops = item.ItemShops
      } else if (Array.isArray(item.ItemShops?.ItemShop)) {
        itemShops = item.ItemShops.ItemShop
      } else if (item.ItemShops?.ItemShop) {
        itemShops = [item.ItemShops.ItemShop]
      }

      for (const shop of itemShops) {
        const shopId = String(shop.shopID || shop.ShopID || '').trim()
        const qoh = Number(shop.qoh || shop.QOH || 0)

        if (shopId === STORE_MAP.west) westQty += qoh
        if (shopId === STORE_MAP.south) southQty += qoh
      }

      let selectedQty = 0
      if (store === 'west') selectedQty = westQty
      else if (store === 'south') selectedQty = southQty
      else selectedQty = westQty + southQty

      const qtySold = Number(soldMap[itemId] || 0)

      if (selectedQty > 0 && qtySold > 0 && qtySold <= Number(maxSold)) {
        rows.push({
          itemId,
          description,
          customSku,
          westQty,
          southQty,
          totalQty: westQty + southQty,
          qtySold
        })
      }
    }

    rows.sort((a, b) => a.qtySold - b.qtySold)

    if (format === 'csv') {
      const headers = [
        'Item ID',
        'Description',
        'Custom SKU',
        'West Qty',
        'South Qty',
        'Total Qty',
        'Qty Sold'
      ]

      const csvRows = [
        headers.join(','),
        ...rows.map(r =>
          [
            r.itemId,
            `"${r.description}"`,
            r.customSku,
            r.westQty,
            r.southQty,
            r.totalQty,
            r.qtySold
          ].join(',')
        )
      ]

      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="slow-movers.csv"`)

      return res.send(csvRows.join('\n'))
    }

    return res.json({
      success: true,
      report: 'slow-movers',
      count: rows.length,
      rows
    })
  } catch (err) {
    console.error('Slow movers error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// TEST SALE LINES
router.get('/reports/test-salelines/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 30)
    const startIso = startDate.toISOString()

    const saleLinesData = await apiRequest(
      accountId,
      `SaleLine.json?timeStamp=>,${encodeURIComponent(startIso)}&limit=20`
    )

    const saleLines = saleLinesData?.SaleLine || []

    return res.json({
      success: true,
      count: Array.isArray(saleLines) ? saleLines.length : 0,
      sample: saleLines
    })
  } catch (err) {
    console.error('Test sale lines error:', err.message)
    return res.status(500).json({
      error: err.message
    })
  }
})

router.get('/reports/test-item/:accountId/:itemId', async (req, res) => {
  try {
    const { accountId, itemId } = req.params

    const data = await apiRequest(
      accountId,
      `Item/${itemId}.json?load_relations=["ItemShops"]`
    )

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router