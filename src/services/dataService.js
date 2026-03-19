const { loadCsvFile } = require('./csvService');
const {
  normalizeCsvSaleRow,
  normalizeCsvInventoryRow,
  normalizeApiSaleRow,
} = require('./normalizers');
const { getSalesFromApi } = require('./apiService');

const salesCsvMap = {
  date: 'Date',
  store: 'Shop',
  saleId: 'ID',
  itemId: 'Item ID',
  systemId: 'System ID',
  customSku: 'Custom SKU',
  manufacturerSku: 'Manufact. SKU',
  description: 'Description',
  category: 'Category',
  brand: 'Brand',
  qtySold: 'Qty.',
  inventoryQty: 'Inventory Qty',
  cost: 'Default Cost',
  price: 'Total',
};

const inventoryCsvMap = {
  itemId: 'Item ID',
  systemId: 'System ID',
  customSku: 'Custom SKU',
  manufacturerSku: 'Manufact. SKU',
  description: 'Item',
  category: 'Category',
  brand: 'Brand',
  inventoryQty: 'Qty.',
  cost: 'Default Cost',
  price: 'Default Price',
};

async function getSalesData(options = {}) {
  const { source = 'csv', salesCsvPath, apiBaseUrl } = options;

  if (source === 'csv') {
    if (!salesCsvPath) {
      throw new Error('salesCsvPath is required when source="csv"');
    }

    const rows = loadCsvFile(salesCsvPath);
    return rows.map((row) => normalizeCsvSaleRow(row, salesCsvMap));
  }

  if (source === 'api') {
    const result = await getSalesFromApi(apiBaseUrl);

    const rows = Array.isArray(result) ? result : result.rows || [];
    return rows.map(normalizeApiSaleRow);
  }

  throw new Error(`Unsupported sales source: ${source}`);
}

async function getInventoryData(options = {}) {
  const { source = 'csv', inventoryCsvPath } = options;

  if (source === 'csv') {
    if (!inventoryCsvPath) {
      throw new Error('inventoryCsvPath is required when source="csv"');
    }

    const rows = loadCsvFile(inventoryCsvPath);
    return rows.map((row) => normalizeCsvInventoryRow(row, inventoryCsvMap));
  }

  if (source === 'api') {
    return [];
  }

  throw new Error(`Unsupported inventory source: ${source}`);
}

module.exports = {
  salesCsvMap,
  inventoryCsvMap,
  getSalesData,
  getInventoryData,
};