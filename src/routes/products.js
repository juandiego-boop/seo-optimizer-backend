const express=require('express');
const axios=require('axios');
const pool=require('../db');
const router=express.Router();
async function shopifyGet(d,t,p){return(await axios.get(`https://${d}/admin/api/2024-01${p}`,{headers:{'X-Shopify-Access-Token':t}})).data;}
async function shopifyPut(d,t,p,b){return(await axios.put(`https://${d}/admin/api/2024-01${p}`,b,{headers:{'X-Shopify-Access-Token':t,'Content-Type':'application/json'}})).data;}
router.get('/products',async(req,res)=>{
  try{
    const id=req.session?.shopId;
    if(!id)return res.status(401).json({error:'No autenticado'});
    const s=await pool.query('SELECT * FROM shops WHERE id=$1',[id]);
    const{shop_domain:d,access_token:t,credits,is_unlimited}=s.rows[0];
    const data=await shopifyGet(d,t,'/products.json?limit=50&fields=id,title,body_html,product_type,images,status');
    res.json({products:data.products,credits,is_unlimited});
  }catch(e){res.status(500).json({error:e.message});}
});
router.get('/optimizations',async(req,res)=>{
  try{
    const id=req.session?.shopId;
    if(!id)return res.status(401).json({error:'No autenticado'});
    const r=await pool.query('SELECT * FROM optimizations WHERE shop_id=$1 ORDER BY created_at DESC LIMIT 50',[id]);
    res.json({optimizations:r.rows});
  }catch(e){res.status(500).json({error:e.message});}
});
module.exports={router,shopifyGet,shopifyPut};