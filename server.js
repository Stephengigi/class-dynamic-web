const express = require("express");
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const crypto = require("crypto");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ========== 账号配置区（密码不存明文，只存哈希）==========
// sha = SHA-256(密码)，fb = 简易哈希(密码)，任一匹配即登录成功
const userList = [
  { username: "yuwen",  sha: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92", fb: "fb_7dd1705a", subject: "语文" },
  { username: "shuxue", sha: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92", fb: "fb_7dd1705a", subject: "数学" },
  { username: "yingyu", sha: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92", fb: "fb_7dd1705a", subject: "英语" }
];

// 登录 token 内存存储
const tokenMap = {};

// 打开数据库（Node 内置 SQLite，无需编译安装）
const db = new DatabaseSync("./data.db");

// 建表（兼容旧表：老表不会重建，只补缺失的 created_at 列，老数据保留）
db.exec(`
CREATE TABLE IF NOT EXISTS wrong_question(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT,
  answer TEXT,
  subject TEXT,
  ip TEXT,
  area TEXT
);
`);

// 检查并补 created_at 列（老版本表没有这一列）
function ensureColumn() {
  const cols = db.prepare("PRAGMA table_info(wrong_question)").all();
  const hasCreatedAt = cols.some(function (c) { return c.name === "created_at"; });
  if (!hasCreatedAt) {
    db.exec("ALTER TABLE wrong_question ADD COLUMN created_at TEXT");
    console.log("已为旧表补上 created_at 列");
  }
}
ensureColumn();

// 获取客户端真实 IP
function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    return xff.split(",")[0].trim();
  }
  return req.ip;
}

// 当前时间，精确到秒：YYYY-MM-DD HH:mm:ss
function getNowDateTime() {
  const d = new Date();
  // 获取北京时间（UTC+8）
  const bjTime = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const Y = bjTime.getUTCFullYear();
  const M = String(bjTime.getUTCMonth() + 1).padStart(2, "0");
  const D = String(bjTime.getUTCDate()).padStart(2, "0");
  const h = String(bjTime.getUTCHours()).padStart(2, "0");
  const m = String(bjTime.getUTCMinutes()).padStart(2, "0");
  const s = String(bjTime.getUTCSeconds()).padStart(2, "0");
  return Y + "-" + M + "-" + D + " " + h + ":" + m + ":" + s;
}


// 国家码转中文
const countryMap = {
  FI: "芬兰", CN: "中国", US: "美国", SG: "新加坡", GB: "英国", DE: "德国",
  FR: "法国", JP: "日本", KR: "韩国", CA: "加拿大", AU: "澳大利亚", RU: "俄罗斯"
};

// 用 node 内置 http 请求 ip-api 获取地区，任何异常都返回"未知地区"，绝不往外抛
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
          } catch (e) {
            // 解析失败忽略，用默认"未知地区"
          }
          resolve(area);
        });
      });
      req.on("error", function () { resolve("未知地区"); });
      req.on("timeout", function () { req.destroy(); resolve("未知地区"); });
    } catch (e) {
      // http.get 同步抛错（参数异常等），直接兜底
      resolve("未知地区");
    }
  });
}

// 密码哈希工具函数（服务端只存哈希，不存明文）
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

// ========== 登录（双兼容：优先比对哈希，兜底兼容明文，服务端不存明文） ==========
app.post("/api/login", function (req, res) {
  const username = req.body.username;
  const passwordHash = req.body.passwordHash || "";
  const plainPassword = req.body.password || "";

  const findUser = userList.find(function (u) {
    if (u.username !== username) return false;
    if (passwordHash) {
      return u.sha === passwordHash || u.fb === passwordHash;
    }
    if (plainPassword) {
      // 兜底：收到明文时即时哈希比对，不落盘不存库
      return u.sha === sha256(plainPassword) || u.fb === fbHash(plainPassword);
    }
    return false;
  });

  if (!findUser) {
    return res.json({ success: false });
  }
  const newToken = crypto.randomBytes(16).toString("hex");
  tokenMap[newToken] = findUser;
  res.json({ success: true, token: newToken, user: findUser });
});

// ========== 新增错题 ==========
app.post("/api/add", async function (req, res) {
  const question = req.body.question;
  const answer = req.body.answer;
  const token = req.body.token;
  const user = tokenMap[token];
  if (!user) {
    console.log("add接口：token无效");
    return res.json({ ok: false, needRelogin: true });
  }

  let clientIp = "unknown";
  let area = "未知地区";
  try {
    clientIp = getClientIp(req);
    area = await getIpArea(clientIp);
  } catch (e) {
    // IP 查询整体兜底，绝不阻断错题保存
    area = "未知地区";
  }

  try {
    const nowTime = getNowDateTime();
    const stmt = db.prepare(
      "INSERT INTO wrong_question(question, answer, subject, ip, area, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    stmt.run(question, answer, user.subject, clientIp, area, nowTime);
    console.log("错题保存成功：", question);
    return res.json({ ok: true });
  } catch (err) {
    console.error("数据库插入错题失败：", err);
    return res.json({ ok: false, error: String(err.message || err) });
  }
});

// ========== 查询错题（分页 + 筛选 + 只看自己账号） ==========
app.get("/api/list", function (req, res) {
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

  const whereParts = [" subject = ? "];
  const params = [user.subject];

  if (filterSubject) {
    whereParts.push(" subject = ? ");
    params.push(filterSubject);
  }
  if (filterStart) {
    whereParts.push(" created_at >= ? ");
    params.push(filterStart + " 00:00:00");
  }
  if (filterEnd) {
    whereParts.push(" created_at <= ? ");
    params.push(filterEnd + " 23:59:59");
  }

  const whereSql = " WHERE " + whereParts.join(" AND ");

  try {
    const countRow = db.prepare("SELECT COUNT(*) AS cnt FROM wrong_question " + whereSql).get(...params);
    const total = countRow.cnt;

    params.push(pageSize, offset);
    const list = db.prepare("SELECT * FROM wrong_question " + whereSql + " ORDER BY created_at DESC LIMIT ? OFFSET ?").all(...params);

    res.json({
      list: list,
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

// ========== 兜底1：/api 下未匹配的请求，返回 JSON 而不是网页 ==========
app.use("/api", function (req, res) {
  res.status(404).json({ ok: false, error: "接口不存在: " + req.method + " " + req.path });
});

// ========== 兜底2：任何接口抛异常，都返回 JSON 而不是 HTML 错误页 ==========
app.use(function (err, req, res, next) {
  console.error("接口异常：", err);
  res.status(500).json({ ok: false, error: String(err.message || err) });
});

app.listen(PORT, function () {
  console.log("网站本地运行在 http://localhost:" + PORT);
});
