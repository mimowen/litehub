// src/adapters/cf-workers.ts — Cloudflare Workers 部署适配器
// 用 D1 替代 better-sqlite3（CF Workers 没有 Node.js 文件系统）
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

type Bindings = {
  DB: D1Database;  // Cloudflare D1 绑定
};

const app = new Hono<{ Bindings: Bindings }>();
app.use("*", cors());
app.use("*", logger());

// ─── D1 版本的队列操作 ────────────────────────────────────────────────────

function initDb(db: D1Database) {
  // D1 不支持批量 exec，逐条执行
  return db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS pointers (
      id TEXT PRIMARY KEY, queue TEXT NOT NULL, producer_id TEXT NOT NULL,
      data BLOB NOT NULL, size INTEGER NOT NULL, content_type TEXT DEFAULT 'text/plain',
      metadata TEXT DEFAULT '{}', status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_pointers_queue_status ON pointers(queue, status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS queues (
      name TEXT PRIMARY KEY, description TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
      queues TEXT DEFAULT '[]', poll_interval INTEGER DEFAULT 0, registered_at TEXT DEFAULT (datetime('now'))
    )`),
  ]);
}

// ─── Agent API ─────────────────────────────────────────────────────────────

app.post("/api/agent/register", async (c) => {
  const db = c.env.DB;
  await initDb(db);
  const body = await c.req.json();
  const { agentId, name, role, queues, pollInterval } = body;
  if (!agentId || !name || !role || !queues?.length) {
    return c.json({ ok: false, error: "缺少必填字段" }, 400);
  }
  await db.prepare(
    "INSERT OR REPLACE INTO agents (agent_id, name, role, queues, poll_interval, registered_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
  ).bind(agentId, name, role, JSON.stringify(queues), pollInterval || 0).run();

  for (const q of queues) {
    await db.prepare("INSERT OR IGNORE INTO queues (name) VALUES (?)").bind(q).run();
  }
  return c.json({ ok: true, agent: { agentId, name, role, queues, pollInterval, registeredAt: new Date().toISOString() } });
});

app.get("/api/agents", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM agents ORDER BY registered_at").all();
  const agents = (results as any[]).map(r => ({
    agentId: r.agent_id, name: r.name, role: r.role,
    queues: JSON.parse(r.queues || "[]"), pollInterval: r.poll_interval, registeredAt: r.registered_at,
  }));
  return c.json({ ok: true, agents });
});

// ─── Produce / Consume / Pipe ──────────────────────────────────────────────

app.post("/api/agent/produce", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();
  const { agentId, queue, data, contentType, metadata } = body;
  if (!agentId || !queue || data === undefined) return c.json({ ok: false, error: "缺少必填字段" }, 400);

  await db.prepare("INSERT OR IGNORE INTO queues (name) VALUES (?)").bind(queue).run();
  const id = crypto.randomUUID();
  const text = String(data);
  await db.prepare(
    "INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, queue, agentId, text, text.length, contentType || "text/plain", JSON.stringify(metadata || {})).run();

  return c.json({ ok: true, pointer: { id, queue, size: text.length, producerId: agentId, createdAt: new Date().toISOString() } });
});

app.post("/api/agent/consume", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();
  const { agentId, queue, maxItems } = body;
  if (!agentId || !queue) return c.json({ ok: false, error: "缺少必填字段" }, 400);

  const { results } = await db.prepare(
    "SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT ?"
  ).bind(queue, maxItems || 1).all();

  const items = [];
  for (const row of results as any[]) {
    await db.prepare("UPDATE pointers SET status = 'consumed' WHERE id = ?").bind(row.id).run();
    items.push({
      pointer: { id: row.id, queue: row.queue, size: row.size, producerId: row.producer_id,
        contentType: row.content_type, metadata: JSON.parse(row.metadata || "{}"), createdAt: row.created_at },
      data: Buffer.from(row.data).toString("base64"),
      text: row.data,
    });
  }
  return c.json({ ok: true, items });
});

app.post("/api/agent/pipe", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();
  const { agentId, sourceQueue, targetQueue, data, contentType, metadata } = body;
  if (!agentId || !sourceQueue || !targetQueue || data === undefined) return c.json({ ok: false, error: "缺少必填字段" }, 400);

  const row = await db.prepare(
    "SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT 1"
  ).bind(sourceQueue).first();
  if (!row) return c.json({ ok: false, error: "源队列无数据" }, 404);

  await db.prepare("UPDATE pointers SET status = 'consumed' WHERE id = ?").bind((row as any).id).run();

  const id = crypto.randomUUID();
  const text = String(data);
  await db.prepare("INSERT OR IGNORE INTO queues (name) VALUES (?)").bind(targetQueue).run();
  await db.prepare(
    "INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, targetQueue, agentId, text, text.length, contentType || "text/plain",
    JSON.stringify({ ...metadata, sourcePointerId: (row as any).id, sourceQueue })).run();

  return c.json({ ok: true, input: { id: (row as any).id }, output: { id, queue: targetQueue } });
});

// ─── Queue API ─────────────────────────────────────────────────────────────

app.get("/api/queues", async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare("SELECT * FROM queues ORDER BY created_at").all();
  const queues = [];
  for (const q of results as any[]) {
    const p = await db.prepare("SELECT COUNT(*) as c FROM pointers WHERE queue = ? AND status = 'pending'").bind(q.name).first();
    const d = await db.prepare("SELECT COUNT(*) as c FROM pointers WHERE queue = ? AND status = 'consumed'").bind(q.name).first();
    queues.push({ name: q.name, description: q.description, pending: (p as any).c, consumed: (d as any).c, createdAt: q.created_at });
  }
  return c.json({ ok: true, queues });
});

app.get("/api/peek", async (c) => {
  const queue = c.req.query("queue");
  if (!queue) return c.json({ ok: false, error: "缺少 query: queue" }, 400);
  const row = await c.env.DB.prepare(
    "SELECT id, queue, size, producer_id, content_type, metadata, created_at FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT 1"
  ).bind(queue).first();
  if (!row) return c.json({ ok: false, error: "队列为空" }, 404);
  const r = row as any;
  return c.json({ ok: true, pointer: { id: r.id, queue: r.queue, size: r.size, producerId: r.producer_id, contentType: r.content_type, metadata: JSON.parse(r.metadata || "{}"), createdAt: r.created_at } });
});

app.get("/", (c) => c.json({ ok: true, message: "LiteHub (Cloudflare Workers)" }));

export default app;
