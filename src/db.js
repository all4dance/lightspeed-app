const Database = require('better-sqlite3')

const db = new Database('app.db')

db.exec(`
CREATE TABLE IF NOT EXISTS lightspeed_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_name TEXT,
  account_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at INTEGER,
  scope TEXT,
  created_at INTEGER,
  updated_at INTEGER
)
`)

module.exports = db