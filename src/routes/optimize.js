const express=require('express');
const OpenAI=require('openai');
const pool=require('../db');
const checkCredits=require('../middleware/checkCredits');
const{shopifyGet,shopifyPut}=require('./products');
const router=express.Router();
const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
router.post('/optimize/:productId',checkCredits,async(req,res)=>{
  const{productId}=req.params;
  const{shopId,isUnlimited}=req;
  try{
    const s=await pool.query('SELECT * FROM shops WHERE id=$1',[shopId]);
    const{shop_domain:d,access_token:t}=s.rows[0];
    const data=await shopifyGet(d,t,`/products/${productId}.json`);
    const p=data.product;
    const desc=(p.body_html||'').replace(/<[^>]*>/g,'').slice(0,400);
    const c=await openai.chat.completions.create({model:'gpt-4o-mini',messages:[{role:'system',content:'Eres experto SEO ecommerce. Responde SOLO JSON valido sin markdown.'},{role:'user',content:`Optimiza SEO de este producto Shopify.\nTitulo: "${p.title}"\nDesc: "${desc}"\nCategoria: "${p.product_type||'General'}"\nResponde exactamente:\n{"title":"maximo 70 chars","meta_description":"maximo 155 chars","body_html":"<p>descripcion mejorada</p>","image_alt":"alt text SEO"}`}],temperature:0.7});
    let seo;
    try{seo=JSON.parse(c.choices[0].message.content);}catch{const m=c.choices[0].message.content.match(/\{[\s\S]*\}/);seo=JSON.parse(m[0]);}
    await shopifyPut(d,t,`/products/${productId}.json`,{product:{id:productId,title:seo.title,body_html:seo.body_html}});
    if(p.images?.[0])await shopifyPut(d,t,`/products/${productId}/images/${p.images[0].id}.json`,{image:{id:p.images[0].id,alt:seo.image_alt}});
    if(!isUnlimited)await pool.query('UPDATE shops SET credits=credits-1 WHERE id=$1',[shopId]);
    await pool.query('INSERT INTO optimizations(shop_id,product_id,original_title,optimized_title,original_desc,optimized_desc,image_alt,meta_description,credits_used)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[shopId,productId,p.title,seo.title,desc,seo.body_html,seo.image_alt,seo.meta_description,isUnlimited?0:1]);
    const u=await pool.query('SELECT credits,is_unlimited FROM shops WHERE id=$1',[shopId]);
    res.json({success:true,seo,credits:u.rows[0].credits,is_unlimited:u.rows[0].is_unlimited});
  }catch(e){console.error(e.message);res.status(500).json({error:e.message});}
});
module.exports=router;