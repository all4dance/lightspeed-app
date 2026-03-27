const express = require('express')
const router = express.Router()

const SALES_FILTER_CACHE = {
  fetchedAt: 0,
  ttlMs: 10 * 60 * 1000,
  data: null
}

const { apiRequest } = require('../lightspeed')

const {
  refreshItemsCache,
  getItemsCache,
  refreshSalesForDate,
  refreshSalesRange,
  getSalesCache
} = require('../cache/reportCache')

const STORE_MAP = {
  west: '1',
  south: '3'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getItemArray(itemsData) {
  if (Array.isArray(itemsData?.Item)) return itemsData.Item
  if (itemsData?.Item) return [itemsData.Item]
  return []
}

function getItemShops(item) {
  const c = item.ItemShops
  if (Array.isArray(c)) return c
  if (Array.isArray(c?.ItemShop)) return c.ItemShop
  if (c?.ItemShop) return [c.ItemShop]
  return []
}

function getStoreQuantities(item) {
  const shops = Array.isArray(item?.ItemShops?.ItemShop)
    ? item.ItemShops.ItemShop
    : item?.ItemShops?.ItemShop
      ? [item.ItemShops.ItemShop]
      : []

  let westQty = 0
  let southQty = 0

  for (const shop of shops) {
    const shopId = String(shop.shopID || shop.ShopID || '').trim()
    const qty = Number(shop.qoh || shop.QOH || 0)
    if (shopId === STORE_MAP.west) westQty = qty
    if (shopId === STORE_MAP.south) southQty = qty
  }

  return { westQty, southQty, totalQty: westQty + southQty }
}

function getSelectedQty(store, westQty, southQty) {
  if (store === 'west') return westQty
  if (store === 'south') return southQty
  return westQty + southQty
}

function escapeCsv(value) {
  const s = String(value ?? '')
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
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
  return String(value || '').split(',').map(v => v.trim()).filter(Boolean)
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

function getCategoryArray(d) {
  if (Array.isArray(d?.Category)) return d.Category
  if (d?.Category) return [d.Category]
  return []
}

function getManufacturerArray(d) {
  if (Array.isArray(d?.Manufacturer)) return d.Manufacturer
  if (d?.Manufacturer) return [d.Manufacturer]
  return []
}

function getVendorArray(d) {
  if (Array.isArray(d?.Vendor)) return d.Vendor
  if (d?.Vendor) return [d.Vendor]
  return []
}

async function apiRequestAll(accountId, endpointBase) {
  let allRows = []
  let nextEndpoint = endpointBase.includes('?')
    ? `${endpointBase}&limit=100`
    : `${endpointBase}?limit=100`

  while (nextEndpoint) {
    const data = await apiRequest(accountId, nextEndpoint)

    let rows = []
    if (Array.isArray(data?.Sale)) rows = data.Sale
    else if (data?.Sale) rows = [data.Sale]
    else if (Array.isArray(data?.Item)) rows = data.Item
    else if (data?.Item) rows = [data.Item]
    else if (Array.isArray(data?.Category)) rows = data.Category
    else if (data?.Category) rows = [data.Category]
    else if (Array.isArray(data?.Manufacturer)) rows = data.Manufacturer
    else if (data?.Manufacturer) rows = [data.Manufacturer]
    else if (Array.isArray(data?.Vendor)) rows = data.Vendor
    else if (data?.Vendor) rows = [data.Vendor]

    allRows = allRows.concat(rows)

    const nextUrl =
      data?.['@attributes']?.next ||
      data?.attributes?.next ||
      data?.next ||
      null

    if (!nextUrl) {
      nextEndpoint = null
    } else {
      try {
        const parsed = new URL(nextUrl)
        const marker = `/API/V3/Account/${accountId}/`
        const fullPath = `${parsed.pathname}${parsed.search}`
        const markerIndex = fullPath.indexOf(marker)
        if (markerIndex >= 0) {
          nextEndpoint = fullPath.substring(markerIndex + marker.length)
        } else {
          nextEndpoint = parsed.pathname.replace(/^\/+/, '') + parsed.search
        }
      } catch (err) {
        let cleaned = String(nextUrl).replace(/^https?:\/\/[^/]+\//, '')
        cleaned = cleaned.replace(/^API\/V3\/Account\/[^/]+\//, '')
        nextEndpoint = cleaned
      }
    }
    await new Promise(resolve => setTimeout(resolve, 150))
  }

  return allRows
}

async function getSalesFilterMetadata(accountId) {
  const now = Date.now()
  if (SALES_FILTER_CACHE.data && now - SALES_FILTER_CACHE.fetchedAt < SALES_FILTER_CACHE.ttlMs) {
    return SALES_FILTER_CACHE.data
  }

  const categoriesData = await apiRequest(accountId, 'Category.json')
  const manufacturersData = await apiRequest(accountId, 'Manufacturer.json')
  const vendorsData = await apiRequest(accountId, 'Vendor.json')

  const data = {
    categoriesList: getCategoryArray(categoriesData),
    manufacturersList: getManufacturerArray(manufacturersData),
    vendorsList: getVendorArray(vendorsData)
  }

  SALES_FILTER_CACHE.fetchedAt = now
  SALES_FILTER_CACHE.data = data
  return data
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
    if (String(line.isLayaway) === 'true') continue
    if (String(line.isSpecialOrder) === 'true') continue
    if (String(line.isWorkorder) === 'true') continue
    if (store === 'west' && shopId !== STORE_MAP.west) continue
    if (store === 'south' && shopId !== STORE_MAP.south) continue

    const qty = Number(line.unitQuantity || line.UnitQuantity || line.quantity || 0)
    if (!soldMap[itemId]) soldMap[itemId] = 0
    soldMap[itemId] += qty
  }

  return soldMap
}

// ─── FILTER OPTIONS ───────────────────────────────────────────────────────────

router.get('/filters/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params
    const meta = await getSalesFilterMetadata(accountId)

    const categoryMap = new Map()
    const categories = new Set()
    const subcategoriesByCategory = {}

    for (const row of meta.categoriesList) {
      const id = String(row.categoryID || row.CategoryID || '').trim()
      const name = String(row.name || row.Name || '').trim()
      const fullPathName = String(row.fullPathName || row.FullPathName || name).trim()
      if (id) categoryMap.set(id, { name, fullPathName })

      const parts = fullPathName.split('/').map(p => p.trim()).filter(Boolean)
      const main = parts[0] || ''
      const sub = parts[1] || ''
      if (main) categories.add(main)
      if (main && sub) {
        if (!subcategoriesByCategory[main]) subcategoriesByCategory[main] = new Set()
        subcategoriesByCategory[main].add(sub)
      }
    }

    const brands = new Set()
    for (const m of meta.manufacturersList) {
      const name = String(m.name || m.Name || '').trim()
      if (name) brands.add(name)
    }

    const suppliers = new Set()
    for (const v of meta.vendorsList) {
      const name = String(v.name || v.Name || '').trim()
      if (name) suppliers.add(name)
    }

    const subcategoriesByCategoryJson = {}
    for (const [main, subSet] of Object.entries(subcategoriesByCategory)) {
      subcategoriesByCategoryJson[main] = [...subSet].sort((a, b) => a.localeCompare(b))
    }

    return res.json({
      success: true,
      categories: [...categories].sort((a, b) => a.localeCompare(b)),
      subcategoriesByCategory: subcategoriesByCategoryJson,
      brands: [...brands].sort((a, b) => a.localeCompare(b)),
      suppliers: [...suppliers].sort((a, b) => a.localeCompare(b))
    })
  } catch (err) {
    console.error('Filters error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ─── MAIN SALES REPORT ────────────────────────────────────────────────────────

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
      store = 'both',
      format = 'json'
    } = req.query

    if (!['json', 'csv'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format. Use json or csv.' })
    }

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom and dateTo are required.' })
    }

    const fromDate = new Date(`${dateFrom}T00:00:00`)
    const toDate = new Date(`${dateTo}T23:59:59`)

    const meta = await getSalesFilterMetadata(accountId)

    // Build lookup maps
    const categoryMap = new Map()
    for (const row of meta.categoriesList) {
      const id = String(row.categoryID || row.CategoryID || '').trim()
      const name = String(row.name || row.Name || '').trim()
      const fullPathName = String(row.fullPathName || row.FullPathName || name).trim()
      if (id) categoryMap.set(id, { name, fullPathName })
    }

    const manufacturerMap = new Map()
    for (const m of meta.manufacturersList) {
      const id = String(m.manufacturerID || m.ManufacturerID || '').trim()
      const name = String(m.name || m.Name || '').trim()
      if (id) manufacturerMap.set(id, name)
    }

    const vendorMap = new Map()
    for (const v of meta.vendorsList) {
      const id = String(v.vendorID || v.VendorID || '').trim()
      const name = String(v.name || v.Name || '').trim()
      if (id) vendorMap.set(id, name)
    }

    // Fetch sales in date range
    const fromIso = fromDate.toISOString()
    const toIso = toDate.toISOString()

    let nextEndpoint = `Sale.json?completed=true&voided=false&archived=false&timeStamp=%3E%3C,${encodeURIComponent(fromIso)},${encodeURIComponent(toIso)}&sort=-timeStamp&load_relations=["SaleLines"]&limit=100`

    const grouped = new Map()

    while (nextEndpoint) {
      const data = await apiRequest(accountId, nextEndpoint)

      const sales = Array.isArray(data?.Sale)
        ? data.Sale
        : data?.Sale ? [data.Sale] : []

      for (const sale of sales) {
        if (String(sale.completed) !== 'true') continue
        if (String(sale.voided) === 'true') continue
        if (String(sale.archived) === 'true') continue

        const saleShopId = String(sale.shopID || sale.ShopID || '').trim()

        // Store filter
        if (store === 'west' && saleShopId !== STORE_MAP.west) continue
        if (store === 'south' && saleShopId !== STORE_MAP.south) continue

        const saleLinesContainer = sale.SaleLines
        const saleLines = Array.isArray(saleLinesContainer?.SaleLine)
          ? saleLinesContainer.SaleLine
          : saleLinesContainer?.SaleLine ? [saleLinesContainer.SaleLine] : []

        for (const line of saleLines) {
          const itemId = String(line.itemID || line.ItemID || '').trim()
          if (!itemId) continue
          if (String(line.isLayaway) === 'true') continue

          const qty = Number(line.unitQuantity || line.UnitQuantity || line.quantity || 0)
          if (!qty) continue

          if (!grouped.has(itemId)) {
            grouped.set(itemId, {
              itemId,
              westSold: 0,
              southSold: 0,
              totalSold: 0
            })
          }

          const entry = grouped.get(itemId)
          if (saleShopId === STORE_MAP.west) entry.westSold += qty
          else if (saleShopId === STORE_MAP.south) entry.southSold += qty
          entry.totalSold = entry.westSold + entry.southSold
        }
      }

      const nextUrl = data?.['@attributes']?.next || data?.attributes?.next || data?.next || null
      if (!nextUrl) {
        nextEndpoint = null
      } else {
        try {
          const parsed = new URL(nextUrl)
          const marker = `/API/V3/Account/${accountId}/`
          const fullPath = `${parsed.pathname}${parsed.search}`
          const markerIndex = fullPath.indexOf(marker)
          if (markerIndex >= 0) {
            nextEndpoint = fullPath.substring(markerIndex + marker.length)
          } else {
            nextEndpoint = parsed.pathname.replace(/^\/+/, '') + parsed.search
          }
        } catch (err) {
          let cleaned = String(nextUrl).replace(/^https?:\/\/[^/]+\//, '')
          cleaned = cleaned.replace(/^API\/V3\/Account\/[^/]+\//, '')
          nextEndpoint = cleaned
        }
      }
      if (nextEndpoint) await new Promise(resolve => setTimeout(resolve, 150))
    }

    if (grouped.size === 0) {
      return res.json({ success: true, report: 'sales', count: 0, rows: [] })
    }

    // Fetch item details for all sold items
    const itemIds = [...grouped.keys()]
    const itemDetails = new Map()

    // Fetch items in batches via cache or direct API
    const itemsCache = await getItemsCache()
    if (itemsCache.items && itemsCache.items.length > 0) {
      for (const item of itemsCache.items) {
        itemDetails.set(item.itemId, item)
      }
    } else {
      // Fallback: fetch all items
      const allItems = await apiRequestAll(accountId, 'Item.json?load_relations=["ItemShops"]')
      for (const item of allItems) {
        const itemId = String(item.itemID || item.ItemID || '').trim()
        if (!itemId) continue
        const categoryId = String(item.categoryID || item.CategoryID || '').trim()
        const manufacturerId = String(item.manufacturerID || item.ManufacturerID || '').trim()
        const vendorId = String(item.defaultVendorID || item.DefaultVendorID || '').trim()
        const catRecord = categoryMap.get(categoryId)
        const fullPath = String(catRecord?.fullPathName || catRecord?.name || '').trim()
        const pathParts = fullPath.split('/').map(p => p.trim()).filter(Boolean)
        const { westQty, southQty, totalQty } = getStoreQuantities(item)
        itemDetails.set(itemId, {
          itemId,
          systemId: String(item.systemSku || item.SystemSku || '').trim(),
          description: String(item.description || item.Description || '').trim(),
          customSku: String(item.customSku || item.CustomSKU || '').trim(),
          upc: String(item.upc || item.UPC || '').trim(),
          category: pathParts[0] || '',
          subcategory: pathParts[1] || '',
          brand: manufacturerMap.get(manufacturerId) || '',
          supplier: vendorMap.get(vendorId) || '',
          westStock: westQty,
          southStock: southQty,
          totalStock: totalQty
        })
      }
    }

    // Build rows with filters applied
    const searchNorm = normalizeText(itemSearch)
    const categoryNorm = normalizeText(category)
    const subcategoryNorm = normalizeText(subcategory)
    const brandNorm = normalizeText(brand)
    const supplierNorm = normalizeText(supplier)

    const rows = []

    for (const [itemId, sales] of grouped.entries()) {
      const item = itemDetails.get(itemId)
      if (!item) continue

      // Apply filters
      if (searchNorm) {
        const haystack = normalizeText(`${item.description} ${item.customSku} ${item.upc} ${item.systemId}`)
        if (!haystack.includes(searchNorm)) continue
      }
      if (categoryNorm && normalizeText(item.category) !== categoryNorm) continue
      if (subcategoryNorm && normalizeText(item.subcategory) !== subcategoryNorm) continue
      if (brandNorm && normalizeText(item.brand) !== brandNorm) continue
      if (supplierNorm && normalizeText(item.supplier) !== supplierNorm) continue

      const orderQty = calculateOrderQty(sales.totalSold, item.totalStock, item.brand)

      rows.push({
        itemId: item.itemId,
        systemId: item.systemId,
        description: item.description,
        customSku: item.customSku,
        upc: item.upc,
        category: item.category,
        subcategory: item.subcategory,
        brand: item.brand,
        supplier: item.supplier,
        westStock: item.westStock,
        southStock: item.southStock,
        totalStock: item.totalStock,
        westSold: sales.westSold,
        southSold: sales.southSold,
        totalSold: sales.totalSold,
        orderQty
      })
    }

    rows.sort((a, b) => {
      if (b.totalSold !== a.totalSold) return b.totalSold - a.totalSold
      return String(a.description).localeCompare(String(b.description))
    })

    if (format === 'csv') {
      const headers = [
        'Description', 'System ID', 'Custom SKU', 'UPC',
        'Category', 'Subcategory', 'Brand', 'Supplier',
        'West Stock', 'South Stock', 'Total Stock',
        'West Sold', 'South Sold', 'Total Sold', 'Order Qty'
      ]
      const csvRows = [
        headers.join(','),
        ...rows.map(row =>
          [
            row.description, row.systemId, row.customSku, row.upc,
            row.category, row.subcategory, row.brand, row.supplier,
            row.westStock, row.southStock, row.totalStock,
            row.westSold, row.southSold, row.totalSold, row.orderQty
          ].map(escapeCsv).join(',')
        )
      ]
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="sales-report-${dateFrom}-to-${dateTo}.csv"`)
      return res.send(csvRows.join('\n'))
    }

    return res.json({
      success: true,
      report: 'sales',
      dateFrom,
      dateTo,
      store,
      count: rows.length,
      totalSold: rows.reduce((s, r) => s + r.totalSold, 0),
      totalOrderQty: rows.reduce((s, r) => s + r.orderQty, 0),
      rows
    })
  } catch (err) {
    console.error('Sales report error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ─── PURCHASE RECOMMENDATIONS (Last-year 30-day window) ───────────────────────

router.get('/reports/purchase-recommendations/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params
    const {
      refDateFrom = '',
      refDateTo = '',
      category = '',
      subcategory = '',
      brand = '',
      supplier = '',
      store = 'both',
      onlyNeeded = 'false',
      format = 'json'
    } = req.query

    if (!['json', 'csv'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format.' })
    }

    // Default: same 30-day window last year
    let fromDate, toDate
    if (refDateFrom && refDateTo) {
      fromDate = new Date(`${refDateFrom}T00:00:00`)
      toDate = new Date(`${refDateTo}T23:59:59`)
    } else {
      // Default: last year same period (today-365 to today-335)
      const now = new Date()
      toDate = new Date(now)
      toDate.setFullYear(toDate.getFullYear() - 1)
      fromDate = new Date(toDate)
      fromDate.setDate(fromDate.getDate() - 30)
    }

    const fromIso = fromDate.toISOString()
    const toIso = toDate.toISOString()

    const meta = await getSalesFilterMetadata(accountId)

    const categoryMap = new Map()
    for (const row of meta.categoriesList) {
      const id = String(row.categoryID || row.CategoryID || '').trim()
      const name = String(row.name || row.Name || '').trim()
      const fullPathName = String(row.fullPathName || row.FullPathName || name).trim()
      if (id) categoryMap.set(id, { name, fullPathName })
    }
    const manufacturerMap = new Map()
    for (const m of meta.manufacturersList) {
      const id = String(m.manufacturerID || m.ManufacturerID || '').trim()
      const name = String(m.name || m.Name || '').trim()
      if (id) manufacturerMap.set(id, name)
    }
    const vendorMap = new Map()
    for (const v of meta.vendorsList) {
      const id = String(v.vendorID || v.VendorID || '').trim()
      const name = String(v.name || v.Name || '').trim()
      if (id) vendorMap.set(id, name)
    }

    // Fetch last-year sales
    let nextEndpoint = `Sale.json?completed=true&voided=false&archived=false&timeStamp=%3E%3C,${encodeURIComponent(fromIso)},${encodeURIComponent(toIso)}&sort=-timeStamp&load_relations=["SaleLines"]&limit=100`

    const lastYearSales = new Map()

    while (nextEndpoint) {
      const data = await apiRequest(accountId, nextEndpoint)
      const sales = Array.isArray(data?.Sale) ? data.Sale : data?.Sale ? [data.Sale] : []

      for (const sale of sales) {
        if (String(sale.completed) !== 'true') continue
        if (String(sale.voided) === 'true') continue
        if (String(sale.archived) === 'true') continue

        const saleShopId = String(sale.shopID || sale.ShopID || '').trim()
        if (store === 'west' && saleShopId !== STORE_MAP.west) continue
        if (store === 'south' && saleShopId !== STORE_MAP.south) continue

        const saleLinesContainer = sale.SaleLines
        const saleLines = Array.isArray(saleLinesContainer?.SaleLine)
          ? saleLinesContainer.SaleLine
          : saleLinesContainer?.SaleLine ? [saleLinesContainer.SaleLine] : []

        for (const line of saleLines) {
          const itemId = String(line.itemID || line.ItemID || '').trim()
          if (!itemId) continue
          if (String(line.isLayaway) === 'true') continue
          const qty = Number(line.unitQuantity || line.UnitQuantity || line.quantity || 0)
          if (!qty) continue

          if (!lastYearSales.has(itemId)) {
            lastYearSales.set(itemId, { westSold: 0, southSold: 0, totalSold: 0 })
          }
          const entry = lastYearSales.get(itemId)
          if (saleShopId === STORE_MAP.west) entry.westSold += qty
          else if (saleShopId === STORE_MAP.south) entry.southSold += qty
          entry.totalSold = entry.westSold + entry.southSold
        }
      }

      const nextUrl = data?.['@attributes']?.next || data?.attributes?.next || data?.next || null
      if (!nextUrl) {
        nextEndpoint = null
      } else {
        try {
          const parsed = new URL(nextUrl)
          const marker = `/API/V3/Account/${accountId}/`
          const fullPath = `${parsed.pathname}${parsed.search}`
          const markerIndex = fullPath.indexOf(marker)
          if (markerIndex >= 0) {
            nextEndpoint = fullPath.substring(markerIndex + marker.length)
          } else {
            nextEndpoint = parsed.pathname.replace(/^\/+/, '') + parsed.search
          }
        } catch (err) {
          let cleaned = String(nextUrl).replace(/^https?:\/\/[^/]+\//, '')
          cleaned = cleaned.replace(/^API\/V3\/Account\/[^/]+\//, '')
          nextEndpoint = cleaned
        }
      }
      if (nextEndpoint) await new Promise(resolve => setTimeout(resolve, 150))
    }

    // Get current inventory from cache
    const itemsCache = await getItemsCache()
    const itemDetails = new Map()
    for (const item of (itemsCache.items || [])) {
      itemDetails.set(item.itemId, item)
    }

    // Build recommendation rows
    const categoryNorm = normalizeText(category)
    const subcategoryNorm = normalizeText(subcategory)
    const brandNorm = normalizeText(brand)
    const supplierNorm = normalizeText(supplier)
    const showOnlyNeeded = String(onlyNeeded) === 'true'

    const rows = []

    for (const [itemId, sales] of lastYearSales.entries()) {
      const item = itemDetails.get(itemId)
      if (!item) continue

      if (categoryNorm && normalizeText(item.category) !== categoryNorm) continue
      if (subcategoryNorm && normalizeText(item.subcategory) !== subcategoryNorm) continue
      if (brandNorm && normalizeText(item.brand) !== brandNorm) continue
      if (supplierNorm && normalizeText(item.supplier) !== supplierNorm) continue

      const currentStock = store === 'west' ? item.westStock
        : store === 'south' ? item.southStock
          : item.totalStock

      const lastYearQty = store === 'west' ? sales.westSold
        : store === 'south' ? sales.southSold
          : sales.totalSold

      const orderQty = calculateOrderQty(lastYearQty, currentStock, item.brand)

      if (showOnlyNeeded && orderQty === 0) continue

      rows.push({
        itemId: item.itemId,
        systemId: item.systemId,
        description: item.description,
        customSku: item.customSku,
        upc: item.upc,
        category: item.category,
        subcategory: item.subcategory,
        brand: item.brand,
        supplier: item.supplier,
        westStock: item.westStock,
        southStock: item.southStock,
        totalStock: item.totalStock,
        lastYearWestSold: sales.westSold,
        lastYearSouthSold: sales.southSold,
        lastYearTotalSold: sales.totalSold,
        orderQty,
        refDateFrom: fromDate.toISOString().slice(0, 10),
        refDateTo: toDate.toISOString().slice(0, 10)
      })
    }

    rows.sort((a, b) => {
      if (b.orderQty !== a.orderQty) return b.orderQty - a.orderQty
      return b.lastYearTotalSold - a.lastYearTotalSold
    })

    if (format === 'csv') {
      const headers = [
        'Description', 'System ID', 'Custom SKU', 'UPC',
        'Category', 'Subcategory', 'Brand', 'Supplier',
        'West Stock', 'South Stock', 'Total Stock',
        'Last Year West Sold', 'Last Year South Sold', 'Last Year Total Sold',
        'Order Qty', 'Ref Date From', 'Ref Date To'
      ]
      const csvRows = [
        headers.join(','),
        ...rows.map(row =>
          [
            row.description, row.systemId, row.customSku, row.upc,
            row.category, row.subcategory, row.brand, row.supplier,
            row.westStock, row.southStock, row.totalStock,
            row.lastYearWestSold, row.lastYearSouthSold, row.lastYearTotalSold,
            row.orderQty, row.refDateFrom, row.refDateTo
          ].map(escapeCsv).join(',')
        )
      ]
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', 'attachment; filename="purchase-recommendations.csv"')
      return res.send(csvRows.join('\n'))
    }

    return res.json({
      success: true,
      report: 'purchase-recommendations',
      refDateFrom: fromDate.toISOString().slice(0, 10),
      refDateTo: toDate.toISOString().slice(0, 10),
      store,
      count: rows.length,
      totalOrderQty: rows.reduce((s, r) => s + r.orderQty, 0),
      rows
    })
  } catch (err) {
    console.error('Purchase recommendations error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ─── INVENTORY SNAPSHOT ───────────────────────────────────────────────────────

router.get('/reports/inventory/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params
    const {
      itemSearch = '',
      category = '',
      subcategory = '',
      brand = '',
      supplier = '',
      store = 'both',
      format = 'json'
    } = req.query

    const itemsCache = await getItemsCache()
    let items = itemsCache.items || []

    const searchNorm = normalizeText(itemSearch)
    const categoryNorm = normalizeText(category)
    const subcategoryNorm = normalizeText(subcategory)
    const brandNorm = normalizeText(brand)
    const supplierNorm = normalizeText(supplier)

    if (searchNorm || categoryNorm || subcategoryNorm || brandNorm || supplierNorm) {
      items = items.filter(item => {
        if (searchNorm) {
          const haystack = normalizeText(`${item.description} ${item.customSku} ${item.upc} ${item.systemId}`)
          if (!haystack.includes(searchNorm)) return false
        }
        if (categoryNorm && normalizeText(item.category) !== categoryNorm) return false
        if (subcategoryNorm && normalizeText(item.subcategory) !== subcategoryNorm) return false
        if (brandNorm && normalizeText(item.brand) !== brandNorm) return false
        if (supplierNorm && normalizeText(item.supplier) !== supplierNorm) return false
        return true
      })
    }

    const rows = items.map(item => ({
      itemId: item.itemId,
      systemId: item.systemId,
      description: item.description,
      customSku: item.customSku,
      upc: item.upc,
      category: item.category,
      subcategory: item.subcategory,
      brand: item.brand,
      supplier: item.supplier,
      westStock: item.westStock,
      southStock: item.southStock,
      totalStock: item.totalStock
    }))

    rows.sort((a, b) => String(a.description).localeCompare(String(b.description)))

    if (format === 'csv') {
      const headers = [
        'Description', 'System ID', 'Custom SKU', 'UPC',
        'Category', 'Subcategory', 'Brand', 'Supplier',
        'West Stock', 'South Stock', 'Total Stock'
      ]
      const csvRows = [
        headers.join(','),
        ...rows.map(row =>
          [
            row.description, row.systemId, row.customSku, row.upc,
            row.category, row.subcategory, row.brand, row.supplier,
            row.westStock, row.southStock, row.totalStock
          ].map(escapeCsv).join(',')
        )
      ]
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', 'attachment; filename="inventory-snapshot.csv"')
      return res.send(csvRows.join('\n'))
    }

    return res.json({
      success: true,
      report: 'inventory',
      updatedAt: itemsCache.updatedAt,
      count: rows.length,
      rows
    })
  } catch (err) {
    console.error('Inventory report error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ─── CACHE MANAGEMENT ─────────────────────────────────────────────────────────

router.get('/cache/status', async (req, res) => {
  try {
    const items = await getItemsCache()
    const sales = await getSalesCache()
    return res.json({
      success: true,
      itemsUpdatedAt: items.updatedAt,
      itemCount: items.items.length,
      salesUpdatedAt: sales.updatedAt,
      salesDays: Object.keys(sales.days || {}).length
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

router.get('/cache/refresh-items/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params
    const result = await refreshItemsCache(accountId)
    return res.json({ success: true, updatedAt: result.updatedAt, itemCount: result.items.length })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

router.get('/cache/refresh-sales/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params
    const { date = '', days = '7' } = req.query

    if (date) {
      const result = await refreshSalesForDate(accountId, date)
      let westNetQty = 0, southNetQty = 0, totalNetQty = 0
      for (const t of Object.values(result.grouped)) {
        westNetQty += Number(t.westNetQty || 0)
        southNetQty += Number(t.southNetQty || 0)
        totalNetQty += Number(t.totalNetQty || 0)
      }
      return res.json({ success: true, date, rows: Object.keys(result.grouped).length, westNetQty, southNetQty, totalNetQty, pageCount: result.pageCount })
    }

    const rangeResult = await refreshSalesRange(accountId, Number(days || 7))
    return res.json({ success: true, results: rangeResult })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

router.get('/cache/view-sales', async (req, res) => {
  try {
    const sales = await getSalesCache()
    return res.json(sales)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// ─── LEGACY / MISC ROUTES ─────────────────────────────────────────────────────

router.get('/items/:accountId', async (req, res) => {
  const { accountId } = req.params
  try {
    const data = await apiRequest(accountId, 'Item.json')
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/sales/:accountId', async (req, res) => {
  const { accountId } = req.params
  try {
    const data = await apiRequest(accountId, 'Sale.json')
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
