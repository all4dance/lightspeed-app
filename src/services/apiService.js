const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function fetchJson(url) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

async function getSalesFromApi(baseUrl = BASE_URL) {
  return fetchJson(`${baseUrl}/api/sales-with-items`);
}

async function getItemsFromApi(accountId, baseUrl = BASE_URL) {
  if (!accountId) {
    throw new Error('accountId is required for getItemsFromApi');
  }

  return fetchJson(`${baseUrl}/api/items/${accountId}`);
}

module.exports = {
  fetchJson,
  getSalesFromApi,
  getItemsFromApi,
};
