const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const pool = require('../db');
const router = express.Router();

router.get('/auth', function(req, res) {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Falta shop');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.state = state;
  const cb = encodeURIComponent(process.env.HOST + '/auth/callback');
  const url = 'https://' + shop + '/admin/oauth/authorize'
    + '?client_id=' + process.env.SHOPIFY_API_KEY
    + '&scope=read_products,write_products'
    + '&redirect_uri=' + cb
    + '&state=' + state;
  res.redirect(url);
});

router.get('/auth/callback', async function(req, res) {
  const shop = req.query.shop;
  const code = req.query.code;
  const state = req.query.state;
  if (state !== req.session.state) return res.status(403).send('Estado invalido');
  try {
    const t = await axios.post('https://' + shop + '/admin/oauth/access_token', {
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code: code
    });
    const token = t.data.access_token;
    const existing = await pool.query('SELECT id FROM shops WHERE shop_domain=$1', [shop]);
    let shopId;
    if (existing.rows.length > 0) {
      await pool.query('UPDATE shops SET access_token=$1 WHERE shop_domain=$2', [token, shop]);
      shopId = existing.rows[0].id;
    } else {
      const ins = await pool.query(
        "INSERT INTO shops(shop_domain,access_token,credits,plan) VALUES($1,$2,100,'free') RETURNING id",
        [shop, token]
      );
      shopId = ins.rows[0].id;
    }
    req.session.shopId = shopId;
    req.session.shop = shop;
    res.redirect('/app-login?shop=' + encodeURIComponent(shop));
  } catch(e) {
    res.status(500).send('Error OAuth: ' + e.message);
  }
});

router.get('/app-login', async function(req, res) {
  // Intentar extraer shop del parametro 'host' de Shopify (base64url)
  let shop = req.query.shop;
  if (!shop && req.query.host) {
    try {
      const decoded = Buffer.from(req.query.host, 'base64').toString('utf8');
      const m = decoded.match(/([a-z0-9-]+\.myshopify\.com)/);
      if (m) shop = m[1];
    } catch(e) {}
  }
  // Sin shop: redirigir a /app (tiene selector de tienda)
  if (!shop) return res.redirect('/app');
  try {
    const s = await pool.query('SELECT id FROM shops WHERE shop_domain=$1', [shop]);
    if (!s.rows.length) return res.redirect('/auth?shop=' + encodeURIComponent(shop));
    req.session.shopId = s.rows[0].id;
    req.session.shop = shop;
    res.redirect('/app?shop=' + encodeURIComponent(shop) + '&loggedIn=1');
  } catch(e) {
    res.redirect('/app?shop=' + encodeURIComponent(shop));
  }
});

router.get('/logout', function(req, res) {
  req.session.destroy();
  res.json({ ok: true });
});

module.exports = router;