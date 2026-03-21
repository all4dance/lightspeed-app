const express = require('express')
const crypto = require('crypto')
const router = express.Router()
const {
  exchangeCodeForToken,
  getAccountFromToken,
  upsertConnection
} = require('../lightspeed')

const { LIGHTSPEED_CLIENT_ID, LIGHTSPEED_REDIRECT_URI } = process.env

const pkceStore = new Map()

function base64UrlEncode(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function generateCodeVerifier() {
  return base64UrlEncode(crypto.randomBytes(64))
}

function generateCodeChallenge(codeVerifier) {
  return base64UrlEncode(
    crypto.createHash('sha256').update(codeVerifier).digest()
  )
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
    `&scope=${encodeURIComponent(scope)}`

  res.redirect(url)
})

router.get('/callback', async (req, res) => {
  try {
    const { code, error, error_description } = req.query

    if (error) {
      return res.status(400).json({
        error,
        error_description
      })
    }

    if (!code) {
      return res.status(400).json({
        error: 'Missing code'
      })
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

    return res.json({
      success: true,
      accountID: account?.accountID || account?.accountId || account?.id,
      accountName: account?.name || ''
    })
  } catch (err) {
    return res.status(500).json({
      error: err.message,
      details: err.response?.data || null
    })
  }
})

module.exports = router