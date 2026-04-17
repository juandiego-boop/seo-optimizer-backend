require('dotenv').config();
const express=require('express');
const session=require('express-session');
const cors=require('cors');
const pool=require('./db');
const authRoutes=require('./routes/auth');
const{router:productRoutes}=require('./routes/products');
const optimizeRoutes=require('./routes/optimize');
const adminRoutes=require('./routes/admin');
const app=express();
const PORT=process.env.PORT||3000;
app.use(cors({origin:true,credentials:true}));
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||'seo-secret',resave:false,saveUninitialized:false,cookie:{secure:false,maxAge:7*24*60*60*1000}}));
app.use('/',authRoutes);
app.use('/api',productRoutes);
app.use('/api',optimizeRoutes);
app.use('/',adminRoutes);
app.get('/health',(req,res)=>res.json({status:'ok',ts:new Date().toISOString()}));
app.get('/api/me',async(req,res)=>{if(!req.session?.shopId)return res.status(401).json({error:'No autenticado'});const s=await pool.query('SELECT shop_domain,plan,credits,is_unlimited FROM shops WHERE id=$1',[req.session.shopId]);res.json(s.rows[0]||{});});
app.get('/app',(req,res)=>res.send('<h1>SEO Optimizer Backend OK</h1><p>Conecta tu tienda: <code>/auth?shop=tutienda.myshopify.com</code></p>'));
app.listen(PORT,'0.0.0.0',async()=>{
  console.log(`SEO Backend en puerto ${PORT}`);
  const c=await pool.connect();
  try{
    await c.query(`CREATE TABLE IF NOT EXISTS shops(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),shop_domain TEXT UNIQUE NOT NULL,access_token TEXT NOT NULL,plan TEXT DEFAULT \'starter\',credits INTEGER DEFAULT 50,is_unlimited BOOLEAN DEFAULT FALSE,created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS licenses(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),shop_id UUID REFERENCES shops(id),api_key_hash TEXT UNIQUE NOT NULL,label TEXT,is_active BOOLEAN DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS optimizations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),shop_id UUID REFERENCES shops(id),product_id TEXT NOT NULL,original_title TEXT,optimized_title TEXT,original_desc TEXT,optimized_desc TEXT,image_alt TEXT,meta_description TEXT,credits_used INTEGER DEFAULT 1,created_at TIMESTAMPTZ DEFAULT NOW());`);
    console.log('DB lista');
  }catch(e){console.error('DB error:',e.message);}finally{c.release();}
});