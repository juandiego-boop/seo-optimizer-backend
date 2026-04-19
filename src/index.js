require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const pool = require('./db');
const authRoutes = require('./routes/auth');
const { router: productRoutes } = require('./routes/products');
const optimizeRoutes = require('./routes/optimize');
const adminRoutes = require('./routes/admin');
const paymentsRoutes = require('./routes/payments');

const app = express();
const PORT = process.env.PORT || 3000;

app.use('/payments/webhook', express.raw({ type: 'application/json' }));
app.use(cors({ origin: true, credentials: true }));

// Permitir que Shopify cargue la app en iframe
app.use(function(req, res, next) {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors https://*.myshopify.com https://admin.shopify.com");
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'seo-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 604800000 }
}));

app.use('/', authRoutes);
app.use('/api', productRoutes);
app.use('/api', optimizeRoutes);
app.use('/', adminRoutes);
app.use('/', paymentsRoutes);

// Servir el panel de administracion
app.get('/admin-panel', function(req, res) {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// ===== RUTAS DE ADMIN =====
const ADMIN_SECRET = 'seo_admin_2024_simbolo';

function checkAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.admin_key;
  if (key !== ADMIN_SECRET) return res.status(401).json({ error: 'No autorizado' });
  next();
}

// Listar todas las tiendas
app.get('/admin/shops', checkAdmin, async function(req, res) {
  try {
    const s = await pool.query('SELECT id, shop_domain, plan, credits, is_unlimited, created_at FROM shops ORDER BY created_at DESC');
    res.json({ shops: s.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Agregar creditos a una tienda
app.post('/admin/add-credits', checkAdmin, async function(req, res) {
  const { shop, credits } = req.body;
  if (!shop || !credits) return res.status(400).json({ error: 'Falta shop o credits' });
  try {
    const s = await pool.query(
      'UPDATE shops SET credits = credits + $1 WHERE shop_domain = $2 RETURNING id, shop_domain, credits',
      [parseInt(credits), shop]
    );
    if (!s.rows.length) return res.status(404).json({ error: 'Tienda no encontrada' });
    res.json({ ok: true, shop: s.rows[0].shop_domain, credits: s.rows[0].credits });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Poner creditos ilimitados a una tienda
app.post('/admin/set-unlimited', checkAdmin, async function(req, res) {
  const { shop, unlimited } = req.body;
  if (!shop) return res.status(400).json({ error: 'Falta shop' });
  try {
    const s = await pool.query(
      'UPDATE shops SET is_unlimited = $1 WHERE shop_domain = $2 RETURNING id, shop_domain, is_unlimited',
      [unlimited !== false, shop]
    );
    if (!s.rows.length) return res.status(404).json({ error: 'Tienda no encontrada' });
    res.json({ ok: true, shop: s.rows[0].shop_domain, is_unlimited: s.rows[0].is_unlimited });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Establecer creditos exactos
app.post('/admin/set-credits', checkAdmin, async function(req, res) {
  const { shop, credits } = req.body;
  if (!shop || credits === undefined) return res.status(400).json({ error: 'Falta shop o credits' });
  try {
    const s = await pool.query(
      'UPDATE shops SET credits = $1 WHERE shop_domain = $2 RETURNING id, shop_domain, credits',
      [parseInt(credits), shop]
    );
    if (!s.rows.length) return res.status(404).json({ error: 'Tienda no encontrada' });
    res.json({ ok: true, shop: s.rows[0].shop_domain, credits: s.rows[0].credits });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== FIN RUTAS DE ADMIN =====


// ===== RUTAS WOOCOMMERCE PLUGIN =====
// Middleware para autenticar plugin WooCommerce via x-api-key
async function wooAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const siteUrl = req.headers['x-site-url'];
  if (!apiKey || !siteUrl) return res.status(401).json({ error: 'Falta autenticacion' });
  try {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const s = await pool.query(
      'SELECT s.id, s.credits, s.is_unlimited, s.plan FROM licenses l JOIN shops s ON l.shop_id = s.id WHERE l.api_key_hash = $1 AND l.is_active = true',
      [hash]
    );
    if (!s.rows.length) return res.status(401).json({ error: 'API Key invalida' });
    req.wooShop = s.rows[0];
    next();
  } catch(e) { res.status(500).json({ error: e.message }); }
}

// Info del sitio (creditos)
app.get('/woo/info', wooAuth, function(req, res) {
  res.json({
    credits: req.wooShop.credits,
    is_unlimited: req.wooShop.is_unlimited,
    plan: req.wooShop.plan
  });
});

// Sugerir SEO para producto WooCommerce
app.post('/woo/suggest', wooAuth, async function(req, res) {
  const { product_id, title, description, short_desc, categories, sku, price } = req.body;
  if (!product_id || !title) return res.status(400).json({ error: 'Falta product_id o title' });
  const shop = req.wooShop;
  if (!shop.is_unlimited && shop.credits <= 0) {
    return res.status(402).json({ error: 'Sin creditos. Compra un plan.', needsCredits: true });
  }
  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const cats = Array.isArray(categories) ? categories.join(', ') : (categories || '');
    const prompt = 'Eres un experto en SEO para tiendas WooCommerce. Optimiza el SEO de este producto.' +
      '\n\nProducto: ' + title +
      '\nCategoria: ' + cats +
      '\nDescripcion actual: ' + (description || short_desc || '').replace(/<[^>]*>/g,'').slice(0,300) +
      '\n\nDevuelve SOLO un JSON con estas claves exactas: title (max 70 chars), meta_description (max 155 chars), body_html (descripcion completa en HTML simple), image_alt (max 125 chars). Sin texto extra.';
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
      temperature: 0.7
    });
    const raw = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
    const suggested = JSON.parse(raw);
    res.json({ success: true, suggested, product_id });
  } catch(e) { res.status(500).json({ error: 'Error IA: ' + e.message }); }
});

// Confirmar y descontar credito WooCommerce
app.post('/woo/confirm', wooAuth, async function(req, res) {
  const { product_id, title, meta_description, image_alt } = req.body;
  const shop = req.wooShop;
  try {
    if (!shop.is_unlimited) {
      await pool.query('UPDATE shops SET credits = credits - 1 WHERE id = $1 AND credits > 0', [shop.id]);
    }
    const updated = await pool.query('SELECT credits FROM shops WHERE id = $1', [shop.id]);
    res.json({ ok: true, credits: updated.rows[0].credits, is_unlimited: shop.is_unlimited });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// ===== FIN RUTAS WOOCOMMERCE =====

app.get('/health', function(req, res) {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.get('/api/me', async function(req, res) {
  if (!req.session || !req.session.shopId) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  try {
    const s = await pool.query('SELECT shop_domain,plan,credits,is_unlimited FROM shops WHERE id=$1', [req.session.shopId]);
    res.json(s.rows[0] || {});
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/shop-login', async function(req, res) {
  // Requiere sesion activa establecida por OAuth de Shopify via /app-login
  if (!req.session || !req.session.shopId) {
    return res.status(401).json({ error: 'No autenticado', needsAuth: true });
  }
  try {
    const s = await pool.query(
      'SELECT id,shop_domain,plan,credits,is_unlimited FROM shops WHERE id=$1',
      [req.session.shopId]
    );
    if (!s.rows.length) return res.status(401).json({ error: 'Sesion invalida', needsAuth: true });
    const shop = req.body.shop;
    // Verificar que el shop del request coincide con la sesion activa
    if (shop && s.rows[0].shop_domain !== shop) {
      return res.status(403).json({ error: 'Shop no coincide con la sesion activa', needsAuth: true });
    }
    res.json({ ok: true, shop_domain: s.rows[0].shop_domain, plan: s.rows[0].plan, credits: s.rows[0].credits, is_unlimited: s.rows[0].is_unlimited });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/optimizations', async function(req, res) {
  if (!req.session || !req.session.shopId) return res.status(401).json({ error: 'No autenticado' });
  try {
    const o = await pool.query('SELECT * FROM optimizations WHERE shop_id=$1 ORDER BY created_at DESC LIMIT 20', [req.session.shopId]);
    res.json({ optimizations: o.rows });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/app', function(req, res) {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/', async function(req, res) {
  var shop = req.query.shop;
  var host = req.query.host;
  if (!shop && host) {
    try {
      var decoded = Buffer.from(host, 'base64').toString('utf8');
      var m = decoded.match(/([a-z0-9-]+\.myshopify\.com)/);
      if (m) shop = m[1];
    } catch(e) {}
  }
  if (shop) {
    try {
      var s = await pool.query('SELECT id FROM shops WHERE shop_domain=$1', [shop]);
      if (s.rows.length) {
        req.session.shopId = s.rows[0].id;
        req.session.shop = shop;
        await new Promise(function(resolve) { req.session.save(resolve); });
      }
    } catch(e) {}
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Static assets servidos explicitamente (no usar express.static para evitar que intercepte /)

app.listen(PORT, '0.0.0.0', async function() {
  console.log('SEO Backend en puerto ' + PORT);
  const c = await pool.connect();
  try {
    await c.query("CREATE TABLE IF NOT EXISTS shops(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),shop_domain TEXT UNIQUE NOT NULL,access_token TEXT NOT NULL,plan TEXT DEFAULT 'starter',credits INTEGER DEFAULT 100,is_unlimited BOOLEAN DEFAULT FALSE,created_at TIMESTAMPTZ DEFAULT NOW())");
    await c.query("CREATE TABLE IF NOT EXISTS licenses(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),shop_id UUID REFERENCES shops(id),api_key_hash TEXT UNIQUE NOT NULL,label TEXT,is_active BOOLEAN DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT NOW())");
    await c.query("CREATE TABLE IF NOT EXISTS optimizations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),shop_id UUID REFERENCES shops(id),product_id TEXT NOT NULL,original_title TEXT,optimized_title TEXT,original_desc TEXT,optimized_desc TEXT,image_alt TEXT,meta_description TEXT,credits_used INTEGER DEFAULT 1,created_at TIMESTAMPTZ DEFAULT NOW())");
    await c.query("CREATE TABLE IF NOT EXISTS payments(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),shop_id UUID REFERENCES shops(id),reference TEXT UNIQUE NOT NULL,plan TEXT NOT NULL,credits INTEGER NOT NULL,status TEXT DEFAULT 'pending',created_at TIMESTAMPTZ DEFAULT NOW())");
    console.log('DB lista');
  } catch(e) {
    console.error('DB error:', e.message);
  } finally {
    c.release();
  }
});