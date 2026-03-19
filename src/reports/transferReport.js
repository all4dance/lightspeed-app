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

function storeKey(store) {
  const text = String(store || '').trim().toLowerCase();

  if (text.includes('west')) return 'West';
  if (text.includes('south')) return 'South';

  return '';
}

function pickItemKey(row) {
  if (row.systemId) return `system:${row.systemId}`;
  if (row.itemId) return `item:${row.itemId}`;
  if (row.customSku) return `customSku:${row.customSku}`;
  if (row.manufacturerSku) return `manufacturerSku:${row.manufacturerSku}`;
  return `desc:${row.description || 'unknown'}`;
}

function createStoreStats() {
  return {
    qty: 0,
    sold30: 0,
    sold60: 0,
    sold90: 0,
    sold365: 0,
    lastSaleDate: null,
  };
}

function createItem(row = {}) {
  return {
    key: pickItemKey(row),
    itemId: row.itemId || '',
    systemId: row.systemId || '',
    customSku: row.customSku || '',
    manufacturerSku: row.manufacturerSku || '',
    description: row.description || '',
    category: row.category || '',
    brand: row.brand || '',
    cost: Number(row.cost) || 0,
    price: Number(row.price) || 0,
    West: createStoreStats(),
    South: createStoreStats(),
  };
}

function ensureItemFields(item, row) {
  item.itemId = item.itemId || row.itemId || '';
  item.systemId = item.systemId || row.systemId || '';
  item.customSku = item.customSku || row.customSku || '';
  item.manufacturerSku = item.manufacturerSku || row.manufacturerSku || '';
  item.description = item.description || row.description || '';
  item.category = item.category || row.category || '';
  item.brand = item.brand || row.brand || '';

  if (!item.cost && row.cost) item.cost = Number(row.cost) || 0;
  if (!item.price && row.price) item.price = Number(row.price) || 0;
}

function applyInventory(item, row) {
  ensureItemFields(item, row);

  const store = storeKey(row.store);
  if (!store || !item[store]) return;

  item[store].qty += Number(row.inventoryQty) || 0;
}

function applySale(item, row, asOfDate) {
  ensureItemFields(item, row);

  const store = storeKey(row.store);
  if (!store || !item[store]) return;

  const qtySold = Number(row.qtySold) || 0;
  const saleDate = toDate(row.date);
  if (!saleDate) return;

  const daysAgo = daysBetween(saleDate, asOfDate);

  if (daysAgo <= 30) item[store].sold30 += qtySold;
  if (daysAgo <= 60) item[store].sold60 += qtySold;
  if (daysAgo <= 90) item[store].sold90 += qtySold;
  if (daysAgo <= 365) item[store].sold365 += qtySold;

  if (!item[store].lastSaleDate || saleDate > item[store].lastSaleDate) {
    item[store].lastSaleDate = saleDate;
  }
}

function calculateTargetSplit(item, options) {
  const westDemand = item.West.sold60;
  const southDemand = item.South.sold60;
  const totalQty = item.West.qty + item.South.qty;

  if (totalQty <= 0) {
    return { westTarget: 0, southTarget: 0, mode: 'none' };
  }

  if (westDemand === 0 && southDemand === 0) {
    const half = Math.floor(totalQty / 2);
    return {
      westTarget: totalQty - half,
      southTarget: half,
      mode: 'equal',
    };
  }

  const totalDemand = westDemand + southDemand;
  const westRaw = totalDemand > 0 ? (westDemand / totalDemand) * totalQty : totalQty / 2;
  const southRaw = totalDemand > 0 ? (southDemand / totalDemand) * totalQty : totalQty / 2;

  let westTarget = Math.round(westRaw);
  let southTarget = Math.round(southRaw);

  if (westTarget + southTarget !== totalQty) {
    const diff = totalQty - (westTarget + southTarget);
    if (westDemand >= southDemand) {
      westTarget += diff;
    } else {
      southTarget += diff;
    }
  }

  westTarget = Math.max(options.minQtyPerStore, westTarget);
  southTarget = Math.max(options.minQtyPerStore, southTarget);

  const adjustedTotal = westTarget + southTarget;
  if (adjustedTotal > totalQty) {
    const over = adjustedTotal - totalQty;
    if (westTarget >= southTarget && westTarget > options.minQtyPerStore) {
      westTarget -= over;
    } else {
      southTarget -= over;
    }
  }

  return {
    westTarget,
    southTarget,
    mode: 'weighted',
  };
}

function buildReason(fromStore, toStore, item) {
  const from = item[fromStore];
  const to = item[toStore];

  if (to.qty <= 0 && to.sold30 > 0) {
    return `${toStore} is out of stock and still selling`;
  }

  if (to.qty <= 1 && to.sold30 > from.sold30) {
    return `${toStore} is low and selling faster`;
  }

  if (to.sold60 > from.sold60) {
    return `${toStore} is selling faster over 60 days`;
  }

  if (to.sold30 > 0 && from.sold30 === 0) {
    return `${toStore} has active sales while ${fromStore} does not`;
  }

  return `rebalance stock between stores`;
}

function determinePriority(fromStore, toStore, item) {
  const from = item[fromStore];
  const to = item[toStore];

  if (to.qty <= 0 && to.sold30 > 0) return 'High';
  if (to.qty <= 1 && to.sold30 >= 2) return 'High';
  if (to.sold60 > from.sold60 * 2 && from.qty >= 3) return 'High';
  if (to.sold30 > 0) return 'Medium';

  return 'Low';
}

function maybeCreateSuggestion(item, options) {
  const { westTarget, southTarget } = calculateTargetSplit(item, options);

  const westExcess = item.West.qty - westTarget;
  const southExcess = item.South.qty - southTarget;

  let fromStore = '';
  let toStore = '';
  let qtyToTransfer = 0;

  if (westExcess > 0 && southExcess < 0) {
    fromStore = 'West';
    toStore = 'South';
    qtyToTransfer = Math.min(
      westExcess,
      Math.abs(southExcess),
      Math.max(0, item.West.qty - options.minQtyToKeepAtSource)
    );
  }

  if (southExcess > 0 && westExcess < 0) {
    fromStore = 'South';
    toStore = 'West';
    qtyToTransfer = Math.min(
      southExcess,
      Math.abs(westExcess),
      Math.max(0, item.South.qty - options.minQtyToKeepAtSource)
    );
  }

  qtyToTransfer = Math.floor(qtyToTransfer);

  if (qtyToTransfer < options.minTransferQty) {
    return null;
  }

  const reason = buildReason(fromStore, toStore, item);
  const priority = determinePriority(fromStore, toStore, item);

  return {
    priority,
    fromStore,
    toStore,
    qtyToTransfer,
    itemId: item.itemId,
    systemId: item.systemId,
    customSku: item.customSku,
    manufacturerSku: item.manufacturerSku,
    description: item.description,
    category: item.category,
    brand: item.brand,
    westQty: item.West.qty,
    southQty: item.South.qty,
    westSold30: item.West.sold30,
    southSold30: item.South.sold30,
    westSold60: item.West.sold60,
    southSold60: item.South.sold60,
    westSold90: item.West.sold90,
    southSold90: item.South.sold90,
    westLastSaleDate: item.West.lastSaleDate ? item.West.lastSaleDate.toISOString() : '',
    southLastSaleDate: item.South.lastSaleDate ? item.South.lastSaleDate.toISOString() : '',
    estimatedValueAtCost: qtyToTransfer * (Number(item.cost) || 0),
    estimatedValueAtRetail: qtyToTransfer * (Number(item.price) || 0),
    reason,
  };
}

function sortSuggestions(items) {
  const priorityRank = { High: 3, Medium: 2, Low: 1 };

  return items.sort((a, b) => {
    const aRank = priorityRank[a.priority] || 0;
    const bRank = priorityRank[b.priority] || 0;

    if (bRank !== aRank) return bRank - aRank;
    if (b.estimatedValueAtCost !== a.estimatedValueAtCost) {
      return b.estimatedValueAtCost - a.estimatedValueAtCost;
    }

    return a.description.localeCompare(b.description);
  });
}

function summarizeSuggestions(suggestions) {
  const summary = {
    totalSuggestions: suggestions.length,
    totalUnitsToTransfer: 0,
    totalEstimatedValueAtCost: 0,
    highPriorityCount: 0,
    mediumPriorityCount: 0,
    lowPriorityCount: 0,
    westToSouthCount: 0,
    southToWestCount: 0,
  };

  for (const row of suggestions) {
    summary.totalUnitsToTransfer += row.qtyToTransfer;
    summary.totalEstimatedValueAtCost += row.estimatedValueAtCost;

    if (row.priority === 'High') summary.highPriorityCount += 1;
    if (row.priority === 'Medium') summary.mediumPriorityCount += 1;
    if (row.priority === 'Low') summary.lowPriorityCount += 1;

    if (row.fromStore === 'West' && row.toStore === 'South') {
      summary.westToSouthCount += 1;
    }

    if (row.fromStore === 'South' && row.toStore === 'West') {
      summary.southToWestCount += 1;
    }
  }

  return summary;
}

function buildTransferReport({
  sales = [],
  inventory = [],
  asOfDate = new Date(),
  options = {},
}) {
  const config = {
    minQtyPerStore: 1,
    minQtyToKeepAtSource: 1,
    minTransferQty: 1,
    ...options,
  };

  const map = new Map();

  for (const row of inventory) {
    const key = pickItemKey(row);
    const item = map.get(key) || createItem(row);
    applyInventory(item, row);
    map.set(key, item);
  }

  for (const row of sales) {
    const key = pickItemKey(row);
    const item = map.get(key) || createItem(row);
    applySale(item, row, asOfDate);
    map.set(key, item);
  }

  const suggestions = [];

  for (const item of map.values()) {
    const suggestion = maybeCreateSuggestion(item, config);
    if (suggestion) suggestions.push(suggestion);
  }

  sortSuggestions(suggestions);

  return {
    asOfDate: asOfDate.toISOString(),
    options: config,
    summary: summarizeSuggestions(suggestions),
    suggestions,
  };
}

module.exports = {
  buildTransferReport,
};