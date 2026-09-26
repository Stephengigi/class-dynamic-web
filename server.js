require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { Pool } = require('pg');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const app = express();
const PORT = process.env.PORT || 3000;

// ========== Cloudinary配置 ==========
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    resource_type: 'auto',
    format: 'mp4'
  }
});
const upload = multer({ storage });

// ========== PostgreSQL数据库连接 ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 初始化数据库表
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT,
      active BOOLEAN DEFAULT true
    );
  `);
  // 插入两个账号：admin / w00666666
  const adminHash = await bcrypt.hash('123456', 10);
  const viewerHash = await bcrypt.hash('hwissb', 10);
  try {
    await pool.query(`INSERT INTO users(username,password) VALUES($1,$2) ON CONFLICT(username) DO NOTHING`,['admin',adminHash]);
    await pool.query(`INSERT INTO users(username,password) VALUES($1,$2) ON CONFLICT(username) DO NOTHING`,['w00666666',viewerHash]);
  }catch(e){}
}
initDB();

// ========== 中间件 ==========
app.use(express.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'my-secret-123456',
  resave: false,
  saveUninitialized: false,
  cookie:{ secure:false }
}));

// 登录接口
app.post('/login',async (req,res)=>{
  const {username,password}=req.body;
  const result = await pool.query(`SELECT * FROM users WHERE username=$1`,[username]);
  if(result.rows.length===0) return res.json({ok:false,msg:"账号不存在"});
  const user = result.rows[0];
  const ok = await bcrypt.compare(password,user.password);
  if(!ok) return res.json({ok:false,msg:"密码错误"});
  req.session.user = user;
  res.json({ok:true});
});

// 退出登录
app.get('/logout',(req,res)=>{
  req.session.destroy();
  res.redirect('/login.html');
});

// 鉴权中间件
function requireLogin(req,res,next){
  if(!req.session.user) return res.redirect('/login.html');
  next();
}

// 页面路由
app.get('/',(req,res)=>res.redirect('/login.html'));
app.get('/dashboard.html',requireLogin,(req,res)=>res.sendFile(__dirname+'/public/dashboard.html'));
app.get('/viewer.html',requireLogin,(req,res)=>res.sendFile(__dirname+'/public/viewer.html'));

// 媒体上传
app.post('/upload',requireLogin,upload.single('media'),(req,res)=>{
  const url = req.file.path;
  const type = req.file.resource_type;
  pool.query(`INSERT INTO media(url,type,title,active) VALUES($1,$2,$3,true) RETURNING *`,[url,type,req.body.title||''])
  .then(r=>res.json({ok:true,data:r.rows[0]}))
  .catch(e=>res.json({ok:false,msg:e.message}));
});

// 获取媒体列表
app.get('/media-list',requireLogin,async (req,res)=>{
  const r = await pool.query(`SELECT * FROM media ORDER BY id DESC`);
  res.json(r.rows);
});

// 删除媒体
app.delete('/media/:id',requireLogin,async (req,res)=>{
  const id = req.params.id;
  await pool.query(`DELETE FROM media WHERE id=$1`,[id]);
  res.json({ok:true});
});

app.listen(PORT,()=>{
  console.log(`Server running on port ${PORT}`);
});
