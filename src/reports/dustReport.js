function toDate(value) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function daysBetween(olderDate, newerDate) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((newerDate.getTime() - olderDate.getTime()) / msPerDay);
}

function bucketDays(daysSinceLastSale) {
  if (daysSinceLastSale === null) return 'No sales history';
  if (daysSinceLastSale >= 180) return '180+ days';
  if (daysSinceLastSale >= 90) return '90-179 days';
  if (daysSinceLastSale >= 60) return '60-89 days';
  if (daysSinceLastSale >= 30) return '30-59 days';
  return '<30 days';
}

function pickKey(row) {
  if (row.systemId) return `system:${row.systemId}`;
  if (row.itemId) return `item:${row.itemId}`;
  if (row.customSku) return `customSku:${row.customSku}`;
  if (row.manufacturerSku) return `manufacturerSku:${row.manufacturerSku}`;
  return `desc:${row.description || 'unknown'}`;
}

function createEmptyItem(row = {}) {
  return {
    key: pickKey(row),
    itemId: row.itemId || '',
    systemId: row.systemId || '',
    customSku: row.customSku || '',
    manufacturerSku: row.manufacturerSku || '',
    description: row.description || '',
    category: row.category || '',
    brand: row.brand || '',
    inventoryQty: 0,
    cost: Number(row.cost) || 0,
    price: Number(row.price) || 0,
    totalQtySold: 0,
    saleCount: 0,
    firstSaleDate: null,
    lastSaleDate: null,
    storesSold: new Set(),
  };
}

function mergeInventory(item, row) {
  item.itemId = item.itemId || row.itemId || '';
  item.systemId = item.systemId || row.systemId || '';
  item.customSku = item.customSku || row.customSku || '';
  item.manufacturerSku = item.manufacturerSku || row.manufacturerSku || '';
  item.description = item.description || row.description || '';
  item.category = item.category || row.category || '';
  item.brand = item.brand || row.brand || '';

  item.inventoryQty += Number(row.inventoryQty) || 0;

  if (!item.cost && row.cost) item.cost = Number(row.cost) || 0;
  if (!item.price && row.price) item.price = Number(row.price) || 0;
}

function mergeSale(item, row) {
  item.itemId = item.itemId || row.itemId || '';
  item.systemId = item.systemId || row.systemId || '';
  item.customSku = item.customSku || row.customSku || '';
  item.manufacturerSku = item.manufacturerSku || row.manufacturerSku || '';
  item.description = item.description || row.description || '';
  item.category = item.category || row.category || '';
  item.brand = item.brand || row.brand || '';

  if (!item.cost && row.cost) item.cost = Number(row.cost) || 0;
  if (!item.price && row.price) item.price = Number(row.price) || 0;

  const qtySold = Number(row.qtySold) || 0;
  item.totalQtySold += qtySold;
  item.saleCount += 1;

  if (row.store) {
    item.storesSold.add(row.store);
  }

  const saleDate = toDate(row.date);
  if (saleDate) {
    if (!item.firstSaleDate || saleDate < item.firstSaleDate) {
      item.firstSaleDate = saleDate;
    }

    if (!item.lastSaleDate || saleDate > item.lastSaleDate) {
      item.lastSaleDate = saleDate;
    }
  }
}

function finalizeItem(item, asOfDate) {
  const daysSinceLastSale = item.lastSaleDate
    ? daysBetween(item.lastSaleDate, asOfDate)
    : null;

  const inventoryValueAtCost = (Number(item.inventoryQty) || 0) * (Number(item.cost) || 0);
  const inventoryValueAtRetail = (Number(item.inventoryQty) || 0) * (Number(item.price) || 0);

  return {
    key: item.key,
    itemId: item.itemId,
    systemId: item.systemId,
    customSku: item.customSku,
    manufacturerSku: item.manufacturerSku,
    description: item.description,
    category: item.category,
    brand: item.brand,
    inventoryQty: item.inventoryQty,
    cost: item.cost,
    price: item.price,
    inventoryValueAtCost,
    inventoryValueAtRetail,
    totalQtySold: item.totalQtySold,
    saleCount: item.saleCount,
    firstSaleDate: item.firstSaleDate ? item.firstSaleDate.toISOString() : '',
    lastSaleDate: item.lastSaleDate ? item.lastSaleDate.toISOString() : '',
    daysSinceLastSale,
    inactivityBucket: bucketDays(daysSinceLastSale),
    storesSold: Array.from(item.storesSold),
    noSalesHistory: item.lastSaleDate === null,
    isDust30: item.inventoryQty > 0 && (daysSinceLastSale === null || daysSinceLastSale >= 30),
    isDust60: item.inventoryQty > 0 && (daysSinceLastSale === null || daysSinceLastSale >= 60),
    isDust90: item.inventoryQty > 0 && (daysSinceLastSale === null || daysSinceLastSale >= 90),
    isDust180: item.inventoryQty > 0 && (daysSinceLastSale === null || daysSinceLastSale >= 180),
  };
}

function summarizeDust(items) {
  const summary = {
    totalItems: items.length,
    inventoryUnits: 0,
    inventoryValueAtCost: 0,
    inventoryValueAtRetail: 0,

    dust30Count: 0,
    dust60Count: 0,
    dust90Count: 0,
    dust180Count: 0,

    dust30ValueAtCost: 0,
    dust60ValueAtCost: 0,
    dust90ValueAtCost: 0,
    dust180ValueAtCost: 0,
  };

  for (const item of items) {
    summary.inventoryUnits += item.inventoryQty;
    summary.inventoryValueAtCost += item.inventoryValueAtCost;
    summary.inventoryValueAtRetail += item.inventoryValueAtRetail;

    if (item.isDust30) {
      summary.dust30Count += 1;
      summary.dust30ValueAtCost += item.inventoryValueAtCost;
    }

    if (item.isDust60) {
      summary.dust60Count += 1;
      summary.dust60ValueAtCost += item.inventoryValueAtCost;
    }

    if (item.isDust90) {
      summary.dust90Count += 1;
      summary.dust90ValueAtCost += item.inventoryValueAtCost;
    }

    if (item.isDust180) {
      summary.dust180Count += 1;
      summary.dust180ValueAtCost += item.inventoryValueAtCost;
    }
  }

  return summary;
}

function buildDustReport({ sales = [], inventory = [], asOfDate = new Date() }) {
  const map = new Map();

  for (const row of inventory) {
    const key = pickKey(row);
    const existing = map.get(key) || createEmptyItem(row);
    mergeInventory(existing, row);
    map.set(key, existing);
  }

  for (const row of sales) {
    const key = pickKey(row);
    const existing = map.get(key) || createEmptyItem(row);
    mergeSale(existing, row);
    map.set(key, existing);
  }

  const items = Array.from(map.values())
    .map((item) => finalizeItem(item, asOfDate))
    .sort((a, b) => b.inventoryValueAtCost - a.inventoryValueAtCost);

  const summary = summarizeDust(items);

  return {
    asOfDate: asOfDate.toISOString(),
    summary,
    items,
  };
}

function filterDustItems(report, minDays = 90) {
  return report.items.filter((item) => {
    if (item.inventoryQty <= 0) return false;
    if (item.daysSinceLastSale === null) return true;
    return item.daysSinceLastSale >= minDays;
  });
}

function topDustByValue(report, minDays = 90, limit = 25) {
  return filterDustItems(report, minDays)
    .sort((a, b) => b.inventoryValueAtCost - a.inventoryValueAtCost)
    .slice(0, limit);
}

module.exports = {
  buildDustReport,
  filterDustItems,
  topDustByValue,
};