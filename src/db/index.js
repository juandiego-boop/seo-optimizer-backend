const{Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
pool.on('error',err=>console.error('DB:',err));
module.exports=pool;