const { getSalesData, getInventoryData } = require('./services/dataService');

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

    console.log('Sales rows:', sales.length);
    console.log('Inventory rows:', inventory.length);
    console.log('First sale row:', sales[0]);
    console.log('First inventory row:', inventory[0]);
  } catch (err) {
    console.error(err);
  }
}

run();