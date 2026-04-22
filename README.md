# LiteHub — 轻量级 Agent 协作枢纽

> 数据像水流一样，在 Agent 之间通过队列管道传递。

## 为什么选 Hono + SQLite

| | Next.js + 文件系统 | Hono + SQLite |
|--|-------------------|---------------|
| Vercel | ✅ 但数据临时 | ✅ SQLite 持久 |
| Cloudflare Workers | ❌ 不支持 | ✅ + D1 |
| 普通 VPS / Docker | ✅ | ✅ |
| 冷启动 | ~100ms | < 5ms (边缘) |
| 体积 | 87KB+ | 14KB |
| 数据持久 | ❌ | ✅ |

## 快速开始

```bash
# 安装依赖
bun install

# 开发模式
bun run dev

# 访问 http://localhost:3000
```

## 部署

### 1. VPS / 本地（直接运行）
```bash
npm install
npm run start
# 或
npm run dev   # 开发模式，文件改动自动重启
```

### 2. Docker
```bash
npm run deploy:docker
# 或手动：
docker build -t litehub .
docker run -d -p 3000:3000 -v litehub-data:/app/data litehub
```
数据库持久化在 Docker volume `litehub-data` 中。

### 3. Vercel (Serverless)
```bash
npm run deploy:vercel
# 或手动：
npx vercel --prod
```
Vercel 会自动识别 `api/[[...route]].ts` 作为 Serverless Function。
> 注意：Vercel Serverless 没有持久文件系统，SQLite 数据在冷启动后丢失。
> 生产环境建议换 Turso (libsql) 作为数据库。

### 4. Cloudflare Workers (Edge)
```bash
# 1. 创建 D1 数据库
npx wrangler d1 create litehub
# 2. 把返回的 database_id 填入 wrangler.toml
# 3. 部署
npm run deploy:cf
```
CF Workers 版本使用 D1 数据库替代 better-sqlite3，数据持久化在 Cloudflare 边缘。

### 平台对比

| 平台 | 运行时 | 数据库 | 数据持久 | 冷启动 | 部署命令 |
|------|--------|--------|---------|--------|----------|
| VPS / Docker | Node/Bun | SQLite | ✅ | N/A | `npm start` |
| Vercel | Node.js | SQLite | ⚠️ 临时 | ~100ms | `npm run deploy:vercel` |
| CF Workers | V8 | D1 | ✅ | < 5ms | `npm run deploy:cf` |

## API 速查

### 注册 Agent
```bash
curl -X POST http://localhost:3000/api/agent/register \
  -H "Content-Type: application/json" \
  -d '{"agentId":"searcher","name":"搜索Agent","role":"producer","queues":["results"]}'
```

### 生产数据
```bash
curl -X POST http://localhost:3000/api/agent/produce \
  -H "Content-Type: application/json" \
  -d '{"agentId":"searcher","queue":"results","data":"北京今天天气晴朗"}'
```

### 消费数据
```bash
curl -X POST http://localhost:3000/api/agent/consume \
  -H "Content-Type: application/json" \
  -d '{"agentId":"summarizer","queue":"results"}'
```

### 链式传递（消费 + 生产一步完成）
```bash
curl -X POST http://localhost:3000/api/agent/pipe \
  -H "Content-Type: application/json" \
  -d '{"agentId":"summarizer","sourceQueue":"results","targetQueue":"summaries","data":"摘要：北京今天天气很好"}'
```

### 查看队列 / Agent
```bash
curl http://localhost:3000/api/queues
curl http://localhost:3000/api/agents
curl "http://localhost:3000/api/peek?queue=results"
```

## 架构

```
┌──────────────────────────────────────┐
│         Hono (14KB Web Framework)     │
│    跑在 Bun / Node / CF Workers 上    │
├──────────────────────────────────────┤
│  POST /api/agent/register             │
│  POST /api/agent/produce              │
│  POST /api/agent/consume              │
│  POST /api/agent/pipe                 │
│  GET  /api/queues                     │
│  GET  /api/agents                     │
│  GET  /api/peek?queue=name            │
│  GET  /   → Dashboard HTML            │
└──────────────┬───────────────────────┘
               │
               ▼
     ┌─────────────────────┐
     │   SQLite (litehub.db)  │  ← 单文件数据库
     │   ├── pointers 表       │  ← 数据 + 指针
     │   ├── queues 表         │  ← 队列元数据
     │   └── agents 表         │  ← Agent 注册表
     └─────────────────────┘
```

## 数据流

```
场景：搜索 → 摘要 → 翻译 → 推送

1. Agent A → produce("raw-pages", "HTML内容...")
2. Agent B → consume("raw-pages") → pipe → produce("summaries", "摘要...")
3. Agent C → consume("summaries") → pipe → produce("translations", "Summary...")
4. Agent D → consume("translations") → 推送到钉钉/Slack
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | 3000 |
| `LITEHUB_DB` | SQLite 数据库路径 | `./litehub.db` |

## 扩展方向

- [ ] Turso (libsql) 适配 — 替换 better-sqlite3 即可部署到 CF Workers
- [ ] SSE 推送 — 消费者实时通知
- [ ] 死信队列 — 处理失败消息
- [ ] 消息重试 / TTL
- [ ] 优先级队列
- [ ] 多节点同步 — Turso 分布式复制
