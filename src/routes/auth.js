const express = require('express')
const crypto = require('crypto')
const router = express.Router()
const {
  exchangeCodeForToken,
  getAccountFromToken,
  upsertConnection
} = require('../lightspeed')

const { LIGHTSPEED_CLIENT_ID, LIGHTSPEED_REDIRECT_URI } = process.env

function base64UrlEncode(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

router.get('/connect', (req, res) => {
  const scope = [
    'employee:inventory_read',
    'employee:register_read',
    'employee:customers_read'
  ].join(' ')

  const url =
    `https://cloud.lightspeedapp.com/auth/oauth/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(LIGHTSPEED_CLIENT_ID)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&redirect_uri=${encodeURIComponent(LIGHTSPEED_REDIRECT_URI)}`

  res.redirect(url)
})

router.get('/callback', async (req, res) => {
  try {
    const { code, error, error_description } = req.query

    if (error) {
      return res.status(400).send(`
        <html><body style="font-family:sans-serif;padding:2rem;">
          <h2>OAuth Error</h2>
          <p><strong>${error}</strong>: ${error_description || 'Unknown error'}</p>
          <a href="/">Back to Dashboard</a>
        </body></html>
      `)
    }

    if (!code) {
      return res.status(400).send(`
        <html><body style="font-family:sans-serif;padding:2rem;">
          <h2>Missing Code</h2>
          <p>No authorization code was received from Lightspeed.</p>
          <a href="/">Back to Dashboard</a>
        </body></html>
      `)
    }

    const tokenData = await exchangeCodeForToken(code)
    const tokenExpiresAt = Date.now() + (tokenData.expires_in * 1000)

    const accountData = await getAccountFromToken(tokenData.access_token)
    const account = accountData.Account || accountData.account || accountData

    upsertConnection({
      store_name: account?.name || '',
      account_id: account?.accountID || account?.accountId || account?.id,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: tokenExpiresAt,
      scope: tokenData.scope || ''
    })

    return res.send(`
      <html><body style="font-family:sans-serif;padding:2rem;background:#f0fdf4;">
        <h2 style="color:#16a34a;">✓ Connected Successfully!</h2>
        <p>Account: <strong>${account?.name || 'All 4 Dance'}</strong></p>
        <p>Account ID: <strong>${account?.accountID || account?.accountId || account?.id}</strong></p>
        <p>Token expires in: <strong>${Math.round(tokenData.expires_in / 60)} minutes</strong></p>
        <br>
        <a href="/" style="background:#16a34a;color:white;padding:0.75rem 1.5rem;border-radius:6px;text-decoration:none;">Go to Dashboard →</a>
      </body></html>
    `)
  } catch (err) {
    return res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:2rem;background:#fef2f2;">
        <h2 style="color:#dc2626;">Connection Error</h2>
        <p>${err.message}</p>
        <pre style="background:#fee2e2;padding:1rem;border-radius:6px;">${JSON.stringify(err.response?.data || {}, null, 2)}</pre>
        <a href="/">Back to Dashboard</a>
      </body></html>
    `)
  }
})

router.get('/status', (req, res) => {
  const db = require('../db')
  const conn = db.prepare('SELECT account_id, store_name, token_expires_at, updated_at FROM lightspeed_connections LIMIT 1').get()
  if (!conn) {
    return res.json({ connected: false })
  }
  return res.json({
    connected: true,
    accountId: conn.account_id,
    storeName: conn.store_name,
    tokenExpiresAt: new Date(conn.token_expires_at).toISOString(),
    updatedAt: new Date(conn.updated_at).toISOString()
  })
})

module.exports = router
