const express=require('express');
const crypto=require('crypto');
const pool=require('../db');
const router=express.Router();

const PLANS={
  starter:{credits:50,amountInCents:3990000,priceCOP:39900,name:'Starter'},
  growth:{credits:200,amountInCents:9990000,priceCOP:99900,name:'Growth'},
  pro:{credits:500,amountInCents:19990000,priceCOP:199900,name:'Pro'}
};

function generateSignature(ref,amount,currency,expiry,secret){
  const str=ref+amount+currency+expiry+secret;
  return crypto.createHash('sha256').update(str).digest('hex');
}

router.post('/payments/create-checkout',async(req,res)=>{
  try{
    const{plan}=req.body;
    const shopId=req.session?.shopId;
    if(!shopId)return res.status(401).json({error:'No autenticado'});
    if(!PLANS[plan])return res.status(400).json({error:'Plan invalido'});
    const p=PLANS[plan];
    const ref='SEO-'+shopId.slice(0,8)+'-'+Date.now();
    const currency='COP';
    const exp=new Date(Date.now()+30*60*1000).toISOString();
    const sig=generateSignature(ref,p.amountInCents,currency,exp,process.env.WOMPI_INTEGRITY_KEY);
    const redirectUrl=encodeURIComponent(`${process.env.HOST}/payments/success?ref=${ref}&plan=${plan}&shopId=${shopId}`);
    const wompiUrl=`https://checkout.wompi.co/p/?public-key=${process.env.WOMPI_PUBLIC_KEY}&currency=${currency}&amount-in-cents=${p.amountInCents}&reference=${ref}&signature:integrity=${sig}&redirect-url=${redirectUrl}&expiration-time=${encodeURIComponent(exp)}`;
    await pool.query('INSERT INTO payments(shop_id,reference,plan,credits,status)VALUES($1,$2,$3,$4,$5)ON CONFLICT(reference)DO NOTHING',[shopId,ref,plan,p.credits,'pending']);
    res.json({url:wompiUrl,reference:ref});
  }catch(e){
    console.error('Wompi error:',e.message);
    res.status(500).json({error:e.message});
  }
});

router.get('/payments/success',async(req,res)=>{
  try{
    const{ref,plan,shopId}=req.query;
    const txResp=await fetch(`https://production.wompi.co/v1/transactions?reference=${ref}`,{
      headers:{Authorization:`Bearer ${process.env.WOMPI_PRIVATE_KEY}`}
    });
    const txData=await txResp.json();
    const tx=txData.data?.[0];
    if(tx&&tx.status==='APPROVED'){
      const credits=PLANS[plan]?.credits||0;
      await pool.query('UPDATE shops SET credits=credits+$1 WHERE id=$2',[credits,shopId]);
      await pool.query("UPDATE payments SET status='approved' WHERE reference=$1",[ref]);
      res.send(`<!DOCTYPE html><html><head><title>Pago exitoso</title><meta http-equiv="refresh" content="3;url=${process.env.HOST}/app"></head>
<body style="font-family:sans-serif;text-align:center;padding:3rem;background:#f0fdf4">
<div style="max-width:400px;margin:0 auto;background:white;padding:2rem;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,.1)">
<div style="font-size:48px">✅</div><h1 style="color:#16a34a">Pago exitoso</h1>
<p>Se agregaron <strong>${credits} créditos</strong> a tu cuenta.</p>
<p style="color:#6b7280">Redirigiendo en 3 segundos...</p></div></body></html>`);
    }else{
      res.send('<h1>❌ Pago pendiente o fallido</h1><a href="'+process.env.HOST+'/app">Volver</a>');
    }
  }catch(e){res.status(500).send('Error: '+e.message);}
});

router.post('/payments/webhook',async(req,res)=>{
  try{
    const event=req.body;
    // Verificar firma del webhook
    if(process.env.WOMPI_EVENTS_KEY){
      const sig=req.headers['x-event-checksum'];
      if(sig){
        const check=crypto.createHash('sha256').update(JSON.stringify(event)+process.env.WOMPI_EVENTS_KEY).digest('hex');
        if(sig!==check){return res.status(401).json({error:'Firma invalida'});}
      }
    }
    if(event.event==='transaction.updated'&&event.data?.transaction?.status==='APPROVED'){
      const ref=event.data.transaction.reference;
      const pmt=await pool.query('SELECT * FROM payments WHERE reference=$1',[ref]);
      if(pmt.rows.length&&pmt.rows[0].status==='pending'){
        const{shop_id,credits}=pmt.rows[0];
        await pool.query('UPDATE shops SET credits=credits+$1 WHERE id=$2',[credits,shop_id]);
        await pool.query("UPDATE payments SET status='approved' WHERE reference=$1",[ref]);
        console.log('✅ Wompi pago confirmado:',ref,credits,'créditos');
      }
    }
    res.json({received:true});
  }catch(e){
    console.error('Webhook error:',e.message);
    res.status(500).json({error:e.message});
  }
});

router.get('/payments/plans',(req,res)=>{
  res.json({plans:Object.entries(PLANS).map(([id,p])=>({
    id,
    name:p.name,
    credits:p.credits,
    priceCOP:p.priceCOP,
    amountInCents:p.amountInCents
  }))});
});

module.exports=router;