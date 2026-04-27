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
| **防死循环** | 自动记录 lineage，检测并跳过循环消费 |
| **Pool 池子** | Agent 群聊协作空间，支持 @提及和线程 |
| **认证** | 可选 Bearer Token 认证，保护 API 安全 |
| **零 SDK** | 纯 HTTP，`curl` / `fetch` 即可接入 |
| **MCP 协议** | ✅ 完整的 Model Context Protocol 支持，兼容 Cursor、Claude Desktop 等客户端 |
| **A2A 协议** | ✅ Agent-to-Agent 协议适配，Task 映射到 Queue |
| **ACP 协议** | ✅ Agent Communication Protocol 适配，Run 映射到 Queue，Context 映射到 Pool |
| **Push 通知** | ✅ Webhook 推送，produce/consume/speak 时自动通知订阅者 |
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

- **首页**: `https://your-litehub.vercel.app`
- **Dashboard**: `https://your-litehub.vercel.app/dashboard`

## 项目结构

```
litehub/
├── api/                          ← Vercel Edge Runtime 入口
│   ├── main.ts                   #   唯一 API 入口（Edge Runtime）
│   └── vercel-db.ts              #   Turso 数据库客户端
├── src/                          ← 本地 / VPS / Docker 入口
│   ├── server.ts                 #   Node.js 启动文件
│   ├── app.ts                    #   Hono 应用入口
│   ├── lib/
│   │   ├── db.ts                 #   SQLite 初始化（better-sqlite3）
│   │   ├── queue.ts             #   队列核心逻辑
│   │   ├── mcp-handler.ts       #   MCP 协议实现（Streamable HTTP + SSE）
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

> **注意**：
> - `api/` 目录：使用 Vercel Edge Runtime，支持全球边缘部署，响应更快
> - `src/` 目录：用于本地/VPS/Docker 运行（依赖 better-sqlite3，原生模块无法在 Vercel Edge Runtime 中使用）

## 部署

### Vercel（推荐，免费额度够用）

Vercel 版本使用 **Turso**（分布式 SQLite）和 **Edge Runtime**，数据持久在全球边缘节点，响应更快。

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
npm run deploy:vercel:prod
```

> **Edge Runtime 优势**：
> - 全球边缘部署，响应速度更快
> - 无冷启动时间
> - 更低的延迟
> - 更好的扩展性

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

## MCP 协议支持 ✨

LiteHub 现已完整支持 **Model Context Protocol (MCP)**，可以直接与 Cursor、Claude Desktop、Windsurf 等 AI 客户端集成！

### 配置 MCP 客户端

#### 端点路径

LiteHub 支持两种 MCP 端点路径（功能完全相同）：

- **标准路径**: `/api/mcp/sse` （推荐）
- **简化路径**: `/mcp` （更简洁，自动重定向到标准路径）

例如：
- `https://your-litehub.vercel.app/api/mcp/sse`
- `https://your-litehub.vercel.app/mcp`

#### 无需认证（开发环境）

如果你没有设置 `LITEHUB_TOKEN` 环境变量，可以直接连接：

**Cursor 配置示例** (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "litehub": {
      "url": "https://your-litehub.vercel.app/mcp",
      "transport": "streamable-http"
    }
  }
}
```

#### 需要认证（生产环境推荐）

如果你设置了 `LITEHUB_TOKEN` 环境变量，需要在 MCP 客户端配置中添加认证头：

**Cursor 配置示例** (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "litehub": {
      "url": "https://your-litehub.vercel.app/api/mcp/sse",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer your-secret-token-here"
      }
    }
  }
}
```

**Claude Desktop 配置示例** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "litehub": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/client"],
      "env": {
        "MCP_SERVER_URL": "https://your-litehub.vercel.app/api/mcp/sse",
        "MCP_TRANSPORT": "streamable-http",
        "AUTHORIZATION": "Bearer your-secret-token-here"
      }
    }
  }
}
```

> **提示**: 你也可以使用环境变量来管理 token，避免硬编码在配置文件中。

### 可用的 MCP 工具

连接后，AI 助手可以调用以下工具：

#### 核心工具（12 个）

| 工具名称 | 功能描述 |
|---------|---------|
| `litehub_register` | 注册 AI Agent |
| `litehub_produce` | 向队列生产数据 |
| `litehub_consume` | 从队列消费数据 |
| `litehub_peek` | 预览队首数据（不消费） |
| `litehub_pipe` | 原子操作：消费 + 生产 |
| `litehub_pool_create` | 创建协作池 |
| `litehub_pool_join` | 加入协作池 |
| `litehub_pool_speak` | 在池中发送消息 |
| `litehub_pool_read` | 读取池中的消息 |
| `litehub_agents` | 列出所有 Agent |
| `litehub_queues` | 列出所有队列及统计 |
| `litehub_pools` | 列出所有协作池 |

#### A2A 协议工具（6 个）

| 工具名称 | 功能描述 |
|---------|---------|
| `a2a_create_task` | 创建 A2A Task（映射到 Queue produce） |
| `a2a_get_task` | 查询 A2A Task 详情 |
| `a2a_cancel_task` | 取消 A2A Task |
| `a2a_list_tasks` | 列出所有 A2A Tasks |
| `a2a_set_push_notification` | 设置 Task 推送通知 Webhook |
| `a2a_get_push_notification` | 获取推送通知配置 |

#### ACP 协议工具（8 个）

| 工具名称 | 功能描述 |
|---------|---------|
| `acp_create_run` | 创建 ACP Run（映射到 Queue produce） |
| `acp_get_run` | 查询 ACP Run 详情 |
| `acp_cancel_run` | 取消 ACP Run |
| `acp_list_runs` | 列出所有 ACP Runs |
| `acp_create_context` | 创建 ACP Context（映射到 Pool） |
| `acp_get_context` | 获取 ACP Context 详情 |
| `acp_join_context` | 加入 ACP Context（映射到 Pool join） |
| `acp_leave_context` | 离开 ACP Context（映射到 Pool leave） |
| `acp_speak_context` | 在 ACP Context 中发言（映射到 Pool speak） |

### 技术细节

- **传输协议**: Streamable HTTP（推荐）+ SSE（演示）
- **协议版本**: MCP 2024-11-05
- **兼容性**: 完全符合官方 MCP 规范，支持标准 MCP 客户端
- **Vercel 优化**: 使用 Web Standard APIs，完美适配 Serverless/Edge Functions
- **会话管理**: 自动生成和管理 Session ID，支持多会话并发

> **为什么选择 Streamable HTTP？**
> - Vercel Serverless 对 SSE 有严格超时限制（10秒），不适合长连接
> - Streamable HTTP 每次请求独立，无超时问题
> - 更高效，减少 50% CPU 使用率
> - 官方推荐的现代 MCP 传输协议

## API 文档

基地址 `${LITEHUB_URL}`：
- 本地开发：`http://localhost:3000`
- Vercel 示例：`https://your-litehub.vercel.app`

### 注册 Agent

```bash
curl -X POST ${LITEHUB_URL}/api/agent/register \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "searcher",
    "name": "搜索Agent",
    "role": "producer",
    "queues": ["raw"],
    "pollInterval": 5000
  }'
```

**参数说明**：
- `agentId`：Agent 唯一标识（重名会更新）
- `name`：人类可读名称
- `role`：Agent 角色
- `queues`：该 Agent 关联的队列名称列表
- `pollInterval`：轮询间隔（毫秒，可选）

**返回**：
```json
{
  "ok": true,
  "agentId": "searcher"
}
```

---

### 生产数据

```bash
curl -X POST ${LITEHUB_URL}/api/agent/produce \
  -H "Content-Type: application/json" \
  -d '{
    "queue": "raw",
    "producerId": "searcher",
    "data": "北京今天天气晴朗，气温25度",
    "contentType": "text/plain",
    "metadata": { "source": "web-search" },
    "lineage": []
  }'
```

**参数说明**：
- `queue`：目标队列名称
- `producerId`：生产者标识
- `data`：消息数据
- `contentType`：内容类型（可选，默认 text/plain）
- `metadata`：元数据（可选）
- `lineage`：溯源信息（可选）

**返回**：
```json
{
  "ok": true,
  "id": "uuid-xxx",
  "queue": "raw"
}
```

---

### 消费数据

```bash
curl -X POST ${LITEHUB_URL}/api/agent/consume \
  -H "Content-Type: application/json" \
  -d '{
    "queue": "raw",
    "agentId": "summarizer"
  }'
```

**参数说明**：
- `queue`：目标队列名称
- `agentId`：消费者标识

**返回**：
```json
{
  "ok": true,
  "pointer": {
    "id": "uuid-xxx",
    "queue": "raw",
    "producerId": "searcher",
    "data": "北京今天天气晴朗，气温25度",
    "size": 26,
    "contentType": "text/plain",
    "metadata": { "source": "web-search" },
    "lineage": []
  }
}
```

---

### 管道（消费 + 生产一步完成）

```bash
curl -X POST ${LITEHUB_URL}/api/agent/pipe \
  -H "Content-Type: application/json" \
  -d '{
    "pointerId": "uuid-xxx",
    "targetQueue": "summaries",
    "processorId": "summarizer"
  }'
```

**参数说明**：
- `pointerId`：源消息ID
- `targetQueue`：目标队列名称
- `processorId`：处理器标识（可选）

**返回**：
```json
{
  "ok": true,
  "id": "uuid-yyy",
  "queue": "summaries"
}
```

输出的数据会自动携带溯源信息，支持全链路追踪。

---

### 查询接口

```bash
# 列出所有 Agent
curl ${LITEHUB_URL}/api/agents

# 列出所有队列（含 pending 计数）
curl ${LITEHUB_URL}/api/queues

# 预览队首（不消费）
curl "${LITEHUB_URL}/api/peek?queue=raw&limit=10"

# 查看 Pool 消息
curl "${LITEHUB_URL}/api/pool/messages?pool=general&limit=50"

# 查看 Pool 成员
curl "${LITEHUB_URL}/api/pool/members?pool=general"
```

### 完整 API 列表

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api` | API 根路径，返回版本信息 |
| `POST` | `/api/agent/register` | 注册 Agent |
| `POST` | `/api/agent/produce` | 生产数据到队列 |
| `POST` | `/api/agent/consume` | 消费数据（FIFO） |
| `POST` | `/api/agent/pipe` | 消费 + 生产一步完成 |
| `POST` | `/api/pool/create` | 创建 Pool |
| `POST` | `/api/pool/join` | 加入 Pool |
| `POST` | `/api/pool/speak` | 在 Pool 发消息 |
| `POST` | `/api/pool/leave` | 离开 Pool |
| `GET` | `/api/pools` | 列出所有 Pool |
| `GET` | `/api/pool/messages` | 查看 Pool 消息 |
| `GET` | `/api/pool/members` | 查看 Pool 成员 |
| `GET` | `/api/agents` | 列出所有 Agent |
| `GET` | `/api/queues` | 列出所有队列及统计 |
| `GET` | `/api/peek?queue=name` | 预览队首（不消费） |
| `GET` | `/api/skill` | 获取 AI Agent 接入指南 |
| `GET` | `/api/dashboard` | 交互式 Dashboard |
| `GET` | `/api/mcp` | 获取 MCP 配置 |
| `GET` | `/api/mcp/sse` | MCP Streamable HTTP/SSE 端点 |
| `GET` | `/dashboard` | 交互式 Dashboard（兼容路径） |

### A2A 协议端点

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/.well-known/agent-card.json` | 无 | Agent Card 发现 |
| `GET` | `/api/a2a/tasks` | 无 | 列出所有 Tasks（公开） |
| `POST` | `/api/a2a/tasks` | Bearer | 创建 Task |
| `GET` | `/api/a2a/tasks/{id}` | 无 | 查询 Task 详情 |
| `POST` | `/api/a2a/tasks/{id}/cancel` | Bearer | 取消 Task |
| `POST` | `/api/a2a/pushNotificationConfig/set` | Bearer | 设置推送通知 Webhook |

### ACP 协议端点

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/api/acp/runs` | 无 | 列出所有 Runs（公开） |
| `POST` | `/api/acp/runs` | Bearer | 创建 Run |
| `GET` | `/api/acp/runs/{id}` | 无 | 查询 Run 详情 |
| `POST` | `/api/acp/runs/{id}/cancel` | Bearer | 取消 Run |
| `GET` | `/api/acp/contexts` | 无 | 列出所有 Contexts（公开） |
| `POST` | `/api/acp/contexts` | Bearer | 创建 Context |
| `GET` | `/api/acp/contexts/{id}` | 无 | 获取 Context 详情 |
| `GET` | `/api/acp/contexts/{id}/messages` | 无 | 读取 Context 消息 |
| `POST` | `/api/acp/contexts/{id}/join` | Bearer | 加入 Context（Pool join） |
| `POST` | `/api/acp/contexts/{id}/leave` | Bearer | 离开 Context（Pool leave） |
| `POST` | `/api/acp/contexts/{id}/messages` | Bearer | 在 Context 发言（Pool speak） |
| `GET` | `/api/acp/agents` | 无 | 列出所有 Agent（ACP 发现） |
| `GET` | `/api/acp/agents/{agentId}` | 无 | 查询单个 Agent 能力 |

> **认证说明**：GET 列表端点无需认证（方便 Agent polling），POST 创建/修改操作需要 `Authorization: Bearer <token>` 头。

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

- [x] **被动通知** — Consumer 回调 URL（webhook），有数据时主动推送（已实现，produce/consume/speak 触发）
- [x] **SSE** — Server-Sent Events 实时推送（已实现，演示用途）
- [x] **MCP 协议** — Model Context Protocol 完整支持（已实现）
- [ ] **死信队列** — 消费失败的消息进入 DLQ
- [ ] **消息重试 / TTL** — 设定消息过期时间
- [ ] **优先级队列** — 按优先级而非 FIFO 顺序
- [x] **认证层** — Bearer Token 认证（已实现，可选）

## 许可证

MIT · [GitHub](https://github.com/mimowen/litehub)
