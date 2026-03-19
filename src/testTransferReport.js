const { getSalesData, getInventoryData } = require('./services/dataService');
const { buildTransferReport } = require('./reports/transferReport');
const { formatTransferEmail } = require('./services/emailFormatter');

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

    const report = buildTransferReport({
      sales,
      inventory,
      asOfDate: new Date(),
      options: {
        minQtyPerStore: 1,
        minQtyToKeepAtSource: 1,
        minTransferQty: 1,
      },
    });

    console.log('TRANSFER SUMMARY');
    console.log(report.summary);

    console.log('\nSUGGESTIONS');
    console.table(
      report.suggestions.map((item) => ({
        priority: item.priority,
        from: item.fromStore,
        to: item.toStore,
        qty: item.qtyToTransfer,
        description: item.description,
        westQty: item.westQty,
        southQty: item.southQty,
        westSold30: item.westSold30,
        southSold30: item.southSold30,
        reason: item.reason,
      }))
    );

    console.log('\nEMAIL PREVIEW\n');
    console.log(formatTransferEmail(report));
  } catch (err) {
    console.error(err);
  }
}

run();