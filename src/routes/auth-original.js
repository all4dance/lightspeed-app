const express = require('express')
const crypto = require('crypto')
const {
  exchangeCodeForToken,
  getAccountFromToken,
  upsertConnection
} = require('../lightspeed')

const router = express.Router()

const {
  LIGHTSPEED_CLIENT_ID,
  LIGHTSPEED_REDIRECT_URI
} = process.env

router.get('/connect', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex')

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
    `&state=${encodeURIComponent(state)}` +
    `&redirect_uri=${encodeURIComponent(LIGHTSPEED_REDIRECT_URI)}`

  res.redirect(url)
})

router.get('/callback', async (req, res) => {
  try {
    const { code } = req.query

    if (!code) {
      return res.status(400).send('Missing OAuth code')
    }

    const tokenData = await exchangeCodeForToken(code)
    const accountData = await getAccountFromToken(tokenData.access_token)

    const account = Array.isArray(accountData.Account)
      ? accountData.Account[0]
      : accountData.Account

    const tokenExpiresAt = Date.now() + (tokenData.expires_in * 1000)

    upsertConnection({
      account_id: String(account.accountID),
      store_name: account.name || '',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: tokenExpiresAt,
      scope: tokenData.scope || ''
    })

    res.json({
      success: true,
      accountID: account.accountID,
      accountName: account.name || null
    })
  } catch (err) {
    res.status(500).json({
      error: err.response?.data || err.message
    })
  }
})

module.exports = router