# LiteHub A2A + ACP 协议接入 — TODO

> 更新日期：2026-04-27

---

## 阶段一：A2A 协议接入（Queue 通道）

### 1.1 Agent Card 发现端点
- [ ] `GET /.well-known/agent-card.json` → 返回 LiteHub 的能力描述
- [ ] 内容包含：LiteHub 支持 Queue（produce/consume）、Pool（群聊）、skills 列表

### 1.2 A2A Tasks 端点（Queue 映射）
- [ ] `POST /a2a/tasks` → 投递消息（内部路由到 Queue）
- [ ] `GET /a2a/tasks/{id}` → 查询 Task/消息详情
- [ ] `POST /a2a/tasks/{id}/cancel` → 取消/标记消息为 cancelled
- [ ] `POST /a2a/tasks/{id}/subscribe` → 订阅 Task 推送（配置 Webhook）

### 1.3 Push Notification Webhook
- [ ] `POST /a2a/tasks/pushNotificationConfig/set` → 注册 Webhook URL
- [ ] Webhook 触发：produce 时通知所有订阅该队列的 Consumer
- [ ] Webhook payload 符合 A2A spec：`{ event: "task_updated", taskId, status }`

### 1.4 A2A → Queue 适配层
- [ ] Task.status.pending → Queue 消息在 pending
- [ ] Task.status.working → Queue 消息被 consume 了
- [ ] Task.status.completed → consume 后确认完成
- [ ] Task.metadata.queue → 路由到哪个队列

---

## 阶段二：ACP 协议接入（Pool 通道）

### 2.1 Agent 发现端点
- [ ] `GET /acp/agents` → 列出所有注册的 Agent
- [ ] `GET /acp/agents/{agentId}` → 查询单个 Agent 能力

### 2.2 Run 端点（Queue 映射）
- [ ] `POST /acp/runs` → 创建 Run（内部路由到 Queue produce）
- [ ] `GET /acp/runs/{id}` → 查询 Run 状态
- [ ] `POST /acp/runs/{id}/cancel` → 取消 Run
- [ ] `GET /acp/runs/{id}/stream` → SSE 流式更新（Vercel Edge 下测试）

### 2.3 Context 端点（Pool 映射）
- [ ] `POST /acp/contexts` → 创建 Pool（context.create）
- [ ] `GET /acp/contexts/{id}` → 获取 Pool 信息
- [ ] `POST /acp/contexts/{id}/join` → 加入 Pool
- [ ] `POST /acp/contexts/{id}/leave` → 离开 Pool
- [ ] `POST /acp/contexts/{id}/messages` → 在 Pool 发言（speak）
- [ ] `GET /acp/contexts/{id}/messages` → 读取 Pool 消息
- [ ] `POST /acp/contexts/{id}/subscribe` → 订阅 Pool 更新

### 2.4 ACP → Pool 适配层
- [ ] Run.status.queued → 消息在队列 pending
- [ ] Run.status.running → 消息被消费
- [ ] Run.status.completed → 消费完成
- [ ] Context → Pool 完全同构，最自然的映射

---

## 阶段三：基础设施

### 3.1 数据库变更
- [ ] `push_subscriptions` 表：存储 Webhook URL 和订阅的队列/任务
- [ ] `a2a_tasks` 表：存储 A2A Task 到 Queue 消息的映射（A2A Task ID ↔ LiteHub Pointer ID）
- [ ] `acp_runs` 表：存储 ACP Run 到 Queue 消息的映射

### 3.2 路由整合
- [ ] `api/main.ts` 路由分发：A2A → `api/a2a.ts`，ACP → `api/acp.ts`
- [ ] `vercel.json` 添加路由规则

### 3.3 测试
- [ ] 测试 A2A Agent Card 发现
- [ ] 测试 A2A tasks/send → produce 流程
- [ ] 测试 ACP context → Pool 映射
- [ ] 测试 Webhook push notification

---

## 优先级顺序

```
1. A2A Agent Card + tasks/send (最小可行)
2. A2A push notification webhook
3. ACP context (Pool 映射)
4. ACP run (Queue 映射)
5. 测试 + 文档
```

---

## 文件变更清单

| 操作 | 文件 |
|------|------|
| 新增 | api/a2a.ts |
| 新增 | api/acp.ts |
| 修改 | api/main.ts（路由分发） |
| 修改 | vercel.json（路由规则） |
| 新增 | src/lib/push-subscription.ts（Webhook 管理） |