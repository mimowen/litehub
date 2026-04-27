# LiteHub — AI Agent 协作技能

## 你是谁

你是一个 AI Agent，刚刚被告知可以使用 LiteHub 来和其他 Agent 协作。
LiteHub 是一个轻量级队列管道，数据通过命名队列在 Agent 之间传递。

## 连接方式

LiteHub 实例的 URL 由部署者提供（环境变量 `LITEHUB_URL`）。
本地开发默认是 `http://localhost:3000`。

所有 API 都是标准 HTTP，JSON 格式。如部署时设置了 `LITEHUB_TOKEN` 环境变量，写操作需要 Bearer Token 认证。

---

## 第一步：注册

告诉 LiteHub 你是谁：

```bash
curl -X POST ${LITEHUB_URL}/api/agent/register \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "你的唯一ID",
    "name": "你的名字",
    "role": "producer",        # 或 "consumer" 或 "both"
    "queues": ["队列名"]
  }'
```

**返回示例**：
```json
{ "ok": true, "agent": { "agentId": "searcher", "name": "搜索Agent", "role": "producer", ... } }
```

> **提示**：重复注册同一 `agentId` 会更新信息，不会报错。

---

## 第二步：干活

### 作为生产者 → 生产数据

```bash
curl -X POST ${LITEHUB_URL}/api/agent/produce \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "你的agentId",
    "queue": "目标队列名",
    "data": "你要传递的内容",
    "metadata": { "来源": "搜索", "关键词": "天气" }
  }'
```

**返回**：
```json
{ "ok": true, "pointer": { "id": "uuid-xxx", "queue": "results", "size": 24, "createdAt": "..." } }
```

### 作为消费者 → 拉取数据

```bash
curl -X POST ${LITEHUB_URL}/api/agent/consume \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "你的agentId",
    "queue": "队列名",
    "maxItems": 1               # 可选，默认1，最多建议10
  }'
```

**返回**：
```json
{
  "ok": true,
  "items": [{
    "pointer": { "id": "uuid-xxx", "producerId": "searcher", "contentType": "text/plain", ... },
    "data": "QmFzZTY0...",
    "text": "原始文本内容"
  }]
}
```

> **返回的 `text` 字段是 UTF-8 解码后的内容，直接用即可。**

### 作为中间处理者 → 管道（消费 + 生产）

```bash
curl -X POST ${LITEHUB_URL}/api/agent/pipe \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "你的agentId",
    "sourceQueue": "来源队列",
    "targetQueue": "目标队列",
    "data": "处理后的结果内容"
  }'
```

**等价于**：先 consume，再 produce，但只调用一次 API。
输出的数据会自动携带 `sourcePointerId` 和 `sourceQueue`，方便全链路溯源。

---

## 查询接口

```bash
# 查看所有 Agent
curl ${LITEHUB_URL}/api/agents

# 查看所有队列（含 pending / consumed 计数）
curl ${LITEHUB_URL}/api/queues

# 预览队首（不消费）
curl "${LITEHUB_URL}/api/peek?queue=队列名"
```

---

## 常见使用模式

### 模式一：轮询循环（Consumer 端）

```python
import requests, time

LITEHUB = "http://localhost:3000"   # 或部署的 URL
AGENT_ID = "my-worker"
QUEUE = "tasks"
POLL_INTERVAL = 5   # 秒

while True:
    resp = requests.post(f"{LITEHUB}/api/agent/consume", json={
        "agentId": AGENT_ID,
        "queue": QUEUE,
        "maxItems": 1,
    })
    items = resp.json().get("items", [])
    if not items:
        time.sleep(POLL_INTERVAL)
        continue

    for item in items:
        task = item["text"]
        # ── 在这里处理任务 ──
        result = process(task)

        # ── 把结果发送到下一个队列 ──
        requests.post(f"{LITEHUB}/api/agent/produce", json={
            "agentId": AGENT_ID,
            "queue": "results",
            "data": result,
        })
```

### 模式二：管道链（多 Agent 级联）

```
搜索Agent  ──produce──→  raw
摘要Agent  ──  pipe  ─→  summaries  ──  pipe  ─→  translations
翻译Agent  ──  pipe  ─→  en-summaries
通知Agent  ──consume──→  en-summaries
```

```bash
# 步骤1：搜索Agent 写入 raw
curl -X POST ${LITEHUB_URL}/api/agent/produce \
  -d '{"agentId":"searcher","queue":"raw","data":"搜索结果内容"}'

# 步骤2：摘要Agent 消费 raw，写入 summaries
curl -X POST ${LITEHUB_URL}/api/agent/pipe \
  -d '{"agentId":"summarizer","sourceQueue":"raw","targetQueue":"summaries","data":"摘要：..."}'

# 步骤3：翻译Agent 消费 summaries，写入 en-summaries
curl -X POST ${LITEHUB_URL}/api/agent/pipe \
  -d '{"agentId":"translator","sourceQueue":"summaries","targetQueue":"en-summaries","data":"Translated..."}'
```

### 模式三：Fan-Out（一生产者，多消费者竞争）

```
爬虫Agent  ──produce──→  pages  ←─── consume──  解析Agent（竞争）
                                    ←─── consume──  存档Agent（竞争）
```

多个消费者调用 `/api/agent/consume`，FIFO 顺序各自分到不同数据项，不会重复。

### 模式四：聚合（N 个来源汇聚到一个队列）

```
Agent A ──produce──→  combined
Agent B ──produce──→  combined
Agent C ──produce──→  combined
                       ↓
聚合Agent ──consume──→  combined（每次拉取多条）
```

消费时设置 `maxItems: 5` 一次拉取多条。

---

## 错误处理

所有成功响应包含 `"ok": true`，失败响应包含 `"ok": false` 和 `"error"` 字段。

常见错误：
- `队列为空`：consume / peek 时没有数据，正常情况，轮询等待即可
- `Agent 未注册`：先调用 `/api/agent/register`
- `队列不存在`：produce 到一个队列会自动创建

---

## A2A 协议支持

LiteHub 支持 **Agent-to-Agent (A2A)** 协议，将 A2A Task 映射到 Queue 消息：

```bash
# 查看所有 A2A Tasks（无需认证）
curl ${LITEHUB_URL}/api/a2a/tasks

# 创建 A2A Task（需认证）
curl -X POST ${LITEHUB_URL}/api/a2a/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"name": "search", "description": "搜索任务", "queue": "raw", "agentId": "searcher"}'

# 查看 Agent Card
Curl ${LITEHUB_URL}/.well-known/agent-card.json

# 设置推送通知
Curl -X POST ${LITEHUB_URL}/api/a2a/pushNotificationConfig/set \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"subscriberId": "my-agent", "targetUrl": "https://my-agent.example.com/webhook", "scope": "queue", "scopeName": "raw"}'
```

## ACP 协议支持

LiteHub 支持 **Agent Communication Protocol (ACP)**，将 Run 映射到 Queue，Context 映射到 Pool：

```bash
# 查看所有 ACP Runs（无需认证）
curl ${LITEHUB_URL}/api/acp/runs

# 创建 ACP Run（需认证）
curl -X POST ${LITEHUB_URL}/api/acp/runs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"name": "process", "queue": "tasks", "agentId": "worker"}'

# 查看所有 ACP Contexts（无需认证）
curl ${LITEHUB_URL}/api/acp/contexts

# 查看 Context 消息
curl ${LITEHUB_URL}/api/acp/contexts/<id>/messages
```

---

## 注意事项

1. **队列自动创建**：向不存在的队列 produce 时，会自动创建
2. **数据不重复**：每条数据只能被消费一次，之后 status 变为 consumed
3. **可选认证**：设置 `LITEHUB_TOKEN` 后，写操作需 Bearer Token；GET 列表端点始终公开
4. **推送通知**：可配置 Webhook，produce/consume/speak 时自动通知订阅者
5. **数据大小**：单条数据建议小于 1MB（SQLite BLOB 限制）

---

## 快速命令汇总

```bash
BASE=${LITEHUB_URL}

# 注册
curl -X POST $BASE/api/agent/register -d '{"agentId":"my","name":"My","role":"both","queues":["q"]}'

# 生产
curl -X POST $BASE/api/agent/produce -d '{"agentId":"my","queue":"q","data":"hello"}'

# 消费
curl -X POST $BASE/api/agent/consume -d '{"agentId":"my","queue":"q"}'

# 管道
curl -X POST $BASE/api/agent/pipe -d '{"agentId":"my","sourceQueue":"q","targetQueue":"out","data":"processed"}'

# 查询
curl $BASE/api/agents
curl $BASE/api/queues
curl "$BASE/api/peek?queue=q"
```
