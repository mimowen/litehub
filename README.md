# LiteHub — 轻量级 Agent 协作管道

> 让 AI Agent 通过命名队列传递数据，像水管一样简单。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/mimowen/litehub)

## 是什么

LiteHub 是一个**队列管道系统**，让分布式 AI Agent 通过 HTTP API 协作：

- **生产者（Producer）** 把数据写入命名队列
- **消费者（Consumer）** 从队列里拉取数据
- **管道（Pipe）** 消费 + 生产一步完成，自动携带溯源信息

没有中心大脑，没有消息队列的复杂度。只需一个 SQLite 数据库 + HTTP 接口。

```
🔍 搜索Agent  ──→  raw  ──→  📝 摘要Agent  ──→  summaries  ──→  🌐 翻译Agent  ──→  en  ──→  💬 通知Agent
```

## 核心特性

| 特性 | 说明 |
|------|------|
| **多生产者** | 多个 Agent 可同时向同一队列写入 |
| **多消费者** | 多个 Agent 可同时从同一队列消费，数据不重复（FIFO） |
| **管道链** | `pipe` 接口消费 + 生产一步完成，自动携带上游溯源 ID |
| **零 SDK** | 纯 HTTP，`curl` / `fetch` 即可接入 |
| **多平台** | Vercel + Turso / Cloudflare Workers + D1 / 本地 SQLite |
| **AI Ready** | `/skill` 端点可直接让 AI 下载接入指引 |

## 快速开始

### 本地开发

```bash
git clone https://github.com/mimowen/litehub
cd litehub
npm install
npm start          # → http://localhost:3000
```

### 在线演示

- **首页**: https://litehub-chi.vercel.app
- **Dashboard**: https://litehub-chi.vercel.app/dashboard

## 项目结构

```
litehub/
├── api/                          ← Vercel Serverless Functions
│   ├── _lib/turso.ts             #   Turso 数据库客户端（Vercel 用）
│   ├── agents.ts                 #   GET  /api/agents
│   ├── queues.ts                 #   GET  /api/queues
│   ├── peek.ts                   #   GET  /api/peek?queue=xxx
│   ├── dashboard.ts              #   GET  /dashboard
│   └── agent/
│       ├── register.ts           #   POST /api/agent/register
│       ├── produce.ts            #   POST /api/agent/produce
│       ├── consume.ts            #   POST /api/agent/consume
│       └── pipe.ts               #   POST /api/agent/pipe
├── src/                          ← 本地 / VPS / Docker 入口
│   ├── server.ts                 #   Node.js 启动文件
│   ├── app.ts                    #   Hono 应用入口
│   ├── lib/
│   │   ├── db.ts                 #   SQLite 初始化（better-sqlite3）
│   │   ├── queue.ts             #   队列核心逻辑
│   │   └── types.ts             #   类型定义
│   └── adapters/
│       ├── vercel.ts             #   Vercel 适配器（废弃，保留参考）
│       └── cf-workers.ts         #   Cloudflare Workers 适配器（保留参考）
├── index.html                    #   项目介绍首页
├── SKILL.md                      #   AI Agent 接入指南（/skill 端点）
├── Dockerfile
├── wrangler.toml
└── package.json
```

> **注意**：`src/` 目录下的文件用于本地/VPS/Docker 运行（依赖 better-sqlite3，原生模块无法在 Vercel serverless 中使用）。Vercel 部署使用 `api/` 目录下的独立函数文件。

## 部署

### Vercel（推荐，免费额度够用）

Vercel 版本使用 **Turso**（分布式 SQLite），数据持久在全球边缘节点。

```bash
# 1. 安装 Turso CLI 并创建数据库
curl -sSfL https://get.tur.so/install.sh | bash
turso db create litehub
turso db show litehub --url          # 复制这个 URL
turso db tokens create litehub        # 复制这个 Token

# 2. 在 Vercel 项目设置中添加环境变量
#    TURSO_URL        = <上面复制的 URL>
#    TURSO_AUTH_TOKEN = <上面复制的 Token>

# 3. 部署
npx vercel --prod
```

> Turso 免费额度：500 个数据库，9GB 存储，5GB 流量/月。

### Cloudflare Workers

```bash
npx wrangler d1 create litehub
# 把返回的 database_id 填入 wrangler.toml
npm run deploy:cf
```

### Docker / VPS / 本地

```bash
npm install
npm start

# 或使用 Docker
npm run deploy:docker
```

**Docker 数据持久化**：数据库文件存储在 Docker volume `litehub-data` 中。

## API 文档

基地址 `${LITEHUB_URL}`：
- 本地开发：`http://localhost:3000`
- Vercel 示例：`https://litehub-chi.vercel.app`

### 注册 Agent

```bash
curl -X POST ${LITEHUB_URL}/api/agent/register \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "searcher",
    "name": "搜索Agent",
    "role": "producer",
    "queues": ["raw"]
  }'
```

**参数说明**：
- `agentId`：Agent 唯一标识（重名会更新）
- `name`：人类可读名称
- `role`：`"producer"` / `"consumer"` / `"both"`
- `queues`：该 Agent 关联的队列名称列表

---

### 生产数据

```bash
curl -X POST ${LITEHUB_URL}/api/agent/produce \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "searcher",
    "queue": "raw",
    "data": "北京今天天气晴朗，气温25度",
    "metadata": { "source": "web-search" }
  }'
```

**返回**：
```json
{
  "ok": true,
  "pointer": {
    "id": "uuid-xxx",
    "queue": "raw",
    "size": 26,
    "producerId": "searcher",
    "createdAt": "2026-04-23T..."
  }
}
```

---

### 消费数据

```bash
curl -X POST ${LITEHUB_URL}/api/agent/consume \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "summarizer",
    "queue": "raw",
    "maxItems": 1
  }'
```

**返回**：
```json
{
  "ok": true,
  "items": [{
    "pointer": { "id": "uuid-xxx", "queue": "raw", "producerId": "searcher", ... },
    "data": "QmFzZTY0IGVuY29kZWQg...",
    "text": "北京今天天气晴朗，气温25度"
  }]
}
```

---

### 管道（消费 + 生产一步完成）

```bash
curl -X POST ${LITEHUB_URL}/api/agent/pipe \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "summarizer",
    "sourceQueue": "raw",
    "targetQueue": "summaries",
    "data": "北京今日天气晴朗，适合出行。"
  }'
```

输出的数据会自动携带 `sourcePointerId` 和 `sourceQueue`，支持全链路溯源。

---

### 查询接口

```bash
# 列出所有 Agent
curl ${LITEHUB_URL}/api/agents

# 列出所有队列（含 pending / consumed 计数）
curl ${LITEHUB_URL}/api/queues

# 预览队首（不消费）
curl "${LITEHUB_URL}/api/peek?queue=raw"
```

### 完整 API 列表

| 方法 | 端点 | 说明 |
|------|------|------|
| `POST` | `/api/agent/register` | 注册 Agent |
| `POST` | `/api/agent/produce` | 生产数据到队列 |
| `POST` | `/api/agent/consume` | 消费数据（FIFO） |
| `POST` | `/api/agent/pipe` | 消费 + 生产一步完成 |
| `GET` | `/api/agents` | 列出所有 Agent |
| `GET` | `/api/queues` | 列出所有队列及统计 |
| `GET` | `/api/peek?queue=name` | 预览队首（不消费） |
| `GET` | `/dashboard` | 交互式 Dashboard |

## 多生产者 / 多消费者

LiteHub **天然支持多生产者 + 多消费者共享同一队列**：

- **多生产者**：各自独立写入同一队列，无冲突
- **多消费者**：FIFO 顺序，各自从队列取下一条数据，不重复消费
- **无需额外配置**：直接注册、直接使用

```
Producer A ──→ [A1] [A2] [A3]
Producer B ──→ [B1] [B2] [B3]
                          ↓
Consumer X ──→ [A1] [A2] [B1] [B2]   (4条)
Consumer Y ──→ [A3] [B3]              (2条)
```

## AI Agent 接入

让 AI 直接访问 `/skill` 端点即可获得完整接入指南：

```
GET ${LITEHUB_URL}/skill
```

返回 SKILL.md 内容，包含所有 API 的 curl 示例和常见使用模式（轮询循环、管道链、FAN-OUT 等）。AI 无需安装任何 SDK，直接通过 HTTP 协作。

## 扩展方向

- [ ] **被动通知** — Consumer 回调 URL（webhook），有数据时主动推送
- [ ] **SSE** — Server-Sent Events 实时推送
- [ ] **死信队列** — 消费失败的消息进入 DLQ
- [ ] **消息重试 / TTL** — 设定消息过期时间
- [ ] **优先级队列** — 按优先级而非 FIFO 顺序
- [ ] **认证层** — JWT / API Key

## 许可证

MIT · [GitHub](https://github.com/mimowen/litehub)
