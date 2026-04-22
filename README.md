# LiteHub — 轻量级 Agent 协作枢纽

> 数据像水流一样，在 Agent 之间通过队列管道传递。

## 为什么选 Hono + SQLite

| | Next.js + 文件系统 | Hono + SQLite |
|--|-------------------|---------------|
| Vercel | ⚠️ 数据临时 | ✅ Turso 持久 |
| Cloudflare Workers | ❌ 不支持 | ✅ + D1 |
| 普通 VPS / Docker | ✅ | ✅ |
| 冷启动 | ~100ms | < 5ms (边缘) |
| 体积 | 87KB+ | 14KB |

## 项目结构

```
litehub/
├── src/
│   ├── index.ts              # 主 Hono app（本地 / VPS / Docker 使用）
│   ├── server.ts             # Node.js 启动入口
│   ├── lib/
│   │   ├── db.ts             # SQLite 初始化（better-sqlite3）
│   │   ├── queue.ts          # 队列核心逻辑
│   │   └── types.ts          # TypeScript 类型定义
│   └── adapters/
│       ├── vercel.ts         # Vercel 适配器（Turso / libsql）
│       └── cf-workers.ts     # Cloudflare Workers 适配器（D1）
├── api/
│   └── [[...route]].ts       # Vercel Serverless Function 入口
├── Dockerfile
├── wrangler.toml
├── SKILL.md                  # AI Agent 技能文件
└── package.json
```

每个平台有独立的适配器文件，使用各自的数据库后端，共享同一套 API 设计。

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（自动重启）
npm run dev

# 生产运行
npm start

# 访问 http://localhost:3000
```

## 部署

### 1. VPS / Docker（推荐，最简单）

**直接运行：**
```bash
npm install
npm start
```

**Docker：**
```bash
npm run deploy:docker
# 或手动：
docker build -t litehub .
docker run -d -p 3000:3000 -v litehub-data:/app/data litehub
```

数据库持久化在 Docker volume `litehub-data` 中。本地运行则生成 `litehub.db` 文件。

### 2. Vercel（Turso 数据库）

Vercel 版本使用 **Turso**（分布式 SQLite）替代 better-sqlite3，数据持久且全球边缘分布。

```bash
# 1. 安装 Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# 2. 创建数据库
turso db create litehub
turso db show litehub --url        # 记下这个 URL
turso db tokens create litehub     # 记下这个 Token

# 3. 在 Vercel 控制台设置环境变量
#    TURSO_URL        = 上面的 URL
#    TURSO_AUTH_TOKEN = 上面的 Token

# 4. 部署
npx vercel --prod
```

> ⚠️ Vercel Serverless 没有持久文件系统，本地版的 better-sqlite3 无法使用。
> 所以 Vercel 版本是独立的适配器（`src/adapters/vercel.ts`），使用 `@libsql/client` 连接 Turso。

### 3. Cloudflare Workers（D1 数据库）

```bash
# 1. 创建 D1 数据库
npx wrangler d1 create litehub
# 把返回的 database_id 填入 wrangler.toml

# 2. 部署
npm run deploy:cf
```

CF Workers 版本使用 D1 数据库（`src/adapters/cf-workers.ts`），数据持久在 Cloudflare 边缘。

### 平台对比

| 平台 | 运行时 | 数据库 | 数据持久 | 冷启动 | 入口文件 | 部署命令 |
|------|--------|--------|---------|--------|----------|----------|
| VPS / Docker | Node / Bun | SQLite (本地文件) | ✅ | N/A | `src/server.ts` → `src/index.ts` | `npm start` |
| Vercel | Node.js Serverless | Turso (libsql) | ✅ | ~100ms | `api/[[...route]].ts` → `src/adapters/vercel.ts` | `npx vercel --prod` |
| CF Workers | V8 Isolate | Cloudflare D1 | ✅ | < 5ms | `wrangler.toml` → `src/adapters/cf-workers.ts` | `npm run deploy:cf` |

## API 速查

所有平台共享相同的 API 接口，只是基地址不同。

### 注册 Agent
```bash
curl -X POST ${LITEHUB_URL}/api/agent/register \
  -H "Content-Type: application/json" \
  -d '{"agentId":"searcher","name":"搜索Agent","role":"producer","queues":["results"]}'
```

### 生产数据
```bash
curl -X POST ${LITEHUB_URL}/api/agent/produce \
  -H "Content-Type: application/json" \
  -d '{"agentId":"searcher","queue":"results","data":"北京今天天气晴朗"}'
```

### 消费数据
```bash
curl -X POST ${LITEHUB_URL}/api/agent/consume \
  -H "Content-Type: application/json" \
  -d '{"agentId":"summarizer","queue":"results"}'
```

### 链式传递（消费 + 生产一步完成）
```bash
curl -X POST ${LITEHUB_URL}/api/agent/pipe \
  -H "Content-Type: application/json" \
  -d '{"agentId":"summarizer","sourceQueue":"results","targetQueue":"summaries","data":"摘要：北京今天天气很好"}'
```

### 查看队列 / Agent
```bash
curl ${LITEHUB_URL}/api/queues
curl ${LITEHUB_URL}/api/agents
curl "${LITEHUB_URL}/api/peek?queue=results"
```

### API 完整列表

| 方法 | 端点 | 说明 |
|------|------|------|
| `POST` | `/api/agent/register` | 注册 Agent |
| `POST` | `/api/agent/produce` | 推送数据到队列 |
| `POST` | `/api/agent/consume` | 从队列拉取数据 |
| `POST` | `/api/agent/pipe` | 消费 + 生产（一步完成） |
| `GET` | `/api/agents` | 列出所有 Agent |
| `GET` | `/api/queues` | 列出所有队列及统计 |
| `GET` | `/api/peek?queue=name` | 预览队首（不消费） |
| `GET` | `/` | 项目介绍页 |
| `GET` | `/dashboard` | 运行状态看板 |
| `GET` | `/skill` | AI Agent 技能文件 |

## 架构

```
                    ┌──────────────────────┐
                    │    Hono (14KB Core)  │
                    │    HTTP 路由 + 中间件  │
                    └──────────┬───────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
   ┌──────▼──────┐     ┌──────▼──────┐    ┌───────▼──────┐
   │ src/index.ts│     │  Vercel 适配器 │    │  CF Workers  │
   │ (本地/VPS)  │     │   Turso/libsql │    │  D1 数据库    │
   └──────┬──────┘     └─────────────┘    └──────────────┘
          │
   ┌──────▼──────┐
   │ better-     │
   │ sqlite3     │
   │ (本地文件)   │
   └─────────────┘

   数据库表（三个平台统一）：
   ├── pointers   ← 数据 + 状态 + 元数据
   ├── queues     ← 队列元信息
   └── agents     ← Agent 注册表
```

## 数据流

```
场景：搜索 → 摘要 → 翻译 → 推送

1. Agent A → produce("raw-pages", "HTML内容...")
2. Agent B → pipe("raw-pages" → "summaries", "摘要...")
3. Agent C → pipe("summaries" → "translations", "Summary...")
4. Agent D → consume("translations") → 推送到钉钉/Slack
```

`pipe` 操作自动在输出数据的 metadata 中记录 `sourcePointerId` 和 `sourceQueue`，支持全链路溯源。

## AI Agent 技能

LiteHub 提供 `/skill` 端点，任何 AI Agent 都可以下载 `SKILL.md` 来快速接入：

```
GET ${LITEHUB_URL}/skill
```

技能文件告诉 AI 如何通过简单 HTTP 调用注册、生产、消费和传递数据。无需 SDK，只需 `curl` 或 `fetch`。

## 环境变量

| 变量 | 说明 | 平台 | 默认值 |
|------|------|------|--------|
| `PORT` | 服务端口 | 本地 / VPS | `3000` |
| `LITEHUB_DB` | SQLite 文件路径 | 本地 / VPS | `./litehub.db` |
| `TURSO_URL` | Turso 数据库 URL | Vercel | — |
| `TURSO_DATABASE_URL` | Turso URL（别名） | Vercel | — |
| `TURSO_AUTH_TOKEN` | Turso 访问令牌 | Vercel | — |

## 扩展方向

- [ ] SSE 推送 — 消费者实时通知
- [ ] 死信队列 — 处理失败消息
- [ ] 消息重试 / TTL
- [ ] 优先级队列
- [ ] Auth 层 — JWT / API Key
- [ ] Web UI — 实时 Dashboard（目前是静态 HTML）
