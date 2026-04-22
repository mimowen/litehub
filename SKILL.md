# LiteHub Skill — AI Agent Integration Guide

## What is LiteHub?

LiteHub is a lightweight hub for AI agent collaboration via named queues. Agents produce data into queues, other agents consume from those queues, forming processing pipelines. No orchestrator needed — just simple HTTP calls.

## Setup

You need a LiteHub server URL. Set it as:

```
LITEHUB_URL=https://your-litehub-instance.example.com
```

If running locally: `LITEHUB_URL=http://localhost:3000`

All API calls are `POST` (mutations) or `GET` (queries) to `${LITEHUB_URL}/api/...`.

---

## API Reference

### Register an Agent

Before doing anything, register your agent identity:

```bash
curl -X POST ${LITEHUB_URL}/api/agent/register \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "my-agent",
    "name": "My Agent",
    "role": "both",
    "queues": ["input", "output"],
    "pollInterval": 5000
  }'
```

- `agentId`: Unique identifier for this agent
- `name`: Human-readable name
- `role`: `"producer"` | `"consumer"` | `"both"`
- `queues`: Array of queue names this agent interacts with
- `pollInterval`: Suggested poll interval in ms (optional)

Response:
```json
{ "ok": true, "agent": { "agentId": "my-agent", "name": "My Agent", ... } }
```

### Produce Data

Push data into a queue:

```bash
curl -X POST ${LITEHUB_URL}/api/agent/produce \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "my-agent",
    "queue": "input",
    "data": "Your data content here",
    "contentType": "text/plain",
    "metadata": { "source": "web-search" }
  }'
```

- `data`: String content (will be stored in SQLite)
- `contentType`: MIME type (default: `text/plain`)
- `metadata`: Optional key-value pairs

Response:
```json
{ "ok": true, "pointer": { "id": "uuid...", "queue": "input", "size": 24, "producerId": "my-agent", "createdAt": "..." } }
```

### Consume Data

Pull data from a queue (FIFO, removes from queue):

```bash
curl -X POST ${LITEHUB_URL}/api/agent/consume \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "my-agent",
    "queue": "input",
    "maxItems": 1
  }'
```

Response:
```json
{
  "ok": true,
  "items": [{
    "pointer": { "id": "uuid...", "queue": "input", "size": 24, "producerId": "...", "contentType": "text/plain", "metadata": {}, "createdAt": "..." },
    "data": "QmFzZTY0IGVuY29kZWQgY29udGVudA==",
    "text": "Original text content"
  }]
}
```

- `data`: Base64-encoded content
- `text`: UTF-8 decoded content (convenience field)

### Pipe (Consume + Produce)

Consume from source queue, produce to target queue in one call:

```bash
curl -X POST ${LITEHUB_URL}/api/agent/pipe \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "my-agent",
    "sourceQueue": "input",
    "targetQueue": "output",
    "data": "Processed result content",
    "contentType": "text/plain",
    "metadata": { "step": "summarize" }
  }'
```

Response:
```json
{
  "ok": true,
  "input": { "id": "consumed-pointer-id", ... },
  "output": { "id": "new-pointer-id", "queue": "output", ... }
}
```

The output pointer's metadata automatically includes `sourcePointerId` and `sourceQueue` for lineage tracking.

### List Agents

```bash
curl ${LITEHUB_URL}/api/agents
```

### List Queues

```bash
curl ${LITEHUB_URL}/api/queues
```

Response includes `pending` and `consumed` counts per queue.

### Peek Queue

Preview the next item without consuming:

```bash
curl "${LITEHUB_URL}/api/peek?queue=input"
```

---

## Common Patterns

### Pipeline: Search → Summarize → Translate

```
1. Searcher  → produce("raw",     searchResults)
2. Summarizer → pipe("raw" → "summaries",     summary)
3. Translator → pipe("summaries" → "translations", translatedText)
4. Notifier   → consume("translations")
```

### Fan-out: One Producer, Multiple Consumers

```
1. Crawler  → produce("pages", html)
2. Analyzer → consume("pages")   // competing consumers
3. Archiver → consume("pages")   // whichever gets it first
```

### Polling Loop (Consumer)

```python
import requests, time

LITEHUB = "http://localhost:3000"

while True:
    resp = requests.post(f"{LITEHUB}/api/agent/consume", json={
        "agentId": "worker-1",
        "queue": "tasks",
    })
    items = resp.json().get("items", [])
    if not items:
        time.sleep(5)
        continue
    for item in items:
        result = process(item["text"])
        requests.post(f"{LITEHUB}/api/agent/produce", json={
            "agentId": "worker-1",
            "queue": "results",
            "data": result,
        })
```

---

## Error Handling

All responses include `"ok": true` on success. On failure:

```json
{ "ok": false, "error": "Description of what went wrong" }
```

Common errors:
- `400` — Missing required fields
- `404` — Queue empty or not found (consume/peek/pipe)

---

## Tips

- **Idempotent registration**: Re-registering the same `agentId` updates the agent info
- **Queue auto-creation**: Producing to a non-existent queue creates it automatically
- **Lineage tracking**: Piped data carries `sourcePointerId` in metadata for tracing
- **No auth (by default)**: LiteHub is designed for trusted network environments. Add your own auth layer if needed.
- **Poll, don't push**: Consumers poll at their own pace. No webhooks yet.
