const express = require('express')
const router = express.Router()
const { apiRequest } = require('../lightspeed')

const STORE_MAP = {
  west: '1',
  south: '3'
}

function getItemArray(itemsData) {
  if (Array.isArray(itemsData?.Item)) return itemsData.Item
  if (itemsData?.Item) return [itemsData.Item]
  return []
}

function getItemShops(item) {
  const itemShopsContainer = item.ItemShops

  if (Array.isArray(itemShopsContainer)) return itemShopsContainer
  if (Array.isArray(itemShopsContainer?.ItemShop)) return itemShopsContainer.ItemShop
  if (itemShopsContainer?.ItemShop) return [itemShopsContainer.ItemShop]

  return []
}

function getStoreQuantities(item) {
  const itemShops = getItemShops(item)

  let westQty = 0
  let southQty = 0

  for (const shop of itemShops) {
    const shopId = String(shop.shopID || shop.ShopID || '').trim()
    const qoh = Number(shop.qoh || shop.QOH || shop.quantity || 0)

    if (shopId === STORE_MAP.west) westQty += qoh
    if (shopId === STORE_MAP.south) southQty += qoh
  }

  return {
    westQty,
    southQty,
    totalQty: westQty + southQty
  }
}

function getSelectedQty(store, westQty, southQty) {
  if (store === 'west') return westQty
  if (store === 'south') return southQty
  return westQty + southQty
}

function escapeCsv(value) {
  const stringValue = String(value ?? '')
  if (
    stringValue.includes('"') ||
    stringValue.includes(',') ||
    stringValue.includes('\n')
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

async function buildSoldMap(accountId, startIso, store) {
  const saleLinesData = await apiRequest(
    accountId,
    `SaleLine.json?timeStamp=>,${encodeURIComponent(startIso)}&limit=10000`
  )

  const saleLines = Array.isArray(saleLinesData?.SaleLine)
    ? saleLinesData.SaleLine
    : saleLinesData?.SaleLine
      ? [saleLinesData.SaleLine]
      : []

  const soldMap = {}

  for (const line of saleLines) {
    const itemId = String(line.itemID || line.ItemID || '').trim()
    const shopId = String(line.shopID || line.ShopID || '').trim()

    if (!itemId) continue

    // Exclude non-normal retail movement
    if (String(line.isLayaway) === 'true') continue
    if (String(line.isSpecialOrder) === 'true') continue
    if (String(line.isWorkorder) === 'true') continue

    // Store filter
    if (store === 'west' && shopId !== STORE_MAP.west) continue
    if (store === 'south' && shopId !== STORE_MAP.south) continue

    const qty = Number(line.unitQuantity || line.UnitQuantity || line.quantity || 0)

    if (!soldMap[itemId]) soldMap[itemId] = 0
    soldMap[itemId] += qty
  }

  return soldMap
}

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

    const items = getItemArray(itemsData)
    const soldMap = await buildSoldMap(accountId, startIso, store)

    const rows = []

    for (const item of items) {
      const itemId = String(item.itemID || item.ItemID || '').trim()
      if (!itemId) continue

      const systemId = item.systemSku || item.SystemSku || ''
      const description = item.description || item.Description || ''
      const customSku = item.customSku || item.CustomSKU || ''
      const upc = item.upc || item.UPC || ''

      const { westQty, southQty, totalQty } = getStoreQuantities(item)
      const selectedQty = getSelectedQty(store, westQty, southQty)
      const qtySold = Number(soldMap[itemId] || 0)

      if (selectedQty > 0 && qtySold === 0) {
        rows.push({
          itemId,
          systemId,
          description,
          customSku,
          upc,
          westQty,
          southQty,
          totalQty,
          qtyInSelectedStore: selectedQty,
          qtySold
        })
      }
    }

    rows.sort((a, b) => b.qtyInSelectedStore - a.qtyInSelectedStore)

    if (format === 'csv') {
      const headers = [
        'Item ID',
        'System ID',
        'Description',
        'Custom SKU',
        'UPC',
        'West Qty',
        'South Qty',
        'Total Qty',
        'Qty In Selected Store',
        'Qty Sold'
      ]

      const csvRows = [
        headers.join(','),
        ...rows.map(row =>
          [
            row.itemId,
            row.systemId,
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
    const {
      days = 90,
      store = 'both',
      maxSold = 10,
      minStock = 2,
      format = 'json'
    } = req.query

    if (!['west', 'south', 'both'].includes(store)) {
      return res.status(400).json({ error: 'Invalid store' })
    }

    if (!['json', 'csv'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format. Use json or csv.' })
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - Number(days))
    const startIso = startDate.toISOString()

    const itemsData = await apiRequest(
      accountId,
      'Item.json?load_relations=["ItemShops"]&limit=10000'
    )

    const items = getItemArray(itemsData)
    const soldMap = await buildSoldMap(accountId, startIso, store)

    const rows = []

    for (const item of items) {
      const itemId = String(item.itemID || item.ItemID || '').trim()
      if (!itemId) continue

      const systemId = item.systemSku || item.SystemSku || ''
      const description = item.description || item.Description || ''
      const customSku = item.customSku || item.CustomSKU || ''
      const upc = item.upc || item.UPC || ''

      const { westQty, southQty, totalQty } = getStoreQuantities(item)
      const selectedQty = getSelectedQty(store, westQty, southQty)
      const qtySold = Number(soldMap[itemId] || 0)

      if (
  selectedQty >= Number(minStock) &&
  qtySold > 0 &&
  qtySold <= Number(maxSold)
) {
        rows.push({
          itemId,
          systemId,
          description,
          customSku,
          upc,
          westQty,
          southQty,
          totalQty,
          qtyInSelectedStore: selectedQty,
          qtySold
        })
      }
    }

    rows.sort((a, b) => {
      if (a.qtySold !== b.qtySold) return a.qtySold - b.qtySold
      return b.qtyInSelectedStore - a.qtyInSelectedStore
    })

    if (format === 'csv') {
      const headers = [
        'Item ID',
        'System ID',
        'Description',
        'Custom SKU',
        'UPC',
        'West Qty',
        'South Qty',
        'Total Qty',
        'Qty In Selected Store',
        'Qty Sold'
      ]

      const csvRows = [
        headers.join(','),
        ...rows.map(row =>
          [
            row.itemId,
            row.systemId,
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

      res.setHeader('Content-Type', 'text/csv')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="slow-movers-${store}-${days}days-max${maxSold}-minstock${minStock}.csv"`
      )

      return res.send(csvRows.join('\n'))
    }

    return res.json({
      success: true,
      report: 'slow-movers',
      filters: {
        accountId,
        store,
        days: Number(days),
        maxSold: Number(maxSold),
        minStock: Number(minStock),
        startDate: startIso,
        format
      },
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

    const saleLines = Array.isArray(saleLinesData?.SaleLine)
      ? saleLinesData.SaleLine
      : saleLinesData?.SaleLine
        ? [saleLinesData.SaleLine]
        : []

    return res.json({
      success: true,
      count: saleLines.length,
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

    return res.json(data)
  } catch (err) {
    console.error('Test item error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// TRANSFER OPPORTUNITIES REPORT
router.get('/reports/transfers/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params
    const {
      days = 90,
      minSales = 1,
      format = 'json'
    } = req.query

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

    const items = getItemArray(itemsData)

    const saleLinesData = await apiRequest(
      accountId,
      `SaleLine.json?timeStamp=>,${encodeURIComponent(startIso)}&limit=10000`
    )

    const saleLines = Array.isArray(saleLinesData?.SaleLine)
      ? saleLinesData.SaleLine
      : saleLinesData?.SaleLine
        ? [saleLinesData.SaleLine]
        : []

    const soldMapWest = {}
    const soldMapSouth = {}

    for (const line of saleLines) {
      const itemId = String(line.itemID || line.ItemID || '').trim()
      const shopId = String(line.shopID || line.ShopID || '').trim()

      if (!itemId) continue

      if (String(line.isLayaway) === 'true') continue
      if (String(line.isSpecialOrder) === 'true') continue
      if (String(line.isWorkorder) === 'true') continue

      const qty = Number(line.unitQuantity || line.UnitQuantity || line.quantity || 0)

      if (shopId === STORE_MAP.west) {
        if (!soldMapWest[itemId]) soldMapWest[itemId] = 0
        soldMapWest[itemId] += qty
      }

      if (shopId === STORE_MAP.south) {
        if (!soldMapSouth[itemId]) soldMapSouth[itemId] = 0
        soldMapSouth[itemId] += qty
      }
    }

    const rows = []

    for (const item of items) {
      const itemId = String(item.itemID || item.ItemID || '').trim()
      if (!itemId) continue

      const systemId = item.systemSku || item.SystemSku || ''
      const description = item.description || item.Description || ''
      const customSku = item.customSku || item.CustomSKU || ''
      const upc = item.upc || item.UPC || ''

      const { westQty, southQty, totalQty } = getStoreQuantities(item)
      const westSold = Number(soldMapWest[itemId] || 0)
      const southSold = Number(soldMapSouth[itemId] || 0)

      // SOUTH has stock, WEST is selling
      if (westSold >= Number(minSales) && southQty > 0) {
        rows.push({
          direction: 'SOUTH → WEST',
          itemId,
          systemId,
          description,
          customSku,
          upc,
          westQty,
          southQty,
          totalQty,
          westSold,
          southSold,
          opportunityScore: (westSold * 10) + southQty
        })
      }

      // WEST has stock, SOUTH is selling
      if (southSold >= Number(minSales) && westQty > 0) {
        rows.push({
          direction: 'WEST → SOUTH',
          itemId,
          systemId,
          description,
          customSku,
          upc,
          westQty,
          southQty,
          totalQty,
          westSold,
          southSold,
          opportunityScore: (southSold * 10) + westQty
        })
      }
    }

    rows.sort((a, b) => b.opportunityScore - a.opportunityScore)

    if (format === 'csv') {
      const headers = [
        'Direction',
        'Item ID',
        'System ID',
        'Description',
        'Custom SKU',
        'UPC',
        'West Qty',
        'South Qty',
        'Total Qty',
        'West Sold',
        'South Sold',
        'Opportunity Score'
      ]

      const csvRows = [
        headers.join(','),
        ...rows.map(row =>
          [
            row.direction,
            row.itemId,
            row.systemId,
            row.description,
            row.customSku,
            row.upc,
            row.westQty,
            row.southQty,
            row.totalQty,
            row.westSold,
            row.southSold,
            row.opportunityScore
          ].map(escapeCsv).join(',')
        )
      ]

      res.setHeader('Content-Type', 'text/csv')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="transfer-opportunities-${days}days.csv"`
      )

      return res.send(csvRows.join('\n'))
    }

    return res.json({
      success: true,
      report: 'transfers',
      filters: {
        accountId,
        days: Number(days),
        minSales: Number(minSales),
        startDate: startIso,
        format
      },
      count: rows.length,
      rows
    })
  } catch (err) {
    console.error('Transfer opportunities error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

module.exports = router