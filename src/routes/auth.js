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
  const uri = encodeURIComponent(process.env.HOST + '/auth/callback');
  const url = 'https://' + shop + '/admin/oauth/authorize?client_id=' + process.env.SHOPIFY_API_KEY + '&scope=read_products,write_products&redirect_uri=' + uri + '&state=' + state;
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
    const r = await pool.query(
      "INSERT INTO shops(shop_domain,access_token,credits,plan) VALUES($1,$2,100,'free') ON CONFLICT(shop_domain) DO UPDATE SET access_token=$2 RETURNING *",
      [shop, t.data.access_token]
    );
    req.session.shopId = r.rows[0].id;
    res.redirect('/app');
  } catch(e) {
    res.status(500).send('Error OAuth: ' + e.message);
  }
});

router.get('/logout', function(req, res) {
  req.session.destroy();
  res.json({ ok: true });
});

module.exports = router;
