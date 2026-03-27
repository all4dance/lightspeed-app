const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { apiRequest } = require('../lightspeed')

const STORE_MAP = {
  west: '1',
  south: '3'
}

const CACHE_DIR = path.join(process.cwd(), 'cache')
const ITEMS_CACHE_FILE = path.join(CACHE_DIR, 'items-cache.json')
const SALES_CACHE_FILE = path.join(CACHE_DIR, 'daily-sales-cache.json')

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
  }
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    return fallback
  }
}

async function writeJson(filePath, data) {
  ensureDir()
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8')
}

async function apiRequestAll(accountId, endpointBase, rootKey) {
  let allRows = []
  let nextEndpoint = endpointBase.includes('?')
    ? `${endpointBase}&limit=100`
    : `${endpointBase}?limit=100`

  while (nextEndpoint) {
    const response = await apiRequest(accountId, nextEndpoint)

    let rows = []
    if (Array.isArray(response?.[rootKey])) rows = response[rootKey]
    else if (response?.[rootKey]) rows = [response[rootKey]]

    allRows = allRows.concat(rows)

    const nextUrl =
      response?.['@attributes']?.next ||
      response?.attributes?.next ||
      response?.next ||
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

    if (nextEndpoint) {
      await new Promise(resolve => setTimeout(resolve, 150))
    }
  }

  return allRows
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

  return {
    westQty,
    southQty,
    totalQty: westQty + southQty
  }
}

function normalizeItemRecord(item, categoryMap, manufacturerMap, vendorMap) {
  const itemId = String(item.itemID || item.ItemID || '').trim()
  if (!itemId) return null

  const categoryId = String(item.categoryID || item.CategoryID || '').trim()
  const manufacturerId = String(item.manufacturerID || item.ManufacturerID || '').trim()
  const vendorId = String(item.defaultVendorID || item.DefaultVendorID || '').trim()

  const categoryRecord = categoryMap.get(categoryId) || null
  const fullPath = String(categoryRecord?.fullPathName || categoryRecord?.name || '').trim()
  const pathParts = fullPath
    .split('/')
    .map(part => part.trim())
    .filter(Boolean)

  const category = pathParts[0] || ''
  const subcategory = pathParts[1] || ''

  const { westQty, southQty, totalQty } = getStoreQuantities(item)

  return {
    itemId,
    systemId: String(item.systemSku || item.SystemSku || '').trim(),
    description: String(item.description || item.Description || '').trim(),
    customSku: String(item.customSku || item.CustomSKU || '').trim(),
    upc: String(item.upc || item.UPC || '').trim(),
    category,
    subcategory,
    brand: manufacturerMap.get(manufacturerId) || '',
    supplier: vendorMap.get(vendorId) || '',
    westStock: westQty,
    southStock: southQty,
    totalStock: totalQty
  }
}

async function refreshItemsCache(accountId) {
  const categories = await apiRequestAll(accountId, 'Category.json', 'Category')
  const manufacturers = await apiRequestAll(accountId, 'Manufacturer.json', 'Manufacturer')
  const vendors = await apiRequestAll(accountId, 'Vendor.json', 'Vendor')
  const items = await apiRequestAll(accountId, 'Item.json?load_relations=["ItemShops"]', 'Item')

  const categoryMap = new Map()
  for (const row of categories) {
    const id = String(row.categoryID || row.CategoryID || '').trim()
    if (!id) continue
    categoryMap.set(id, {
      name: String(row.name || row.Name || '').trim(),
      fullPathName: String(row.fullPathName || row.FullPathName || row.name || row.Name || '').trim()
    })
  }

  const manufacturerMap = new Map()
  for (const row of manufacturers) {
    const id = String(row.manufacturerID || row.ManufacturerID || '').trim()
    if (!id) continue
    manufacturerMap.set(id, String(row.name || row.Name || '').trim())
  }

  const vendorMap = new Map()
  for (const row of vendors) {
    const id = String(row.vendorID || row.VendorID || '').trim()
    if (!id) continue
    vendorMap.set(id, String(row.name || row.Name || '').trim())
  }

  const normalizedItems = items
    .map(item => normalizeItemRecord(item, categoryMap, manufacturerMap, vendorMap))
    .filter(Boolean)

  const payload = {
    updatedAt: new Date().toISOString(),
    accountId,
    items: normalizedItems
  }

  await writeJson(ITEMS_CACHE_FILE, payload)
  return payload
}

async function getItemsCache() {
  return readJson(ITEMS_CACHE_FILE, {
    updatedAt: null,
    accountId: null,
    items: []
  })
}

async function refreshSalesForDate(accountId, dateStr) {
  const fromDate = new Date(`${dateStr}T00:00:00.000Z`)
const toDate = new Date(`${dateStr}T00:00:00.000Z`)
toDate.setUTCDate(toDate.getUTCDate() + 1)

  let nextEndpoint =
    `Sale.json?completed=true&voided=false&archived=false&timeStamp=%3E%3C,${encodeURIComponent(fromDate.toISOString())},${encodeURIComponent(toDate.toISOString())}&sort=-timeStamp&load_relations=["SaleLines"]&limit=100`

  const grouped = {}
let pageCount = 0

while (nextEndpoint) {
    pageCount += 1

    const response = await apiRequest(accountId, nextEndpoint)

    const sales = Array.isArray(response?.Sale)
      ? response.Sale
      : response?.Sale
        ? [response.Sale]
        : []

    for (const sale of sales) {
      const completeTime = sale.completeTime || sale.CompleteTime || ''
      if (!completeTime) continue

      const completedDate = new Date(completeTime)
      if (Number.isNaN(completedDate.getTime())) continue

      if (completedDate < fromDate) continue
      if (completedDate >= toDate) continue
      if (String(sale.completed) !== 'true') continue
      if (String(sale.voided) === 'true') continue
      if (String(sale.archived) === 'true') continue

      const saleShopId = String(sale.shopID || sale.ShopID || '').trim()

      const saleLinesContainer = sale.SaleLines
      const saleLines = Array.isArray(saleLinesContainer?.SaleLine)
        ? saleLinesContainer.SaleLine
        : saleLinesContainer?.SaleLine
          ? [saleLinesContainer.SaleLine]
          : []

      for (const line of saleLines) {
        const itemId = String(line.itemID || line.ItemID || '').trim()
        if (!itemId) continue

        // Only skip layaways (optional)
if (String(line.isLayaway) === 'true') continue

        const qty = Number(line.unitQuantity || line.UnitQuantity || line.quantity || 0)
        if (!qty) continue

        if (!grouped[itemId]) {
          grouped[itemId] = {
            westNetQty: 0,
            southNetQty: 0,
            totalNetQty: 0
          }
        }

        if (saleShopId === STORE_MAP.west) {
          grouped[itemId].westNetQty += qty
        } else if (saleShopId === STORE_MAP.south) {
          grouped[itemId].southNetQty += qty
        }

        grouped[itemId].totalNetQty =
          grouped[itemId].westNetQty + grouped[itemId].southNetQty
      }
    }

    const nextUrl =
      response?.['@attributes']?.next ||
      response?.attributes?.next ||
      response?.next ||
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

    if (nextEndpoint) {
      await new Promise(resolve => setTimeout(resolve, 150))
    }
  }

  const salesCache = await readJson(SALES_CACHE_FILE, {
    updatedAt: null,
    accountId,
    days: {}
  })

  salesCache.updatedAt = new Date().toISOString()
  salesCache.accountId = accountId
  salesCache.days[dateStr] = grouped

  await writeJson(SALES_CACHE_FILE, salesCache)

  let netQty = 0
  for (const itemTotals of Object.values(grouped)) {
    netQty += Number(itemTotals.totalNetQty || 0)
  }

  return {
    grouped,
    pageCount,
    netQty
  }
}

async function refreshSalesRange(accountId, daysBack = 1) {
  const today = new Date()
  const results = []

  for (let i = 0; i < daysBack; i += 1) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)

    const result = await refreshSalesForDate(accountId, dateStr)

    let westNetQty = 0
    let southNetQty = 0
    let totalNetQty = 0

    for (const itemTotals of Object.values(result.grouped)) {
      westNetQty += Number(itemTotals.westNetQty || 0)
      southNetQty += Number(itemTotals.southNetQty || 0)
      totalNetQty += Number(itemTotals.totalNetQty || 0)
    }

    results.push({
      date: dateStr,
      rows: Object.keys(result.grouped).length,
      westNetQty,
      southNetQty,
      totalNetQty,
      pageCount: result.pageCount
    })
  }

  return results
}

async function getSalesCache() {
  return readJson(SALES_CACHE_FILE, {
    updatedAt: null,
    accountId: null,
    days: {}
  })
}

module.exports = {
  refreshItemsCache,
  getItemsCache,
  refreshSalesForDate,
  refreshSalesRange,
  getSalesCache
}