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

async function apiRequestAll(accountId, endpointBase) {
  let allRows = []
  let offset = 0
  const limit = 1000

  while (true) {
    const separator = endpointBase.includes('?') ? '&' : '?'
    const endpoint = `${endpointBase}${separator}limit=${limit}&offset=${offset}`

    const data = await apiRequest(accountId, endpoint)

    let rows = []

    if (Array.isArray(data?.Item)) rows = data.Item
    else if (data?.Item) rows = [data.Item]
    else if (Array.isArray(data?.SaleLine)) rows = data.SaleLine
    else if (data?.SaleLine) rows = [data.SaleLine]
    else if (Array.isArray(data?.Customer)) rows = data.Customer
    else if (data?.Customer) rows = [data.Customer]
    else if (Array.isArray(data?.Category)) rows = data.Category
    else if (data?.Category) rows = [data.Category]
    else if (Array.isArray(data?.Manufacturer)) rows = data.Manufacturer
    else if (data?.Manufacturer) rows = [data.Manufacturer]
    else if (Array.isArray(data?.Vendor)) rows = data.Vendor
    else if (data?.Vendor) rows = [data.Vendor]
    else if (Array.isArray(data?.Department)) rows = data.Department
    else if (data?.Department) rows = [data.Department]

    allRows = allRows.concat(rows)

    if (rows.length < limit) break
    offset += limit
  }

  return allRows
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

function getCustomerArray(customersData) {
  if (Array.isArray(customersData?.Customer)) return customersData.Customer
  if (customersData?.Customer) return [customersData.Customer]
  return []
}

function getCategoryArray(categoriesData) {
  if (Array.isArray(categoriesData?.Category)) return categoriesData.Category
  if (categoriesData?.Category) return [categoriesData.Category]
  return []
}

function getManufacturerArray(manufacturersData) {
  if (Array.isArray(manufacturersData?.Manufacturer)) return manufacturersData.Manufacturer
  if (manufacturersData?.Manufacturer) return [manufacturersData.Manufacturer]
  return []
}

function getVendorArray(vendorsData) {
  if (Array.isArray(vendorsData?.Vendor)) return vendorsData.Vendor
  if (vendorsData?.Vendor) return [vendorsData.Vendor]
  return []
}

function getDepartmentArray(departmentsData) {
  if (Array.isArray(departmentsData?.Department)) return departmentsData.Department
  if (departmentsData?.Department) return [departmentsData.Department]
  return []
}

function parseNumber(value) {
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '')
  return cleaned ? Number(cleaned) : 0
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
}

function roundUpToThree(value) {
  if (value <= 0) return 0
  return Math.ceil(value / 3) * 3
}

function calculateOrderQty(qtySold, totalStock, brand) {
  const rawNeed = Math.max(0, Number(qtySold || 0) - Number(totalStock || 0))
  if (!rawNeed) return 0
  return normalizeText(brand) === 'mondor' ? roundUpToThree(rawNeed) : rawNeed
}

function parseCustomerTags(customer) {
  const possible = [
    customer.tags,
    customer.Tags,
    customer.tag,
    customer.Tag,
    customer.customerTags,
    customer.CustomerTags,
    customer.note,
    customer.Note
  ]

  const rawValues = []

  for (const value of possible) {
    if (!value) continue

    if (Array.isArray(value)) {
      rawValues.push(...value.map(v => String(v || '').trim()).filter(Boolean))
      continue
    }

    if (typeof value === 'object') {
      for (const innerValue of Object.values(value)) {
        if (Array.isArray(innerValue)) {
          rawValues.push(...innerValue.map(v => String(v || '').trim()).filter(Boolean))
        } else if (innerValue && typeof innerValue !== 'object') {
          rawValues.push(String(innerValue).trim())
        }
      }
      continue
    }

    rawValues.push(...String(value).split(',').map(v => v.trim()).filter(Boolean))
  }

  return [...new Set(rawValues.filter(Boolean))]
}

function getCustomerDisplayName(customer) {
  const first = String(customer.firstName || customer.FirstName || '').trim()
  const last = String(customer.lastName || customer.LastName || '').trim()
  const company = String(customer.company || customer.Company || '').trim()
  return company || [first, last].filter(Boolean).join(' ').trim()
}

function getCustomerType(customer) {
  return String(
    customer.type ||
    customer.Type ||
    customer.customerType ||
    customer.CustomerType ||
    customer.typeName ||
    customer.TypeName ||
    ''
  ).trim()
}

function getItemSupplier(item) {
  return String(
    item.vendor ||
    item.Vendor ||
    item.defaultVendor ||
    item.DefaultVendor ||
    item.vendorName ||
    item.VendorName ||
    item.supplier ||
    item.Supplier ||
    ''
  ).trim()
}

function rowMatchesTypeFilter(customerInfo, typeMode, typeValue) {
  if (typeMode === 'none') return true

  const wanted = normalizeText(typeValue)
  if (!wanted) return true

  const valuesToCheck = [
    customerInfo.type,
    ...(customerInfo.tags || [])
  ]
    .map(v => normalizeText(v))
    .filter(Boolean)

  const matched = valuesToCheck.some(v => v.includes(wanted) || wanted.includes(v))

  if (typeMode === 'exclude') return !matched
  if (typeMode === 'include') return matched

  return true
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
    return res.status(500).json({ error: err.message })
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
      minSales = 2,
      minScore = 8,
      top = 0,
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

      // Keep everything except weird internal stuff
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

      let direction = ''
      let sourceStore = ''
      let destinationStore = ''
      let sourceQty = 0
      let destinationSales = 0

      const westNeedsStock = westSold >= Number(minSales) && southQty > 0
      const southNeedsStock = southSold >= Number(minSales) && westQty > 0

      if (!westNeedsStock && !southNeedsStock) continue

      if (westNeedsStock && southNeedsStock) {
        if (westSold > southSold) {
          direction = 'SOUTH → WEST'
          sourceStore = 'south'
          destinationStore = 'west'
          sourceQty = southQty
          destinationSales = westSold
        } else if (southSold > westSold) {
          direction = 'WEST → SOUTH'
          sourceStore = 'west'
          destinationStore = 'south'
          sourceQty = westQty
          destinationSales = southSold
        } else {
          if (southQty > westQty) {
            direction = 'SOUTH → WEST'
            sourceStore = 'south'
            destinationStore = 'west'
            sourceQty = southQty
            destinationSales = westSold
          } else {
            direction = 'WEST → SOUTH'
            sourceStore = 'west'
            destinationStore = 'south'
            sourceQty = westQty
            destinationSales = southSold
          }
        }
      } else if (westNeedsStock) {
        direction = 'SOUTH → WEST'
        sourceStore = 'south'
        destinationStore = 'west'
        sourceQty = southQty
        destinationSales = westSold
      } else if (southNeedsStock) {
        direction = 'WEST → SOUTH'
        sourceStore = 'west'
        destinationStore = 'south'
        sourceQty = westQty
        destinationSales = southSold
      }

      const suggestedTransferQty = Math.min(
        sourceQty,
        Math.max(1, Math.ceil(destinationSales * 0.5))
      )

      const opportunityScore = (destinationSales * 2) + Math.min(sourceQty, 5)

      if (suggestedTransferQty < 1) continue
      if (opportunityScore < Number(minScore)) continue

      rows.push({
        direction,
        sourceStore,
        destinationStore,
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
        destinationSales,
        sourceQty,
        suggestedTransferQty,
        opportunityScore
      })
    }

    rows.sort((a, b) => {
      if (b.opportunityScore !== a.opportunityScore) {
        return b.opportunityScore - a.opportunityScore
      }
      return b.suggestedTransferQty - a.suggestedTransferQty
    })

    rows.forEach((row, index) => {
      row.priorityRank = index + 1
    })

    const finalRows = Number(top) > 0 ? rows.slice(0, Number(top)) : rows

    if (format === 'csv') {
      const headers = [
        'Priority Rank',
        'Direction',
        'Suggested Transfer Qty',
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
        'Destination Sales',
        'Source Qty',
        'Opportunity Score'
      ]

      const csvRows = [
        headers.join(','),
        ...finalRows.map(row =>
          [
            row.priorityRank,
            row.direction,
            row.suggestedTransferQty,
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
            row.destinationSales,
            row.sourceQty,
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
        minScore: Number(minScore),
        top: Number(top),
        startDate: startIso,
        format
      },
      count: finalRows.length,
      rows: finalRows
    })
  } catch (err) {
    console.error('Transfer opportunities error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

router.get('/reports/debug-transfers/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params
    const { days = 90 } = req.query

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - Number(days))
    const startIso = startDate.toISOString()

    const itemsData = await apiRequest(
      accountId,
      'Item.json?load_relations=["ItemShops"]&limit=5'
    )

    const saleLinesData = await apiRequest(
      accountId,
      `SaleLine.json?timeStamp=>,${encodeURIComponent(startIso)}&limit=20`
    )

    const items = getItemArray(itemsData)
    const saleLines = Array.isArray(saleLinesData?.SaleLine)
      ? saleLinesData.SaleLine
      : saleLinesData?.SaleLine
        ? [saleLinesData.SaleLine]
        : []

    return res.json({
      storeMap: STORE_MAP,
      itemCount: items.length,
      saleLineCount: saleLines.length,
      sampleSaleLines: saleLines.slice(0, 5).map(line => ({
        itemID: line.itemID || line.ItemID,
        shopID: line.shopID || line.ShopID,
        unitQuantity: line.unitQuantity || line.UnitQuantity || line.quantity,
        timeStamp: line.timeStamp || line.TimeStamp
      })),
      sampleItems: items.slice(0, 3).map(item => ({
        itemID: item.itemID || item.ItemID,
        systemSku: item.systemSku || item.SystemSku,
        itemShops: getItemShops(item).map(shop => ({
          shopID: shop.shopID || shop.ShopID,
          qoh: shop.qoh || shop.QOH || shop.quantity
        }))
      }))
    })
  } catch (err) {
    console.error('Debug transfers error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// SALES SUMMARY REPORT
router.get('/reports/sales/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params

    const {
      dateFrom = '',
      dateTo = '',
      itemSearch = '',
      category = '',
      subcategory = '',
      brand = '',
      supplier = '',
      typeMode = 'exclude',
      typeValue = 'Studio Account 25%',
      blankCustomerMode = 'include',
      excludeCustomers = 'INVENTORY ADJUSTMENT',
      filtersOnly = 'false',
      format = 'json'
    } = req.query

    if (!['json', 'csv'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format. Use json or csv.' })
    }

    const items = await apiRequestAll(
  accountId,
  'Item.json?load_relations=["ItemShops"]'
)

const customers = await apiRequestAll(
  accountId,
  'Customer.json'
)

const departmentsList = await apiRequestAll(
  accountId,
  'Department.json'
)

const categoriesList = await apiRequestAll(
  accountId,
  'Category.json'
)

const manufacturersList = await apiRequestAll(
  accountId,
  'Manufacturer.json'
)

const vendorsList = await apiRequestAll(
  accountId,
  'Vendor.json'
)

const saleLines = await apiRequestAll(
  accountId,
  'SaleLine.json'
)
    

    const departmentMap = new Map()
    for (const department of departmentsList) {
      const id = String(department.departmentID || department.DepartmentID || '').trim()
      const name = String(department.name || department.Name || '').trim()
      if (id) departmentMap.set(id, name)
    }

    const categoryMap = new Map()
for (const categoryRow of categoriesList) {
  const id = String(categoryRow.categoryID || categoryRow.CategoryID || '').trim()

  if (id) {
    categoryMap.set(id, {
      name: String(categoryRow.name || categoryRow.Name || '').trim(),
      fullPathName: String(categoryRow.fullPathName || categoryRow.FullPathName || '').trim(),
      parentID: String(categoryRow.parentID || categoryRow.ParentID || '').trim(),
      nodeDepth: String(categoryRow.nodeDepth || categoryRow.NodeDepth || '').trim()
    })
  }
}

    const manufacturerMap = new Map()
    for (const manufacturer of manufacturersList) {
      const id = String(manufacturer.manufacturerID || manufacturer.ManufacturerID || '').trim()
      const name = String(manufacturer.name || manufacturer.Name || '').trim()
      if (id) manufacturerMap.set(id, name)
    }

    const vendorMap = new Map()
    for (const vendor of vendorsList) {
      const id = String(vendor.vendorID || vendor.VendorID || '').trim()
      const name = String(vendor.name || vendor.Name || '').trim()
      if (id) vendorMap.set(id, name)
    }

    const itemMap = new Map()
    const categories = new Set()
    const subcategories = new Set()
    const brands = new Set()
    const suppliers = new Set()
    const subcategoriesByCategory = {}

    for (const item of items) {
      const itemId = String(item.itemID || item.ItemID || '').trim()
      if (!itemId) continue

      const systemId = String(item.systemSku || item.SystemSku || '').trim()
      const description = String(item.description || item.Description || '').trim()
      const customSku = String(item.customSku || item.CustomSKU || '').trim()
      const upc = String(item.upc || item.UPC || '').trim()

      const categoryId = String(item.categoryID || item.CategoryID || '').trim()
const manufacturerId = String(item.manufacturerID || item.ManufacturerID || '').trim()
const vendorId = String(item.defaultVendorID || item.DefaultVendorID || '').trim()

const categoryRecord = categoryMap.get(categoryId) || null
const fullPath = String(categoryRecord?.fullPathName || categoryRecord?.name || '').trim()

const pathParts = fullPath
  .split('/')
  .map(part => part.trim())
  .filter(Boolean)

const categoryValue = pathParts[0] || ''
const subcategoryValue = pathParts[1] || ''

const brandValue = manufacturerMap.get(manufacturerId) || ''
const supplierValue = vendorMap.get(vendorId) || ''

      const { westQty, southQty, totalQty } = getStoreQuantities(item)

      if (categoryValue) categories.add(categoryValue)
if (subcategoryValue) subcategories.add(subcategoryValue)
if (brandValue) brands.add(brandValue)
if (supplierValue) suppliers.add(supplierValue)

if (categoryValue && subcategoryValue) {
  if (!subcategoriesByCategory[categoryValue]) {
    subcategoriesByCategory[categoryValue] = new Set()
  }
  subcategoriesByCategory[categoryValue].add(subcategoryValue)
}


      itemMap.set(itemId, {
        itemId,
        systemId,
        description,
        customSku,
        upc,
        brand: brandValue,
        category: categoryValue,
        subcategory: subcategoryValue,
        supplier: supplierValue,
        westStock: westQty,
        southStock: southQty,
        totalStock: totalQty
      })
    }

    const subcategoriesByCategoryJson = {}
    for (const [categoryName, subcategorySet] of Object.entries(subcategoriesByCategory)) {
      subcategoriesByCategoryJson[categoryName] = [...subcategorySet].sort((a, b) => a.localeCompare(b))
    }

    const customerMap = new Map()

    for (const customer of customers) {
      const customerId = String(customer.customerID || customer.CustomerID || '').trim()
      if (!customerId) continue

      customerMap.set(customerId, {
        name: getCustomerDisplayName(customer),
        type: getCustomerType(customer),
        tags: parseCustomerTags(customer)
      })
    }

    if (String(filtersOnly) === 'true' || !dateFrom || !dateTo) {
      return res.json({
        success: true,
        report: 'sales',
        filters: {
          accountId,
          dateFrom,
          dateTo,
          itemSearch,
          category,
          subcategory,
          brand,
          supplier,
          typeMode,
          typeValue,
          blankCustomerMode,
          excludeCustomers,
          filtersOnly,
          format
        },
        filterOptions: {
          categories: [...categories].sort((a, b) => a.localeCompare(b)),
          subcategories: [...subcategories].sort((a, b) => a.localeCompare(b)),
          brands: [...brands].sort((a, b) => a.localeCompare(b)),
          suppliers: [...suppliers].sort((a, b) => a.localeCompare(b)),
          subcategoriesByCategory: subcategoriesByCategoryJson
        },
        stats: {
          matchingProducts: 0,
          totalQtySold: 0,
          productsWithStockMatch: 0
        },
        rows: []
      })
    }

    const itemSearchNorm = normalizeText(itemSearch)
    const excludedCustomersNorm = parseCsvList(excludeCustomers).map(normalizeText)

    const fromDate = new Date(`${dateFrom}T00:00:00`)
    const toDate = new Date(`${dateTo}T23:59:59`)

    const grouped = new Map()

    for (const line of saleLines) {
      const itemId = String(line.itemID || line.ItemID || '').trim()
      if (!itemId) continue

      if (String(line.isWorkorder) === 'true') continue

      const createdAt = line.createTime || line.CreateTime || ''
      if (!createdAt) continue

      const createdDate = new Date(createdAt)
      if (Number.isNaN(createdDate.getTime())) continue

      if (createdDate < fromDate) continue
      if (createdDate > toDate) continue

      const item = itemMap.get(itemId)
      if (!item) continue

      if (category && normalizeText(item.category) !== normalizeText(category)) continue
      if (subcategory && normalizeText(item.subcategory) !== normalizeText(subcategory)) continue
      if (brand && normalizeText(item.brand) !== normalizeText(brand)) continue
      if (supplier && normalizeText(item.supplier) !== normalizeText(supplier)) continue

      if (itemSearchNorm) {
        const searchPool = [
          item.description,
          item.systemId,
          item.customSku,
          item.upc
        ].map(normalizeText).join(' ')

        if (!searchPool.includes(itemSearchNorm)) continue
      }

      const customerId = String(line.customerID || line.CustomerID || '').trim()
      const customerInfo = customerMap.get(customerId) || {
        name: '',
        type: '',
        tags: []
      }

      const customerNameNorm = normalizeText(customerInfo.name)

      if (blankCustomerMode === 'exclude' && !customerNameNorm) continue

      if (
        customerNameNorm &&
        excludedCustomersNorm.some(excluded => excluded && customerNameNorm.includes(excluded))
      ) {
        continue
      }

      if (!rowMatchesTypeFilter(customerInfo, typeMode, typeValue)) continue

      const qty = Number(line.unitQuantity || line.UnitQuantity || line.quantity || 0)
      if (!qty) continue

      if (!grouped.has(itemId)) {
        grouped.set(itemId, {
          Description: item.description,
          'System ID': item.systemId,
          'Custom SKU': item.customSku,
          UPC: item.upc,
          Category: item.category,
          Subcategory: item.subcategory,
          Brand: item.brand,
          Supplier: item.supplier,
          'All 4 Dance West Stock': item.westStock,
          'All 4 Dance South Stock': item.southStock,
          'Total Stock': item.totalStock,
          'Qty Sold': 0,
          'Order Qty': 0,
          _hasStockMatch: true
        })
      }

      const row = grouped.get(itemId)
      row['Qty Sold'] += qty
    }

    const rows = Array.from(grouped.values())
      .map(row => ({
        ...row,
        'Order Qty': calculateOrderQty(row['Qty Sold'], row['Total Stock'], row['Brand'])
      }))
      .sort((a, b) => {
        if (b['Qty Sold'] !== a['Qty Sold']) return b['Qty Sold'] - a['Qty Sold']
        return String(a.Description).localeCompare(String(b.Description))
      })

    if (format === 'csv') {
      const headers = [
        'Description',
        'System ID',
        'Custom SKU',
        'UPC',
        'Category',
        'Subcategory',
        'Brand',
        'Supplier',
        'All 4 Dance West Stock',
        'All 4 Dance South Stock',
        'Total Stock',
        'Qty Sold',
        'Order Qty'
      ]

      const csvRows = [
        headers.join(','),
        ...rows.map(row =>
          headers.map(header => escapeCsv(row[header] ?? '')).join(',')
        )
      ]

      res.setHeader('Content-Type', 'text/csv')
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="sales-report.csv"'
      )

      return res.send(csvRows.join('\n'))
    }

    return res.json({
      success: true,
      report: 'sales',
      filters: {
        accountId,
        dateFrom,
        dateTo,
        itemSearch,
        category,
        subcategory,
        brand,
        supplier,
        typeMode,
        typeValue,
        blankCustomerMode,
        excludeCustomers,
        filtersOnly,
        format
      },
      filterOptions: {
  categories: [...categories].sort((a, b) => a.localeCompare(b)),
  subcategories: [],
  brands: [...brands].sort((a, b) => a.localeCompare(b)),
  suppliers: [...suppliers].sort((a, b) => a.localeCompare(b)),
  subcategoriesByCategory: {}
},
      stats: {
        matchingProducts: rows.length,
        totalQtySold: rows.reduce((sum, row) => sum + Number(row['Qty Sold'] || 0), 0),
        productsWithStockMatch: rows.filter(row => row._hasStockMatch).length
      },
      rows
    })
  } catch (err) {
    console.error('Sales report error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// DEBUG
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

module.exports = router