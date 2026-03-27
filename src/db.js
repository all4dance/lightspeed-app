const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const dbPath = process.env.DB_PATH || '/data/app.db'
const dbDir = path.dirname(dbPath)

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

const db = new Database(dbPath)

db.exec(`
CREATE TABLE IF NOT EXISTS lightspeed_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_name TEXT,
  account_id TEXT UNIQUE,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at INTEGER,
  scope TEXT,
  created_at INTEGER,
  updated_at INTEGER
)
`)

module.exports = db
