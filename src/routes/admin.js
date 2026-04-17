const express=require('express');
const crypto=require('crypto');
const pool=require('../db');
const router=express.Router();
function adminAuth(req,res,next){if(req.headers['x-admin-key']!==process.env.ADMIN_SECRET)return res.status(401).json({error:'No autorizado'});next();}
router.get('/admin/shops',adminAuth,async(req,res)=>{const r=await pool.query('SELECT id,shop_domain,plan,credits,is_unlimited,created_at FROM shops ORDER BY created_at DESC');res.json({shops:r.rows});});
router.post('/admin/generate-key',adminAuth,async(req,res)=>{
  const{shopDomain,label}=req.body;
  const s=await pool.query('SELECT id FROM shops WHERE shop_domain=$1',[shopDomain]);
  if(!s.rows.length)return res.status(404).json({error:'Tienda no encontrada'});
  const raw='seo_'+crypto.randomBytes(32).toString('hex');
  const hash=crypto.createHash('sha256').update(raw).digest('hex');
  await pool.query('INSERT INTO licenses(shop_id,api_key_hash,label)VALUES($1,$2,$3)',[s.rows[0].id,hash,label||'Enterprise']);
  await pool.query("UPDATE shops SET is_unlimited=true,plan='enterprise' WHERE id=$1",[s.rows[0].id]);
  res.json({api_key:raw,message:'Guarda esta clave, no se mostrara de nuevo.'});
});
router.post('/admin/add-credits',adminAuth,async(req,res)=>{const{shopDomain,amount}=req.body;await pool.query('UPDATE shops SET credits=credits+$1 WHERE shop_domain=$2',[amount,shopDomain]);res.json({ok:true});});
module.exports=router;