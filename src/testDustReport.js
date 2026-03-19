const { getSalesData, getInventoryData } = require('./services/dataService');
const { buildDustReport, topDustByValue } = require('./reports/dustReport');

async function run() {
  try {
    const sales = await getSalesData({
      source: 'csv',
      salesCsvPath: './data/sales.csv',
    });

    const inventory = await getInventoryData({
      source: 'csv',
      inventoryCsvPath: './data/inventory.csv',
    });

    const report = buildDustReport({
      sales,
      inventory,
      asOfDate: new Date(),
    });

    console.log('SUMMARY');
    console.log(report.summary);

    console.log('\nTOP 20 DUST ITEMS (90+ days)');
    console.table(
      topDustByValue(report, 90, 20).map((item) => ({
        description: item.description,
        systemId: item.systemId,
        customSku: item.customSku,
        inventoryQty: item.inventoryQty,
        cost: item.cost,
        inventoryValueAtCost: item.inventoryValueAtCost,
        lastSaleDate: item.lastSaleDate,
        daysSinceLastSale: item.daysSinceLastSale,
        bucket: item.inactivityBucket,
      }))
    );
  } catch (err) {
    console.error(err);
  }
}

run();