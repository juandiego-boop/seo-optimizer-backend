const express = require('express');
const OpenAI = require('openai');
const pool = require('../db');
const checkCredits = require('../middleware/checkCredits');
const { shopifyGet, shopifyPut } = require('./products');
const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateSEO(product) {
  const desc = (product.body_html || '').replace(/<[^>]*>/g, '').slice(0, 500);
  const prompt = 'Optimiza el SEO de este producto Shopify en espanol latinoamericano.' +
    ' Titulo: "' + product.title + '".' +
    ' Descripcion: "' + desc + '".' +
    ' Categoria: "' + (product.product_type || 'General') + '".' +
    ' Responde SOLO este JSON sin markdown:' +
    ' {"title":"titulo maximo 70 chars","meta_description":"meta maximo 155 chars","body_html":"<p>descripcion 150-200 palabras</p>","image_alt":"alt maximo 125 chars"}';
  const c = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'Eres experto SEO ecommerce. Responde SOLO JSON valido sin markdown.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7
  });
  let seo;
  try { seo = JSON.parse(c.choices[0].message.content); }
  catch(e) {
    const m = c.choices[0].message.content.match(/\{[\s\S]*\}/);
    seo = JSON.parse(m[0]);
  }
  return seo;
}

// Ruta 1: Generar sugerencia sin guardar (no consume credito)
router.post('/suggest/:productId', async function(req, res) {
  if (!req.session || !req.session.shopId) return res.status(401).json({ error: 'No autenticado' });
  const productId = req.params.productId;
  const shopId = req.session.shopId;
  try {
    const s = await pool.query('SELECT * FROM shops WHERE id=$1', [shopId]);
    if (!s.rows.length) return res.status(404).json({ error: 'Tienda no encontrada' });
    const shop = s.rows[0];
    const data = await shopifyGet(shop.shop_domain, shop.access_token, '/products/' + productId + '.json');
    const product = data.product;
    const seo = await generateSEO(product);
    res.json({
      success: true,
      original: {
        title: product.title,
        body_html: product.body_html || '',
        image_alt: product.images && product.images[0] ? product.images[0].alt || '' : ''
      },
      suggested: seo,
      productId: productId
    });
  } catch(e) {
    console.error('Suggest error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Ruta 2: Confirmar y guardar (consume 1 credito)
router.post('/confirm/:productId', checkCredits, async function(req, res) {
  const productId = req.params.productId;
  const shopId = req.shopId;
  const isUnlimited = req.isUnlimited;
  const title = req.body.title;
  const body_html = req.body.body_html;
  const meta_description = req.body.meta_description;
  const image_alt = req.body.image_alt;
  if (!title) return res.status(400).json({ error: 'Falta titulo' });
  try {
    const s = await pool.query('SELECT * FROM shops WHERE id=$1', [shopId]);
    const shop = s.rows[0];
    const data = await shopifyGet(shop.shop_domain, shop.access_token, '/products/' + productId + '.json');
    const product = data.product;
    await shopifyPut(shop.shop_domain, shop.access_token, '/products/' + productId + '.json', {
      product: { id: productId, title: title, body_html: body_html || product.body_html }
    });
    if (product.images && product.images[0] && image_alt) {
      await shopifyPut(shop.shop_domain, shop.access_token, '/products/' + productId + '/images/' + product.images[0].id + '.json', {
        image: { id: product.images[0].id, alt: image_alt }
      });
    }
    if (!isUnlimited) {
      await pool.query('UPDATE shops SET credits=credits-1 WHERE id=$1', [shopId]);
    }
    const desc = (product.body_html || '').replace(/<[^>]*>/g, '').slice(0, 500);
    await pool.query(
      'INSERT INTO optimizations(shop_id,product_id,original_title,optimized_title,original_desc,optimized_desc,image_alt,meta_description,credits_used) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [shopId, productId, product.title, title, desc, body_html, image_alt, meta_description, isUnlimited ? 0 : 1]
    );
    const u = await pool.query('SELECT credits,is_unlimited FROM shops WHERE id=$1', [shopId]);
    res.json({ success: true, credits: u.rows[0].credits, is_unlimited: u.rows[0].is_unlimited });
  } catch(e) {
    console.error('Confirm error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;