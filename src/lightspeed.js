const axios = require('axios')
const db = require('./db')

const API_BASE = 'https://api.lightspeedapp.com/API/V3'
const OAUTH_BASE = 'https://cloud.lightspeedapp.com/auth/oauth'

const {
  LIGHTSPEED_CLIENT_ID,
  LIGHTSPEED_CLIENT_SECRET,
  LIGHTSPEED_REDIRECT_URI
} = process.env

function upsertConnection(data) {
  const now = Date.now()

  const existing = db
    .prepare('SELECT * FROM lightspeed_connections WHERE account_id = ?')
    .get(data.account_id)

  if (existing) {
    db.prepare(`
      UPDATE lightspeed_connections
      SET store_name = ?,
          access_token = ?,
          refresh_token = ?,
          token_expires_at = ?,
          scope = ?,
          updated_at = ?
      WHERE account_id = ?
    `).run(
      data.store_name || '',
      data.access_token,
      data.refresh_token,
      data.token_expires_at,
      data.scope || '',
      now,
      data.account_id
    )
  } else {
    db.prepare(`
      INSERT INTO lightspeed_connections
      (store_name, account_id, access_token, refresh_token, token_expires_at, scope, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.store_name || '',
      data.account_id,
      data.access_token,
      data.refresh_token,
      data.token_expires_at,
      data.scope || '',
      now,
      now
    )
  }
}

function getConnection(accountId) {
  return db
    .prepare('SELECT * FROM lightspeed_connections WHERE account_id = ?')
    .get(accountId)
}

async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    client_id: LIGHTSPEED_CLIENT_ID,
    client_secret: LIGHTSPEED_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: LIGHTSPEED_REDIRECT_URI
  })

  const res = await axios.post(`${OAUTH_BASE}/token`, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })

  return res.data
}

async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    client_id: LIGHTSPEED_CLIENT_ID,
    client_secret: LIGHTSPEED_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  })

  const res = await axios.post(`${OAUTH_BASE}/token`, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })

  return res.data
}

async function getAccountFromToken(accessToken) {
  const res = await axios.get(`${API_BASE}/Account.json`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  })

  return res.data
}
async function ensureValidAccessToken(accountId) {
  const conn = getConnection(accountId)

  if (!conn) {
    throw new Error('No Lightspeed connection found')
  }

  const now = Date.now()
  const bufferMs = 2 * 60 * 1000

  if (conn.access_token && conn.token_expires_at && now < conn.token_expires_at - bufferMs) {
    return conn.access_token
  }

  const tokenData = await refreshAccessToken(conn.refresh_token)
  const tokenExpiresAt = Date.now() + (tokenData.expires_in * 1000)

  db.prepare(`
    UPDATE lightspeed_connections
    SET access_token = ?,
        refresh_token = ?,
        token_expires_at = ?,
        updated_at = ?
    WHERE account_id = ?
  `).run(
    tokenData.access_token,
    tokenData.refresh_token || conn.refresh_token,
    tokenExpiresAt,
    Date.now(),
    accountId
  )

  return tokenData.access_token
}

async function apiRequest(accountId, path) {
  const accessToken = await ensureValidAccessToken(accountId)

  const res = await axios.get(
    `${API_BASE}/Account/${accountId}/${path}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    }
  )

  return res.data
}

module.exports = {
  exchangeCodeForToken,
  getAccountFromToken,
  upsertConnection,
  apiRequest
}