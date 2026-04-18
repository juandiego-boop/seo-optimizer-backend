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
  // Shopify pasa el shop directamente o via el parametro 'host' en base64
  let shop = req.query.shop;

  // Si no hay shop directo, intentar decodificar el parametro 'host' de Shopify
  // El host de Shopify es base64url de "TIENDA.myshopify.com/admin"
  if (!shop && req.query.host) {
    try {
      const decoded = Buffer.from(req.query.host, 'base64').toString('utf8');
      const match = decoded.match(/([a-z0-9-]+\.myshopify\.com)/);
      if (match) shop = match[1];
    } catch(e) {}
  }

  // Si aun no hay shop, mostrar pagina HTML con selector de tienda
  if (!shop) {
    return res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SEO Optimizer Pro</title>' +
      '<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f4f6f8}' +
      '.box{background:white;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center;max-width:400px;width:90%}' +
      'h2{color:#008060;margin-bottom:1rem}input{width:100%;padding:.75rem;border:1.5px solid #d1d5db;border-radius:6px;font-size:.9rem;margin-bottom:1rem;box-sizing:border-box}' +
      'button{width:100%;padding:.75rem;background:#008060;color:white;border:none;border-radius:6px;font-size:.9rem;cursor:pointer}' +
      'button:hover{background:#006e52}</style></head><body>' +
      '<div class="box"><h2>SEO Optimizer Pro</h2><p style="color:#666;margin-bottom:1.5rem">Ingresa el dominio de tu tienda</p>' +
      '<input id="s" type="text" placeholder="mitienda.myshopify.com">' +
      '<button onclick="var s=document.getElementById('s').value.trim();' +
      'if(!s)return;if(!s.includes('.myshopify.com'))s+='.myshopify.com';' +
      'window.location.href='/app-login?shop='+encodeURIComponent(s)">Conectar</button></div>' +
      '</body></html>');
  }

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