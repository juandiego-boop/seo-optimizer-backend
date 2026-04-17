const crypto=require('crypto');
const pool=require('../db');
async function checkCredits(req,res,next){
  try{
    const k=req.headers['x-seo-api-key'];
    if(k){
      const h=crypto.createHash('sha256').update(k).digest('hex');
      const r=await pool.query('SELECT l.*,s.id shop_id FROM licenses l JOIN shops s ON l.shop_id=s.id WHERE l.api_key_hash=$1 AND l.is_active=true',[h]);
      if(r.rows.length){req.shopId=r.rows[0].shop_id;req.isUnlimited=true;return next();}
      return res.status(401).json({error:'API key invalida'});
    }
    const id=req.session?.shopId;
    if(!id)return res.status(401).json({error:'No autenticado'});
    const s=await pool.query('SELECT * FROM shops WHERE id=$1',[id]);
    if(!s.rows.length)return res.status(401).json({error:'Tienda no encontrada'});
    if(s.rows[0].is_unlimited){req.shopId=id;req.isUnlimited=true;return next();}
    if(s.rows[0].credits<=0)return res.status(402).json({error:'Sin creditos',credits:0});
    req.shopId=id;req.shop=s.rows[0];req.isUnlimited=false;next();
  }catch(e){console.error(e);res.status(500).json({error:'Error interno'});}
}
module.exports=checkCredits;