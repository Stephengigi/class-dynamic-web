const express = require("express");
const Database = require('better-sqlite3');
const path = require("path");
const crypto = require("crypto");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname,"public")));

// ========== 账号配置区 ==========
const userList = [
    {username:"yuwen", password:"123456", subject:"语文"},
    {username:"shuxue", password:"123456", subject:"数学"},
    {username:"yingyu", password:"123456", subject:"英语"},
]
// 临时存放登录token
const tokenMap = {};

// 打开数据库
const db = new Database('./data.db');

// 创建表，新增ip、area字段
db.exec(`CREATE TABLE IF NOT EXISTS wrong_question(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT,
    answer TEXT,
    subject TEXT,
    ip TEXT,
    area TEXT
)`);

// 获取用户真实IP的工具函数
function getClientIp(req) {
    // 处理上线托管平台的代理IP
    const xff = req.headers['x-forwarded-for'];
    if(xff){
        return xff.split(',')[0].trim();
    }
    return req.ip;
}

// 登录接口
app.post("/api/login",(req,res)=>{
    const {username,password} = req.body;
    const findUser = userList.find(u=>u.username === username && u.password === password);
    if(!findUser){
        return res.json({success:false});
    }
    const newToken = crypto.randomBytes(16).toString("hex");
    tokenMap[newToken] = findUser;
    res.json({success:true, token:newToken});
})

// 新增错题接口
app.post("/api/add",async (req,res)=>{
    const {question,answer,token} = req.body;
    const user = tokenMap[token];
    if(!user){
        return res.json({ok:false});
    }
    try{
        const clientIp = getClientIp(req);
        // 调用免费接口，IP转地区
        let area = "未知地区";
        try{
            const ipRes = await fetch(`http://ip-api.com/json/${clientIp}?lang=zh-CN`);
            const ipData = await ipRes.json();
            if(ipData.status === "success"){
                area = `${ipData.regionName} ${ipData.city}`;
            }
        }catch(e){
            area = "地区查询失败";
        }

        const stmt = db.prepare(`INSERT INTO wrong_question(question,answer,subject,ip,area) VALUES (?,?,?,?,?)`);
        stmt.run(question,answer,user.subject,clientIp,area);
        res.json({ok:true});
    }catch(err){
        console.log(err);
        res.json({ok:false});
    }
})

// 查询全部错题接口
app.get("/api/list",(req,res)=>{
    const rows = db.prepare("SELECT * FROM wrong_question").all();
    res.json(rows);
})

app.listen(PORT,()=>{
    console.log(`网站本地运行在 http://localhost:3000`)
})
