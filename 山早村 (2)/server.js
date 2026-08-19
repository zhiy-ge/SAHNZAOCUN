'use strict';
/*
 * 永嘉山早村·溯溪桨板2日营 — 领队行程可编辑地图（方案三·全栈实时同步版）
 * 纯 Node.js 实现，零第三方依赖（仅用内置 http / crypto / fs / path）。
 * 运行： node server.js   （可选环境变量见 README）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'nodes.json');

const PORT = parseInt(process.env.PORT || '3000', 10);
// 领队密码：默认 lanlan；部署时可通过环境变量 LEADER_PASSWORD 覆盖
const LEADER_PASSWORD = process.env.LEADER_PASSWORD || 'lanlan';

/* ---------- 密码哈希（scrypt，进程内随机 salt，仅运行时比对用） ---------- */
const SALT = crypto.randomBytes(16);
function hashPassword(pw) {
  return crypto.scryptSync(String(pw), SALT, 64).toString('hex');
}
const STORED_HASH = hashPassword(LEADER_PASSWORD);

// 登录会话 token（内存态，重启即失效，领队需重新登录）
const sessions = new Map(); // token -> true

function login(pw) {
  if (!pw) return null;
  const attempt = hashPassword(pw);
  const a = Buffer.from(attempt, 'hex');
  const b = Buffer.from(STORED_HASH, 'hex');
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now());
  return token;
}
function isAuthed(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return !!(m && sessions.has(m[1]));
}

/* ---------- 数据读写 ---------- */
function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}
function writeData(obj) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
}

/* ---------- 静态文件 MIME ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/* ---------- 主服务 ---------- */
const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (e) {
    res.writeHead(400);
    return res.end('Bad request');
  }
  const pathname = decodeURIComponent(url.pathname);

  /* ---- API: 读取行程（公开） ---- */
  if (pathname === '/api/nodes' && req.method === 'GET') {
    const data = readData();
    if (!data) return sendJson(res, 500, { error: '数据文件缺失' });
    return sendJson(res, 200, data);
  }

  /* ---- API: 领队登录 ---- */
  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const token = login(body && body.password);
      if (!token) return sendJson(res, 401, { error: '密码错误' });
      return sendJson(res, 200, { token });
    } catch (e) {
      return sendJson(res, 400, { error: '请求格式错误' });
    }
  }

  /* ---- API: 保存行程（需鉴权） ---- */
  if (pathname === '/api/nodes' && req.method === 'POST') {
    if (!isAuthed(req)) return sendJson(res, 401, { error: '未授权，请先登录' });
    try {
      const obj = await readBody(req);
      // 支持 groups 结构（一团/二团）与旧版顶层 nodes 结构
      const isGroups = obj && obj.groups && typeof obj.groups === 'object';
      const isNodes = obj && Array.isArray(obj.nodes);
      if (!isGroups && !isNodes) {
        return sendJson(res, 400, { error: '数据格式错误：缺少 groups 或 nodes' });
      }
      obj.updatedAt = Date.now();
      writeData(obj);
      return sendJson(res, 200, { ok: true, updatedAt: obj.updatedAt });
    } catch (e) {
      return sendJson(res, 400, { error: '请求格式错误' });
    }
  }

  /* ---- 静态文件（仅限 public/ 内，防穿越） ---- */
  let rel = pathname === '/' ? '/index.html' : pathname;
  const safe = path.normalize(path.join(PUBLIC_DIR, rel));
  if (safe !== PUBLIC_DIR && !safe.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(safe, (err, content) => {
    if (err) {
      // SPA 兜底：找不到时回退首页
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, c2) => {
        if (e2) {
          res.writeHead(404);
          return res.end('Not found');
        }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(c2);
      });
      return;
    }
    const ext = path.extname(safe).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`✅ 行程地图服务已启动: http://localhost:${PORT}`);
  if (LEADER_PASSWORD === 'change-me-please') {
    console.log('⚠️  当前使用默认领队密码，部署前请设置环境变量 LEADER_PASSWORD');
  }
});
