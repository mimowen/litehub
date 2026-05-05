# LiteHub 架构设计

## 核心思想

LiteHub 是一个**轻量级的 Agent 协作管道**，核心概念是：
- **Queue（队列）**：用于单向消息传递
- **Pool（池子）**：用于多 Agent 群聊
- **A2A/ACP/MCP 协议适配**：让 Agent 可以通过标准协议与 LiteHub 协作，而不需要知道 LiteHub 的存在

---

## 协议透明映射原理

### A2A (Agent-to-Agent Protocol)：Task → Queue 映射

```
Agent A (A2A客户端)                    Agent B (A2A客户端)
    │                                      │
    │  message/send {taskId, content}      │  tasks/get {taskId}
    │         │                            │         │
    ▼         ▼                            ▼         ▼
┌─────────────────────────────────────────────────────────┐
│  A2A Protocol Layer (protocols/a2a.ts)                  │
│  ┌───────────────────────────────────────────────────┐  │
│  │ JSON-RPC 2.0 → 内部调用                           │  │
│  │  message/send → createTask() / sendToTask()       │  │
│  │  tasks/get    → getTask()                          │  │
│  │  tasks/list   → listTasks()                        │  │
│  │  tasks/cancel → cancelTask()                       │  │
│  └───────────────────────┬───────────────────────────┘  │
│                          │                               │
│  ┌───────────────────────▼───────────────────────────┐  │
│  │ Core Layer (core/a2a.ts)                          │  │
│  │  Task "abc123" → Queue "a2a:agentA:abc123"        │  │
│  │  sendToTask() → produce(queue, data, agentId)     │  │
│  │  getTask()    → 查 a2a_tasks 表 + pointers 表     │  │
│  └───────────────────────┬───────────────────────────┘  │
│                          │                               │
│  ┌───────────────────────▼───────────────────────────┐  │
│  │ Queue Layer (core/queue.ts)                       │  │
│  │  produce() → INSERT INTO pointers                  │  │
│  │  consume() → SELECT + UPDATE status='consumed'     │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**关键代码**：[core/a2a.ts:47](../src/core/a2a.ts#L47)
```typescript
const queueName = `a2a:${targetAgentId || agentId}:${realTaskId}`;
// 每个 A2A Task 自动创建一个对应的 Queue
await ensureQueue(db, queueName, `A2A task: ${name}`, agentId);
```

### ACP (Agent Communication Protocol)：Run/Context → Pool 映射

```
Agent A (ACP客户端)                    Agent B (ACP客户端)
    │                                      │
    │  POST /runs {agentId, name}          │  POST /contexts/{id}/join
    │         │                            │         │
    ▼         ▼                            ▼         ▼
┌─────────────────────────────────────────────────────────┐
│  ACP Protocol Layer (protocols/acp.ts)                  │
│  ┌───────────────────────────────────────────────────┐  │
│  │ REST API → 内部调用                                │  │
│  │  createRun     → createRun()                       │  │
│  │  createContext → createContext()                   │  │
│  │  speakContext  → speakContext()                    │  │
│  └───────────────────────┬───────────────────────────┘  │
│                          │                               │
│  ┌───────────────────────▼───────────────────────────┐  │
│  │ Core Layer (core/acp.ts)                          │  │
│  │  Run "xyz789"     → Pool "acp:xyz789"             │  │
│  │  Context "my-ctx" → Pool "my-ctx" (无前缀)        │  │
│  │  createRun()     → createPool("acp:{runId}")      │  │
│  │  speakContext()  → speak(pool, agentId, content)  │  │
│  │  joinContext()   → joinPool(pool, agentId)        │  │
│  └───────────────────────┬───────────────────────────┘  │
│                          │                               │
│  ┌───────────────────────▼───────────────────────────┐  │
│  │ Pool Layer (core/pool.ts)                         │  │
│  │  speak() → INSERT INTO pool_messages               │  │
│  │  getMessages() → SELECT FROM pool_messages         │  │
│  │  joinPool() → INSERT INTO pool_members             │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**关键代码**：[core/acp.ts:53](../src/core/acp.ts#L53)
```typescript
const poolName = `acp:${id}`;
// 每个 ACP Run 自动创建一个对应的 Pool
await createPool(db, poolName, name || id, guidelines, maxMembers, agentId);
```

### MCP (Model Context Protocol)：Tools → Core Functions 映射

```
Claude / Cursor / MCP客户端
    │
    │  tools/list  → 返回所有可用工具
    │  tools/call {tool: "litehub_produce", args}
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  MCP Layer (mcp-handler.ts)                             │
│  ┌───────────────────────────────────────────────────┐  │
│  │  MCP Tool → Core Function 映射                    │  │
│  │  litehub_register  → queue.registerAgent()        │  │
│  │  litehub_produce   → queue.produce()              │  │
│  │  litehub_consume  → queue.consume()              │  │
│  │  a2a_create_task  → a2a.createTask()             │  │
│  │  acp_create_run  → acp.createRun()               │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 透明性表

| Agent 视角 | 看到的 | 不知道的 |
|-----------|--------|---------|
| A2A Agent | 创建 Task、发送 Message、订阅更新 | 底层是 Queue + pointers 表 |
| ACP Agent | 创建 Run/Context、发言、读消息 | 底层是 Pool + pool_messages 表 |
| MCP Agent | 调用工具 litehub_produce、litehub_consume | 其他协议的存在 |

### 资源隔离机制

为了确保协议内部的资源不会被误操作，LiteHub 实现了**资源隔离机制**：

#### Type 字段

- **Queue 表**：添加 `type` 字段，默认为 `'user'`，A2A 协议创建的队列为 `'a2a'`
- **Pool 表**：添加 `type` 字段，默认为 `'user'`，ACP 协议创建的 Pool 为 `'acp'`

#### 过滤规则

```typescript
// listQueues() 只返回 type='user' 的队列
export async function listQueues(db: DbClient, options?: { includeInternal?: boolean }) {
  const sql = includeInternal
    ? "SELECT * FROM queues ORDER BY created_at"
    : "SELECT * FROM queues WHERE type = 'user' OR type IS NULL ORDER BY created_at";
  // ...
}

// listPools() 只返回 type='user' 的 Pool
export async function listPools(db: DbClient, options?: { includeInternal?: boolean }) {
  const sql = includeInternal
    ? "SELECT * FROM pools ORDER BY created_at"
    : "SELECT * FROM pools WHERE type = 'user' OR type IS NULL ORDER BY created_at";
  // ...
}
```

#### 隔离效果

| 资源类型 | 用户可见 | 协议可见 | Dashboard 可见 |
|---------|---------|---------|---------------|
| User Queue | ✅ | ✅ | ✅ |
| A2A Queue (`a2a:*`) | ❌ | ✅ (通过 A2A API) | ✅ (显示为 A2A Task) |
| User Pool | ✅ | ✅ | ✅ |
| ACP Pool (`acp:*`) | ❌ | ✅ (通过 ACP API) | ✅ (显示为 ACP Run) |

**设计原则**：
- 协议内部的资源对普通用户不可见，避免误操作
- Dashboard 可以看到所有资源，但以协议视角展示（A2A Tasks、ACP Runs）
- 管理员可以通过 `includeInternal: true` 选项查看所有资源

---

## 完整架构图

```
┌───────────────────────────────────────────────────────────────────────────┐
│                          外部世界 (Agents)                              │
│ ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐ │
│ │  HTTP API Client  │ │  A2A Client      │ │  MCP Client      │ │
│ └────────┬──────────┘ └────────┬──────────┘ └────────┬──────────┘ │
└──────────┼──────────────────────┼──────────────────────┼─────────────┘
           │                      │                      │
┌──────────▼──────────────────────▼──────────────────────▼─────────────┐
│                          Edge Runtime (Vercel)                        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  index.ts (主入口，路由分发)                                  │    │
│  │  - 统一认证中间件 authMiddleware                            │    │
│  │  - 路由分发到 handlers/                                      │    │
│  │  - MCP 优雅降级（Edge 不支持 MCP SDK）                        │    │
│  └────────────┬────────────────────────────────────────────────┘    │
│               │                                                   │
│  ┌────────────▼───────────────────────────────────────────────┐  │
│  │  handlers/ (HTTP API 层)                                   │  │
│  │  ├─ agents.ts  → queue.core                               │  │
│  │  ├─ queues.ts  → queue.core                               │  │
│  │  ├─ pools.ts   → pool.core                                │  │
│  │  ├─ a2a.ts    → a2a.core                                 │  │
│  │  ├─ acp.ts    → acp.core                                 │  │
│  │  └─ pages.ts  → 页面渲染                                  │  │
│  └────────────┬────────────────────────────────────────────────┘  │
│               │                                                   │
│  ┌────────────▼───────────────────────────────────────────────┐  │
│  │  protocols/ (协议适配层)                                    │  │
│  │  ├─ a2a.ts  → A2A JSON-RPC 2.0 适配                       │  │
│  │  └─ acp.ts  → ACP REST API 适配                           │  │
│  └────────────┬────────────────────────────────────────────────┘  │
│               │                                                   │
│  ┌────────────▼───────────────────────────────────────────────┐  │
│  │  mcp-handler.ts (MCP 协议层)                               │  │
│  │  - McpServer + WebStandardStreamableHTTPServerTransport   │  │
│  └────────────┬────────────────────────────────────────────────┘  │
│               │                                                   │
│  ┌────────────▼───────────────────────────────────────────────┐  │
│  │  core/ (纯业务逻辑层，平台无关)                              │  │
│  │  ├─ queue.ts  → 队列操作                                  │  │
│  │  ├─ pool.ts   → 池子操作                                  │  │
│  │  ├─ a2a.ts    → A2A Task ↔ Queue 映射                    │  │
│  │  └─ acp.ts    → ACP Run/Context ↔ Pool 映射              │  │
│  └────────────┬────────────────────────────────────────────────┘  │
│               │                                                   │
│  ┌────────────▼───────────────────────────────────────────────┐  │
│  │  adapters/db/ (数据库抽象层)                               │  │
│  │  ├─ sqlite.ts  → 本地 SQLite                              │  │
│  │  ├─ turso.ts   → Turso (远程 SQLite)                     │  │
│  │  └─ d1.ts      → Cloudflare D1 (即将支持)                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                  │                                                  │
└──────────────────┼──────────────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────┐
│         Database (SQLite)          │
│  - agents                          │
│  - queues                          │
│  - pointers                        │
│  - pools                           │
│  - pool_members                    │
│  - pool_messages                   │
│  - a2a_tasks                       │
│  - acp_runs                        │
│  - webhooks                        │
└─────────────────────────────────────┘
```

---

## 降级路径

所有协议底层都复用 core/ 层，所以即使协议层不可用（比如 SSE 不支持），Agent 仍然可以通过 HTTP API 完成同样的操作：

```
MCP (Streamable HTTP) ──不支持──→ HTTP API (普通 POST/GET)
A2A (JSON-RPC + SSE)  ──不支持──→ HTTP API (POST /api/a2a/tasks)
ACP (REST + SSE)       ──不支持──→ HTTP API (POST /api/acp/runs)
```

### 当前降级状态

| 协议 | 降级实现 | 状态 |
|------|---------|------|
| MCP | Edge Runtime 返回 501 | ❌ 待实现友好降级提示 |
| A2A SSE | 需要手动轮询 | ❌ 待实现自动降级 |
| ACP SSE | 需要手动轮询 | ❌ 待实现自动降级 |

---

## 关键设计原则

1. **核心逻辑统一在 core/ 层**：所有协议都复用 core/，没有重复造轮子
2. **协议层只做格式适配**：不包含业务逻辑，只负责：
   - HTTP API：`{ ok, data }` / `{ ok, false, error }`
   - A2A：JSON-RPC 2.0 格式
   - ACP：REST API 格式
   - MCP：Model Context Protocol 工具格式
3. **透明性优先**：Agent 只知道自己用的协议，不知道 LiteHub 内部结构
4. **队列设计**：消费后数据不删除，只标记 `status='consumed'`，可以追溯历史
5. **小黑板支持**：Queue 和 Pool 都有 `description` 字段，所有人可编辑

---

## 目录结构

```
src/
├── index.ts          # 主入口，路由分发
├── types.ts          # TypeScript 类型定义
├── utils.ts          # 工具函数
├── utils/
│   ├── response.ts  # 统一响应格式
│   └── wrap.ts      # Hono 路由包装器（消除 try/catch 重复）
├── middleware/
│   └── auth.ts      # 认证中间件
├── handlers/
│   ├── agents.ts    # Agent 相关 API handlers
│   ├── queues.ts    # Queue 相关 API handlers
│   ├── pools.ts     # Pool 相关 API handlers
│   ├── a2a.ts       # A2A API handlers
│   ├── acp.ts       # ACP API handlers
│   ├── webhook.ts   # Webhook API handlers
│   └── pages.ts     # 页面渲染 handlers
├── core/
│   ├── queue.ts     # 队列核心逻辑
│   ├── pool.ts      # 池子核心逻辑
│   ├── a2a.ts       # A2A Task ↔ Queue 映射
│   ├── acp.ts       # ACP Run/Context ↔ Pool 映射
│   └── webhook.ts   # Webhook 核心逻辑
├── protocols/
│   ├── a2a.ts       # A2A JSON-RPC 2.0 协议适配
│   └── acp.ts       # ACP REST API 协议适配
├── mcp-handler.ts   # MCP 协议适配
└── mcp-routes.ts    # MCP 路由配置

api/
├── main.ts          # Vercel Edge Runtime 入口
└── mcp-sse.ts       # Vercel Node.js Runtime MCP 入口

adapters/db/
├── interface.ts     # 数据库抽象接口
├── sqlite.ts        # 本地 SQLite 实现
├── turso.ts         # Turso 远程 SQLite 实现
└── d1.ts            # Cloudflare D1 实现（预留）

docs/
└── ARCHITECTURE.md  # 本文档
```
