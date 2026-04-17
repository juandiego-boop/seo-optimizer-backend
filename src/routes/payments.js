const express=require('express');
const pool=require('../db');
const router=express.Router();

const PLANS={
  starter:{credits:50,price:999,name:'Starter'},
  growth:{credits:200,price:2999,name:'Growth'},
  pro:{credits:500,price:5999,name:'Pro'}
};

// Crear sesión de checkout con Stripe
router.post('/payments/create-checkout',async(req,res)=>{
  try{
    const stripe=require('stripe')(process.env.STRIPE_SECRET_KEY);
    const{plan}=req.body;
    const shopId=req.session?.shopId;
    if(!shopId)return res.status(401).json({error:'No autenticado'});
    if(!PLANS[plan])return res.status(400).json({error:'Plan inválido'});
    const shop=await pool.query('SELECT shop_domain FROM shops WHERE id=$1',[shopId]);
    const session=await stripe.checkout.sessions.create({
      payment_method_types:['card'],
      line_items:[{price_data:{currency:'usd',product_data:{name:`SEO Optimizer Pro - Plan ${PLANS[plan].name}`,description:`${PLANS[plan].credits} créditos para optimizar productos con IA`},unit_amount:PLANS[plan].price},quantity:1}],
      mode:'payment',
      success_url:`${process.env.HOST}/payments/success?session_id={CHECKOUT_SESSION_ID}&plan=${plan}`,
      cancel_url:`${process.env.HOST}/app`,
      metadata:{shopId,plan,shop_domain:shop.rows[0].shop_domain}
    });
    res.json({url:session.url,session_id:session.id});
  }catch(e){
    console.error('Stripe error:',e.message);
    res.status(500).json({error:e.message});
  }
});

// Callback exitoso
router.get('/payments/success',async(req,res)=>{
  try{
    const stripe=require('stripe')(process.env.STRIPE_SECRET_KEY);
    const{session_id,plan}=req.query;
    const session=await stripe.checkout.sessions.retrieve(session_id);
    if(session.payment_status==='paid'){
      const{shopId}=session.metadata;
      const credits=PLANS[plan]?.credits||0;
      await pool.query('UPDATE shops SET credits=credits+$1 WHERE id=$2',[credits,shopId]);
      const updated=await pool.query('SELECT credits FROM shops WHERE id=$1',[shopId]);
      res.send(`<!DOCTYPE html><html><head><title>Pago exitoso</title><meta http-equiv="refresh" content="3;url=/app"></head>
      <body style="font-family:sans-serif;text-align:center;padding:3rem">
      <h1>✅ Pago exitoso</h1>
      <p>Se agregaron <strong>${credits} créditos</strong> a tu cuenta.</p>
      <p>Total actual: <strong>${updated.rows[0].credits} créditos</strong></p>
      <p>Redirigiendo...</p></body></html>`);
    }else{
      res.redirect('/app');
    }
  }catch(e){
    res.status(500).send('Error procesando pago: '+e.message);
  }
});

// Webhook de Stripe (confirmación segura)
router.post('/payments/webhook',express.raw({type:'application/json'}),async(req,res)=>{
  const sig=req.headers['stripe-signature'];
  let event;
  try{
    const stripe=require('stripe')(process.env.STRIPE_SECRET_KEY);
    event=stripe.webhooks.constructEvent(req.body,sig,process.env.STRIPE_WEBHOOK_SECRET);
  }catch(e){
    return res.status(400).send('Webhook error: '+e.message);
  }
  if(event.type==='checkout.session.completed'){
    const session=event.data.object;
    if(session.payment_status==='paid'){
      const{shopId,plan}=session.metadata;
      const credits=PLANS[plan]?.credits||0;
      await pool.query('UPDATE shops SET credits=credits+$1 WHERE id=$2',[credits,shopId]);
      console.log(`✅ ${credits} créditos agregados a shop ${shopId}`);
    }
  }
  res.json({received:true});
});

// Obtener planes disponibles
router.get('/payments/plans',(req,res)=>{
  res.json({plans:Object.entries(PLANS).map(([id,p])=>({id,...p}))});
});

module.exports=router;