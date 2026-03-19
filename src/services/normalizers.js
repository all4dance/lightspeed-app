function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const cleaned = String(value).replace(/[$,]/g, '').trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : fallback;
}

function toText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function normalizeStore(value) {
  const text = toText(value).toLowerCase();

  if (text.includes('south')) return 'South';
  if (text.includes('west')) return 'West';

  return toText(value);
}

function normalizeCsvSaleRow(row, map = {}) {
  return {
    source: 'csv',
    date: toText(row[map.date]),
    store: normalizeStore(row[map.store]),
    saleId: toText(row[map.saleId]),
    itemId: toText(row[map.itemId]),
    systemId: toText(row[map.systemId]),
    customSku: toText(row[map.customSku]),
    manufacturerSku: toText(row[map.manufacturerSku]),
    description: toText(row[map.description]),
    category: toText(row[map.category]),
    brand: toText(row[map.brand]),
    qtySold: toNumber(row[map.qtySold]),
    inventoryQty: toNumber(row[map.inventoryQty]),
    cost: toNumber(row[map.cost]),
    price: toNumber(row[map.price]),
  };
}

function normalizeCsvInventoryRow(row, map = {}) {
  return {
    source: 'csv',
    date: '',
    store: '',
    saleId: '',
    itemId: toText(row[map.itemId]),
    systemId: toText(row[map.systemId]),
    customSku: toText(row[map.customSku]),
    manufacturerSku: toText(row[map.manufacturerSku]),
    description: toText(row[map.description]),
    category: toText(row[map.category]),
    brand: toText(row[map.brand]),
    qtySold: 0,
    inventoryQty: toNumber(row[map.inventoryQty]),
    cost: toNumber(row[map.cost]),
    price: toNumber(row[map.price]),
  };
}

function normalizeApiSaleRow(row) {
  return {
    source: 'api',
    date: toText(row.saleTime || row.date),
    store: normalizeStore(row.store || row.shop || row.shopName),
    saleId: toText(row.saleID || row.saleId),
    itemId: toText(row.itemID || row.itemId),
    systemId: toText(row.systemID || row.systemId),
    customSku: toText(row.customSku),
    manufacturerSku: toText(row.manufacturerSku),
    description: toText(row.description),
    category: toText(row.category),
    brand: toText(row.brand),
    qtySold: toNumber(row.qtySold || row.unitQuantity),
    inventoryQty: toNumber(row.inventoryQty),
    cost: toNumber(row.cost),
    price: toNumber(row.price || row.calcTotal),
  };
}

module.exports = {
  toNumber,
  toText,
  normalizeStore,
  normalizeCsvSaleRow,
  normalizeCsvInventoryRow,
  normalizeApiSaleRow,
};