require('dotenv').config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { Pool } = require('pg');

// ========== Cloudinary配置 ==========
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "wrong-question-img",
    allowed_formats: ["jpg","jpeg","png","gif","webp"]
  }
});
const upload = multer({ storage: storage });

// ========== PG数据库连接池 ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 服务启动自动建错题表 wrong_question
(async function initDB(){
  const createSql = `
CREATE TABLE IF NOT EXISTS wrong_question (
    id SERIAL PRIMARY KEY,
    question TEXT,
    answer TEXT,
    subject TEXT,
    ip TEXT,
    area TEXT,
    created_at TEXT,
    img_url TEXT
);
`
  try{
    await pool.query(createSql);
    console.log("✅数据库表初始化完成，wrong_question表已存在/自动创建成功");
  }catch(e){
    console.error("❌数据库初始化失败",e);
  }
})();

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ========== 账号配置区（7个科目账号，密码统一123456） ==========
const userList = [
  { username: "yuwen",  sha: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92", fb: "fb_7dd1705a", subject: "语文" },
  { username: "shuxue", sha: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92", fb: "fb_7dd1705a", subject: "数学" },
  { username: "yingyu", sha: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92", fb: "fb_7dd1705a", subject: "英语" },
  { username: "lishi", sha: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92", fb: "fb_7dd1705a", subject: "历史" },
  { username: "zhengzhi", sha: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92", fb: "fb_7dd1705a", subject: "政治" },
  { username: "shengwu", sha: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92", fb: "fb_7dd1705a", subject: "生物" },
  { username: "wuli", sha: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92", fb: "fb_7dd1705a", subject: "物理" }
];
const tokenMap = {};

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    return xff.split(",")[0].trim();
  }
  return req.ip;
}
function getNowDateTime() {
  const d = new Date();
  const bjTime = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const Y = bjTime.getUTCFullYear();
  const M = String(bjTime.getUTCMonth() + 1).padStart(2, "0");
  const D = String(bjTime.getUTCDate()).padStart(2, "0");
  const h = String(bjTime.getUTCHours()).padStart(2, "0");
  const m = String(bjTime.getUTCMinutes()).padStart(2, "0");
  const s = String(bjTime.getUTCSeconds()).padStart(2, "0");
  return Y + "-" + M + "-" + D + " " + h + ":" + m + ":" + s;
}
const countryMap = {
  FI: "芬兰", CN: "中国", US: "美国", SG: "新加坡", GB: "英国", DE: "德国",
  FR: "法国", JP: "日本", KR: "韩国", CA: "加拿大", AU: "澳大利亚", RU: "俄罗斯"
};
function getIpArea(ip) {
  return new Promise(function (resolve) {
    let area = "未知地区";
    try {
      const req = http.get({
        hostname: "ip-api.com",
        path: "/json/" + ip + "?lang=zh-CN",
        timeout: 2500
      }, function (res) {
        let buf = "";
        res.on("data", function (d) { buf += d; });
        res.on("end", function () {
          try {
            const data = JSON.parse(buf);
            if (data.status === "success") {
              area = data.regionName + " " + data.city;
            } else if (data.countryCode && countryMap[data.countryCode]) {
              area = countryMap[data.countryCode];
            }
          } catch (e) {}
          resolve(area);
        });
      });
      req.on("error", function () { resolve("未知地区"); });
      req.on("timeout", function () { req.destroy(); resolve("未知地区"); });
    } catch (e) {
      resolve("未知地区");
    }
  });
}
function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}
function fbHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return "fb_" + h.toString(16);
}

// 登录接口 /api/login 【前端index.html调用这个】
app.post("/api/login", function (req, res) {
  const username = req.body.username;
  const plainPassword = req.body.password || "";
  const findUser = userList.find(function (u) {
    if (u.username !== username) return false;
    const s = sha256(plainPassword);
    const f = fbHash(plainPassword);
    return u.sha === s || u.fb === f;
  });
  if (!findUser) {
    return res.json({ success: false });
  }
  const newToken = crypto.randomBytes(16).toString("hex");
  tokenMap[newToken] = findUser;
  res.json({ success: true, token: newToken, user: findUser });
});

// 新增错题接口 /api/add
app.post("/api/add", upload.single("imgFile"), async function (req, res) {
  const question = req.body.question || "";
  const answer = req.body.answer || "";
  const token = req.body.token || "";
  const user = tokenMap[token];
  if (!user) {
    console.log("add接口：token无效");
    return res.json({ ok: false, needRelogin: true });
  }
  if(!question.trim() || !answer.trim()){
    return res.json({ok:false, error:"题目、答案不能为空"});
  }
  let clientIp = "unknown";
  let area = "未知地区";
  let imgUrl = null;
  if(req.file){
    imgUrl = req.file.path;
  }
  try {
    clientIp = getClientIp(req);
    area = await getIpArea(clientIp);
  } catch (e) {
    area = "未知地区";
  }
  try {
    const nowTime = getNowDateTime();
    await pool.query(
      `INSERT INTO wrong_question(question, answer, subject, ip, area, created_at, img_url) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [question, answer, user.subject, clientIp, area, nowTime, imgUrl]
    );
    console.log("错题保存成功：", question);
    return res.json({ ok: true });
  } catch (err) {
    console.error("数据库插入错题失败：", err);
    return res.json({ ok: false, error: String(err.message || err) });
  }
});

// 编辑错题接口 /api/edit
app.post("/api/edit", upload.single("imgFile"), async function(req,res){
  const token = req.body.token;
  const id = parseInt(req.body.id || "0");
  const question = req.body.question || "";
  const answer = req.body.answer || "";
  const user = tokenMap[token];
  if(!user) return res.json({ok:false, needRelogin:true});
  if(!id || !question.trim() || !answer.trim()){
    return res.json({ok:false, error:"id、题目、答案不能为空"});
  }
  const rowResult = await pool.query(`SELECT * FROM wrong_question WHERE id=$1`, [id]);
  const row = rowResult.rows[0];
  if(!row) return res.json({ok:false, error:"该错题不存在"});
  if(row.subject !== user.subject){
    return res.json({ok:false, error:"没有权限编辑别人科目的错题"});
  }
  let newImgUrl = row.img_url;
  if(req.file){
    newImgUrl = req.file.path;
  }
  try{
    await pool.query(`UPDATE wrong_question SET question=$1, answer=$2, img_url=$3 WHERE id=$4`,
      [question, answer, newImgUrl, id]);
    return res.json({ok:true});
  }catch(err){
    console.error("编辑错题失败",err);
    return res.json({ok:false, error:String(err.message)});
  }
});

// 查询错题列表 /api/list
app.get("/api/list", async function (req, res) {
  const token = req.query.token;
  const page = parseInt(req.query.page || "1", 10);
  const filterSubject = req.query.filterSubject || "";
  const filterStart = req.query.filterStart || "";
  const filterEnd = req.query.filterEnd || "";
  const user = tokenMap[token];
  if (!user) {
    return res.json({ list: [], total: 0, page: 1, pageSize: 10, needRelogin: true });
  }
  const pageSize = 10;
  const offset = (page - 1) * pageSize;
  let sqlWhere = ` WHERE subject = $1 `;
  let params = [user.subject];
  let paramIndex = 2;
  if (filterSubject) {
    sqlWhere += ` AND subject = $${paramIndex++}`;
    params.push(filterSubject);
  }
  if (filterStart) {
    sqlWhere += ` AND created_at >= $${paramIndex++}`;
    params.push(filterStart + " 00:00:00");
  }
  if (filterEnd) {
    sqlWhere += ` AND created_at <= $${paramIndex++}`;
    params.push(filterEnd + " 23:59:59");
  }
  try {
    const countResult = await pool.query(`SELECT COUNT(*) AS cnt FROM wrong_question ${sqlWhere}`, params);
    const total = Number(countResult.rows[0].cnt);
    params.push(pageSize, offset);
    const listResult = await pool.query(`SELECT * FROM wrong_question ${sqlWhere} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`, params);
    res.json({
      list: listResult.rows,
      total: total,
      page: page,
      pageSize: pageSize,
      totalPage: Math.ceil(total / pageSize)
    });
  } catch (err) {
    console.error("查询错题失败：", err);
    res.json({ list: [], total: 0, page: 1, pageSize: 10, error: String(err.message || err) });
  }
});

app.use("/api", function (req, res) {
  res.status(404).json({ ok: false, error: "接口不存在: " + req.method + " " + req.path });
});
app.use(function (err, req, res, next) {
  console.error("接口异常：", err);
  res.status(500).json({ ok: false, error: String(err.message || err) });
});

app.listen(PORT, function () {
  console.log("网站运行在端口:" + PORT);
});
