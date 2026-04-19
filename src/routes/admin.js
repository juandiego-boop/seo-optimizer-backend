const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const router = express.Router();

const ADMIN_KEY = 'seo_admin_2024_simbolo';

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.admin_key;
  if (key !== ADMIN_KEY && key !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

// Listar tiendas
router.get('/admin/shops', adminAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT id,shop_domain,plan,credits,is_unlimited,created_at FROM shops ORDER BY created_at DESC');
    res.json({ shops: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Agregar creditos
router.post('/admin/add-credits', adminAuth, async (req, res) => {
  const shop = req.body.shop || req.body.shopDomain;
  const credits = parseInt(req.body.credits || req.body.amount || 0);
  if (!shop || !credits) return res.status(400).json({ error: 'Falta shop o credits' });
  try {
    const s = await pool.query(
      'UPDATE shops SET credits=credits+$1 WHERE shop_domain=$2 RETURNING shop_domain,credits',
      [credits, shop]
    );
    if (!s.rows.length) return res.status(404).json({ error: 'Tienda no encontrada' });
    res.json({ ok: true, shop: s.rows[0].shop_domain, credits: s.rows[0].credits });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Establecer creditos exactos
router.post('/admin/set-credits', adminAuth, async (req, res) => {
  const shop = req.body.shop;
  const credits = parseInt(req.body.credits);
  if (!shop || isNaN(credits)) return res.status(400).json({ error: 'Falta shop o credits' });
  try {
    const s = await pool.query(
      'UPDATE shops SET credits=$1 WHERE shop_domain=$2 RETURNING shop_domain,credits',
      [credits, shop]
    );
    if (!s.rows.length) return res.status(404).json({ error: 'Tienda no encontrada' });
    res.json({ ok: true, shop: s.rows[0].shop_domain, credits: s.rows[0].credits });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Ilimitados
router.post('/admin/set-unlimited', adminAuth, async (req, res) => {
  const shop = req.body.shop;
  const unlimited = req.body.unlimited !== false;
  if (!shop) return res.status(400).json({ error: 'Falta shop' });
  try {
    const s = await pool.query(
      'UPDATE shops SET is_unlimited=$1 WHERE shop_domain=$2 RETURNING shop_domain,is_unlimited',
      [unlimited, shop]
    );
    if (!s.rows.length) return res.status(404).json({ error: 'Tienda no encontrada' });
    res.json({ ok: true, shop: s.rows[0].shop_domain, is_unlimited: s.rows[0].is_unlimited });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Generar API key enterprise
router.post('/admin/generate-key', adminAuth, async (req, res) => {
  const shop = req.body.shop || req.body.shopDomain;
  const label = req.body.label || 'Enterprise';
  try {
    const s = await pool.query('SELECT id FROM shops WHERE shop_domain=$1', [shop]);
    if (!s.rows.length) return res.status(404).json({ error: 'Tienda no encontrada' });
    const raw = 'seo_' + crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    await pool.query('INSERT INTO licenses(shop_id,api_key_hash,label)VALUES($1,$2,$3)', [s.rows[0].id, hash, label]);
    await pool.query("UPDATE shops SET is_unlimited=true,plan='enterprise' WHERE id=$1", [s.rows[0].id]);
    res.json({ api_key: raw, message: 'Guarda esta clave, no se mostrara de nuevo.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;