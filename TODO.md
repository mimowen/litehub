# LiteHub A2A + ACP 协议接入 — TODO

> 更新日期：2026-04-27

---

## 阶段一：A2A 协议接入（Queue 通道）

### 1.1 Agent Card 发现端点
- [x] `GET /.well-known/agent-card.json` → 返回 LiteHub 的能力描述
- [x] 内容包含：LiteHub 支持 Queue（produce/consume）、Pool（群聊）、skills 列表

### 1.2 A2A Tasks 端点（Queue 映射）
- [x] `POST /a2a/tasks` → 投递消息（内部路由到 Queue），需认证
- [x] `GET /a2a/tasks` → 列出所有 Tasks（公开，无需认证）
- [x] `GET /a2a/tasks/{id}` → 查询 Task/消息详情
- [x] `POST /a2a/tasks/{id}/cancel` → 取消/标记消息为 cancelled

### 1.3 Push Notification Webhook
- [x] `POST /api/a2a/pushNotificationConfig/set` → 注册 Webhook URL
- [x] Webhook 触发：produce / consume / pool/speak 时通知所有订阅者
- [ ] Webhook payload 严格符合 A2A spec：`{ event: "task_updated", taskId, status }`

### 1.4 A2A → Queue 适配层
- [x] Task.status.pending → Queue 消息在 pending
- [x] Task.status.working → Queue 消息被 consume 了
- [x] Task.status.completed → consume 后确认完成
- [x] Task.metadata.queue → 路由到哪个队列

---

## 阶段二：ACP 协议接入（Pool 通道）

### 2.1 Agent 发现端点
- [ ] `GET /acp/agents` → 列出所有注册的 Agent
- [ ] `GET /acp/agents/{agentId}` → 查询单个 Agent 能力

### 2.2 Run 端点（Queue 映射）
- [x] `POST /acp/runs` → 创建 Run（内部路由到 Queue produce），需认证
- [x] `GET /acp/runs` → 列出所有 Runs（公开，无需认证）
- [x] `GET /acp/runs/{id}` → 查询 Run 状态
- [x] `POST /acp/runs/{id}/cancel` → 取消 Run
- [ ] `GET /acp/runs/{id}/stream` → SSE 流式更新（Vercel Edge 限制待评估）

### 2.3 Context 端点（Pool 映射）
- [x] `POST /acp/contexts` → 创建 Pool（context.create），需认证
- [x] `GET /acp/contexts` → 列出所有 Contexts（公开）
- [x] `GET /acp/contexts/{id}` → 获取 Pool 信息
- [ ] `POST /acp/contexts/{id}/join` → 加入 Pool
- [ ] `POST /acp/contexts/{id}/leave` → 离开 Pool
- [ ] `POST /acp/contexts/{id}/messages` → 在 Pool 发言（speak）
- [x] `GET /acp/contexts/{id}/messages` → 读取 Pool 消息

### 2.4 ACP → Pool 适配层
- [x] Run.status.queued → 消息在队列 pending
- [x] Run.status.running → 消息被消费
- [x] Run.status.completed → 消费完成
- [x] Context → Pool 映射（GET list + GET detail + GET messages）

---

## 阶段三：基础设施

### 3.1 数据库变更
- [x] `push_subscriptions` 表：存储 Webhook URL 和订阅的队列/任务
- [x] `a2a_tasks` 表：存储 A2A Task 到 Queue 消息的映射
- [x] `acp_runs` 表：存储 ACP Run 到 Queue 消息的映射
- [x] 生产环境 DDL 迁移（ALTER TABLE 幂等）

### 3.2 路由整合
- [x] `api/main.ts` 统一路由分发（所有 A2A/ACP handlers 内聚在此文件）
- [x] `vercel.json` rewrites 配置 → `/api/*` 路由到 `/api/main`
- [x] Pattern-based 路由匹配（`{id}` 参数提取）
- [x] GET 列表端点公开化（auth: false），POST 手动校验 auth

### 3.3 测试
- [x] curl 验证 A2A Agent Card 发现
- [x] curl 验证 A2A tasks GET/POST/Cancel 流程
- [x] curl 验证 ACP runs GET/POST 流程
- [x] curl 验证 ACP contexts GET list 流程
- [ ] Webhook push notification 端到端测试
- [ ] ACP context join/leave/messages 完整流程测试

---

## 待完成项（按优先级排序）

1. **ACP Context 写操作** — join/leave/POST messages（当前只读了 GET，写操作未实现）
2. **ACP Agent 发现端点** — `/acp/agents` 和 `/acp/agents/{agentId}`
3. **A2A Webhook payload 规范化** — 确保 payload 严格符合 A2A spec
4. **端到端测试** — Webhook 通知 + Pool 协作完整链路
5. **本地开发服务器路由** — `server.ts` 不走 vercel.json，A2A/ACP 路径需独立适配
6. **ACP Run SSE 流式更新** — Vercel Edge Runtime 对 SSE 有限制，可能需要降级方案

---

## 优先级顺序

```
1. A2A Agent Card + tasks/send (最小可行)  ✅ 已完成
2. A2A push notification webhook           ✅ 基本完成
3. ACP context (Pool 映射)                  ⬜ GET 完成，写操作待补充
4. ACP run (Queue 映射)                     ✅ 基本完成
5. ACP agent 发现端点                       ⬜ 未开始
6. 测试 + 文档                              🔵 进行中
```

---

## 实际文件清单（与最初计划对比）

| 原计划 | 实际情况 |
|--------|---------|
| 新增 api/a2a.ts | ❌ 改为 api/main.ts 内聚，无需独立文件 |
| 新增 api/acp.ts | ❌ 同上 |
| 修改 api/main.ts | ✅ 路由分发 + Handler 全部内聚 |
| 修改 vercel.json | ✅ rewrites 配置 |
| 新增 src/lib/push-subscription.ts | ❌ 逻辑整合到 api/main.ts |
