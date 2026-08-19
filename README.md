# 永嘉山早村·溯溪桨板2日营 · 领队行程可编辑地图

**方案三：全栈实时同步版**（Node.js 后端 + 前端地图 + 领队编辑 + 队员轮询同步）

> 已修复原计划两处隐患：① 领队密码改为**服务端 scrypt 哈希 + 环境变量**，不再明文 `123456`；② 明确**对外发布前必须走 HTTPS**（见下方部署说明）。

---

## 一、目录结构

```
山早村/
├── server.js                # 纯 Node.js 后端（零第三方依赖，仅用内置 http/crypto/fs）
├── package.json             # 启动脚本：npm start
├── data/
│   └── nodes.json           # 行程数据持久化（标题/副标题/统计/节点数组）
├── public/                  # 前端静态文件（由 server.js 托管）
│   ├── index.html           # 主应用：地图 + 时间轴 + 领队编辑模式
│   └── trip-map.html        # 成员纯地图视图（无编辑，可单独分享）
├── index.legacy.html        # 改造前的旧版静态页（备份，可删）
└── README.md
```

## 二、本地运行

```bash
# 一行启动（默认端口 3000）
node server.js
# 或
npm start

# 自定义端口与领队密码（推荐）
PORT=3000 LEADER_PASSWORD=你的强密码 node server.js
```

浏览器打开 `http://localhost:3000` 即可。

- 队员视图：直接浏览，自动每 15 秒轮询同步领队最新修改。
- 领队模式：双击左侧标题栏（或后续可加按钮）→ 输入密码解锁 → 出现顶部编辑栏。
  - `➕ 添加节点`：开启后点击地图任意位置弹出表单。
  - 拖动地图 Marker 可改坐标（松开即更新，需保存）。
  - 卡片上 `✏️编辑 / ⬆️上移 / ⬇️下移 / 🗑️删除`。
  - `💾 保存并发布`：写入后端并同步给所有在线队员。

## 三、环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | 监听端口 | `3000` |
| `LEADER_PASSWORD` | 领队登录密码（服务端哈希校验，**绝不落明文**） | `change-me-please`（仅本地测试） |

## 四、API

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/nodes` | 公开 | 读取行程数据 |
| POST | `/api/login` | 密码 | 校验密码，返回 `token` |
| POST | `/api/nodes` | Bearer `token` | 保存行程（覆盖 `data/nodes.json`） |

> 会话 `token` 存于服务端内存，服务重启后需重新登录。单领队模型，最后写入者生效。

## 五、部署到你的云服务器（HTTP 测试 / HTTPS 正式）

### 方式 A：直接 Node 运行（测试期，HTTP）
1. 把整个目录上传到服务器（如 `/opt/tripmap`）。
2. 安装 Node.js ≥ 16（无需 `npm install`，零依赖）。
3. 启动：`PORT=3000 LEADER_PASSWORD=强密码 node server.js`。
4. 用进程守护（推荐 `pm2`）：`npm i -g pm2 && pm2 start server.js --name tripmap`。
5. 防火墙放行对应端口，访问 `http://服务器IP:端口`。

### 方式 B：正式对外（必须 HTTPS）
- 在服务器前置 **nginx** 反代 + 免费 SSL 证书（Let's Encrypt / 云厂商证书），Node 仅监听内网端口（如 `127.0.0.1:3000`）。
- 给队员的链接用 **HTTPS 域名**，密码登录才不会在传输中被截获。
- 当前 Node 直接监听公网端口 + HTTP 仅限内测，正式 20 人使用前务必补 HTTPS。

示例 nginx 片段：
```nginx
server {
  listen 443 ssl;
  server_name trip.yourdomain.com;
  ssl_certificate     /path/fullchain.pem;
  ssl_certificate_key /path/privkey.pem;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

## 六、安全说明
- 领队密码**仅经环境变量传入，服务端 scrypt 哈希比对**，不会写入文件或前端。
- 写接口需 Bearer token，未授权返回 401。
- 对外发布前请务必通过 HTTPS，否则密码存在传输泄露风险。
- `data/nodes.json` 含全部行程信息，属业务数据，请妥善备份、勿公开下载。

## 七、已知取舍
- 采用 15 秒轮询（非 WebSocket），对 20 人规模足够，实现简单零依赖。
- 单领队写入模型，多领队同时编辑为「最后写入生效」，无冲突合并。
- 地图底图使用高德切片（GCJ-02 坐标），符合国内地图合规要求。
