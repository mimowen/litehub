// src/adapters/vercel.ts — Vercel 部署适配器（Turso 版本）
// 独立实现，不依赖 src/index.ts（避免引入 better-sqlite3）
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createClient, Client } from "@libsql/client";

// Turso 连接配置（环境变量）
const TURSO_URL = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL || "";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "";

let _client: Client | null = null;

function getTurso(): Client {
  if (_client) return _client;
  if (!TURSO_URL) {
    throw new Error("Missing TURSO_URL or TURSO_DATABASE_URL environment variable");
  }
  _client = createClient({
    url: TURSO_URL,
    authToken: TURSO_AUTH_TOKEN,
  });
  return _client;
}

async function initDb() {
  const db = getTurso();
  // Turso 支持批量执行
  await db.batch([
    { sql: `CREATE TABLE IF NOT EXISTS pointers (
      id TEXT PRIMARY KEY,
      queue TEXT NOT NULL,
      producer_id TEXT NOT NULL,
      data TEXT NOT NULL,
      size INTEGER NOT NULL,
      content_type TEXT DEFAULT 'text/plain',
      metadata TEXT DEFAULT '{}',
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    )` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_pointers_queue_status ON pointers(queue, status)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_pointers_queue ON pointers(queue)` },
    { sql: `CREATE TABLE IF NOT EXISTS queues (
      name TEXT PRIMARY KEY,
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )` },
    { sql: `CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      queues TEXT DEFAULT '[]',
      poll_interval INTEGER DEFAULT 0,
      registered_at TEXT DEFAULT (datetime('now'))
    )` },
  ], "write");
}

const app = new Hono();
app.use("*", logger());
app.use("*", cors());

// ─── Hello Landing Page ────────────────────────────────────────────────────

app.get("/", async (c) => {
  const host = c.req.header("host") || "localhost";
  const proto = c.req.header("x-forwarded-proto") || "https";
  const baseUrl = `${proto}://${host}`;

  return c.html(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>LiteHub — Lightweight Agent Collaboration Hub</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #09090b; color: #e4e4e7; line-height: 1.7; }
  a { color: #60a5fa; text-decoration: none; } a:hover { text-decoration: underline; }
  code { background: #1e1e2e; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; color: #a5d6ff; }
  pre { background: #1e1e2e; padding: 1rem 1.25rem; border-radius: 8px; overflow-x: auto; font-size: 0.85rem; line-height: 1.5; margin: 0.75rem 0; }
  .hero { max-width: 720px; margin: 0 auto; padding: 6rem 2rem 3rem; text-align: center; }
  .hero h1 { font-size: 3rem; font-weight: 800; margin-bottom: 0.5rem; }
  .hero h1 span { background: linear-gradient(135deg, #60a5fa, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .hero p.tagline { font-size: 1.25rem; color: #94a3b8; margin-bottom: 2rem; }
  .badges { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; margin-bottom: 3rem; }
  .badge { background: #1e1e2e; border: 1px solid #2e2e3e; padding: 0.3rem 0.8rem; border-radius: 999px; font-size: 0.8rem; color: #94a3b8; }
  .section { max-width: 720px; margin: 0 auto; padding: 0 2rem 3rem; }
  .section h2 { font-size: 1.5rem; margin-bottom: 1rem; color: #f4f4f5; }
  .section h3 { font-size: 1.1rem; margin: 1.25rem 0 0.5rem; color: #c4b5fd; }
  .section p { margin-bottom: 0.75rem; color: #a1a1aa; }
  .flow { display: flex; align-items: center; justify-content: center; gap: 0.5rem; flex-wrap: wrap; padding: 1.5rem 0; margin: 1rem 0; }
  .flow .node { background: #1e1e2e; border: 1px solid #3b3b50; padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.9rem; }
  .flow .arrow { color: #60a5fa; font-size: 1.2rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; }
  .card { background: #111118; border: 1px solid #1e1e2e; border-radius: 12px; padding: 1.25rem; }
  .card h4 { color: #60a5fa; font-size: 0.95rem; margin-bottom: 0.3rem; }
  .card p { font-size: 0.85rem; color: #71717a; margin: 0; }
  .skill-banner { background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); border: 1px solid #312e81; border-radius: 12px; padding: 1.5rem 2rem; margin: 2rem 0; text-align: center; }
  .skill-banner h3 { color: #a5b4fc; font-size: 1.1rem; margin-bottom: 0.5rem; }
  .skill-banner p { color: #818cf8; font-size: 0.9rem; margin-bottom: 1rem; }
  .skill-banner .url { font-family: monospace; background: #0f0f23; padding: 0.5rem 1rem; border-radius: 6px; color: #c4b5fd; font-size: 0.85rem; display: inline-block; }
  footer { max-width: 720px; margin: 0 auto; padding: 2rem; text-align: center; color: #52525b; font-size: 0.8rem; border-top: 1px solid #1e1e2e; }
  @media (max-width: 600px) { .hero h1 { font-size: 2rem; } .grid { grid-template-columns: 1fr; } }
</style></head><body>
<div class="hero">
  <h1>⚡ <span>LiteHub</span></h1>
  <p class="tagline">Lightweight Agent Collaboration Hub</p>
  <div class="badges">
    <span class="badge">Turso / SQLite</span>
    <span class="badge">Vercel Edge</span>
    <span class="badge">Open Source</span>
  </div>
</div>
<div class="section">
  <h2>What is LiteHub?</h2>
  <p>LiteHub is a lightweight hub that lets <strong>distributed AI agents collaborate through named queues</strong>. Think of it as a water pipe system — agents produce data into queues, and other agents consume from those queues, forming processing pipelines.</p>
  <p>Powered by <a href="https://turso.tech">Turso</a> (distributed SQLite) on Vercel Edge.</p>
</div>
<div class="section">
  <h2>Quick Start</h2>
  <h3>1. Register an Agent</h3>
<pre>curl -X POST ${baseUrl}/api/agent/register \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"searcher","name":"Search Agent","role":"producer","queues":["raw"]}'</pre>
  <h3>2. Produce Data</h3>
<pre>curl -X POST ${baseUrl}/api/agent/produce \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"searcher","queue":"raw","data":"Found: ..."}'</pre>
</div>
<footer>LiteHub is open source · <a href="https://github.com/mimowen/litehub">GitHub</a> · MIT License</footer>
</body></html>`);
});

// ─── Skill Endpoint ───────────────────────────────────────────────────────

app.get("/skill", async (c) => {
  return c.text(`# LiteHub Skill (Vercel/Turso)

## Setup

Set environment variables:
- TURSO_URL or TURSO_DATABASE_URL
- TURSO_AUTH_TOKEN (optional for local development)

## API

### Register Agent
\`\`\`bash
curl -X POST \${LITEHUB_URL}/api/agent/register \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"my-agent","name":"My Agent","role":"both","queues":["input","output"]}'
\`\`\`

### Produce
\`\`\`bash
curl -X POST \${LITEHUB_URL}/api/agent/produce \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"my-agent","queue":"input","data":"content"}'
\`\`\`

### Consume
\`\`\`bash
curl -X POST \${LITEHUB_URL}/api/agent/consume \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"my-agent","queue":"input"}'
\`\`\`

### Pipe
\`\`\`bash
curl -X POST \${LITEHUB_URL}/api/agent/pipe \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"my-agent","sourceQueue":"input","targetQueue":"output","data":"processed"}'
\`\`\`
`, 200, { "Content-Type": "text/markdown" });
});

// ─── Agent API ─────────────────────────────────────────────────────────────

app.post("/api/agent/register", async (c) => {
  await initDb();
  const body = await c.req.json();
  const { agentId, name, role, queues, pollInterval } = body;
  if (!agentId || !name || !role || !queues?.length) {
    return c.json({ ok: false, error: "Missing required fields: agentId, name, role, queues" }, 400);
  }

  const db = getTurso();
  await db.execute({
    sql: `INSERT OR REPLACE INTO agents (agent_id, name, role, queues, poll_interval, registered_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    args: [agentId, name, role, JSON.stringify(queues), pollInterval || 0],
  });

  // Ensure queues exist
  for (const q of queues) {
    await db.execute({ sql: `INSERT OR IGNORE INTO queues (name) VALUES (?)`, args: [q] });
  }

  return c.json({ ok: true, agent: { agentId, name, role, queues, pollInterval, registeredAt: new Date().toISOString() } });
});

app.get("/api/agents", async (c) => {
  await initDb();
  const db = getTurso();
  const result = await db.execute("SELECT * FROM agents ORDER BY registered_at");
  const agents = result.rows.map((r: any) => ({
    agentId: r.agent_id,
    name: r.name,
    role: r.role,
    queues: JSON.parse(r.queues || "[]"),
    pollInterval: r.poll_interval,
    registeredAt: r.registered_at,
  }));
  return c.json({ ok: true, agents });
});

// ─── Produce / Consume / Pipe ──────────────────────────────────────────────

app.post("/api/agent/produce", async (c) => {
  await initDb();
  const body = await c.req.json();
  const { agentId, queue, data, contentType, metadata } = body;
  if (!agentId || !queue || data === undefined) {
    return c.json({ ok: false, error: "Missing required fields: agentId, queue, data" }, 400);
  }

  const db = getTurso();
  await db.execute({ sql: `INSERT OR IGNORE INTO queues (name) VALUES (?)`, args: [queue] });

  const id = crypto.randomUUID();
  const text = String(data);
  await db.execute({
    sql: `INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, queue, agentId, text, text.length, contentType || "text/plain", JSON.stringify(metadata || {})],
  });

  return c.json({ ok: true, pointer: { id, queue, size: text.length, producerId: agentId, createdAt: new Date().toISOString() } });
});

app.post("/api/agent/consume", async (c) => {
  await initDb();
  const body = await c.req.json();
  const { agentId, queue, maxItems } = body;
  if (!agentId || !queue) {
    return c.json({ ok: false, error: "Missing required fields: agentId, queue" }, 400);
  }

  const db = getTurso();
  const result = await db.execute({
    sql: `SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT ?`,
    args: [queue, maxItems || 1],
  });

  const items = [];
  for (const row of result.rows) {
    await db.execute({
      sql: `UPDATE pointers SET status = 'consumed' WHERE id = ?`,
      args: [row.id],
    });
    const buf = Buffer.from(row.data as string, "utf-8");
    items.push({
      pointer: {
        id: row.id,
        queue: row.queue,
        size: row.size,
        producerId: row.producer_id,
        contentType: row.content_type,
        metadata: JSON.parse((row.metadata as string) || "{}"),
        createdAt: row.created_at,
      },
      data: buf.toString("base64"),
      text: buf.toString("utf-8"),
    });
  }

  return c.json({ ok: true, items });
});

app.post("/api/agent/pipe", async (c) => {
  await initDb();
  const body = await c.req.json();
  const { agentId, sourceQueue, targetQueue, data, contentType, metadata } = body;
  if (!agentId || !sourceQueue || !targetQueue || data === undefined) {
    return c.json({ ok: false, error: "Missing required fields: agentId, sourceQueue, targetQueue, data" }, 400);
  }

  const db = getTurso();
  const srcResult = await db.execute({
    sql: `SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT 1`,
    args: [sourceQueue],
  });

  if (srcResult.rows.length === 0) {
    return c.json({ ok: false, error: "Source queue is empty" }, 404);
  }

  const srcRow = srcResult.rows[0];
  await db.execute({ sql: `UPDATE pointers SET status = 'consumed' WHERE id = ?`, args: [srcRow.id] });

  const id = crypto.randomUUID();
  const text = String(data);
  await db.execute({ sql: `INSERT OR IGNORE INTO queues (name) VALUES (?)`, args: [targetQueue] });
  await db.execute({
    sql: `INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, targetQueue, agentId, text, text.length, contentType || "text/plain",
      JSON.stringify({ ...metadata, sourcePointerId: srcRow.id, sourceQueue })],
  });

  return c.json({ ok: true, input: { id: srcRow.id }, output: { id, queue: targetQueue } });
});

// ─── Queue API ─────────────────────────────────────────────────────────────

app.get("/api/queues", async (c) => {
  await initDb();
  const db = getTurso();
  const result = await db.execute("SELECT * FROM queues ORDER BY created_at");
  const queues = [];
  for (const q of result.rows) {
    const p = await db.execute({ sql: `SELECT COUNT(*) as c FROM pointers WHERE queue = ? AND status = 'pending'`, args: [q.name] });
    const d = await db.execute({ sql: `SELECT COUNT(*) as c FROM pointers WHERE queue = ? AND status = 'consumed'`, args: [q.name] });
    queues.push({
      name: q.name,
      description: q.description,
      pending: (p.rows[0] as any).c,
      consumed: (d.rows[0] as any).c,
      createdAt: q.created_at,
    });
  }
  return c.json({ ok: true, queues });
});

app.get("/api/peek", async (c) => {
  await initDb();
  const queue = c.req.query("queue");
  if (!queue) return c.json({ ok: false, error: "Missing query: queue" }, 400);

  const db = getTurso();
  const result = await db.execute({
    sql: `SELECT id, queue, size, producer_id, content_type, metadata, created_at FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT 1`,
    args: [queue],
  });

  if (result.rows.length === 0) {
    return c.json({ ok: false, error: "Queue is empty" }, 404);
  }

  const r = result.rows[0] as any;
  return c.json({
    ok: true,
    pointer: {
      id: r.id,
      queue: r.queue,
      size: r.size,
      producerId: r.producer_id,
      contentType: r.content_type,
      metadata: JSON.parse(r.metadata || "{}"),
      createdAt: r.created_at,
    },
  });
});

// ─── Dashboard ─────────────────────────────────────────────────────────────

app.get("/dashboard", async (c) => {
  await initDb();
  const db = getTurso();

  const agentsResult = await db.execute("SELECT * FROM agents ORDER BY registered_at");
  const agents = agentsResult.rows.map((r: any) => ({
    agentId: r.agent_id,
    name: r.name,
    role: r.role,
    queues: JSON.parse(r.queues || "[]"),
    registeredAt: r.registered_at,
  }));

  const queuesResult = await db.execute("SELECT * FROM queues ORDER BY created_at");
  const queues = [];
  for (const q of queuesResult.rows) {
    const p = await db.execute({ sql: `SELECT COUNT(*) as c FROM pointers WHERE queue = ? AND status = 'pending'`, args: [q.name] });
    const d = await db.execute({ sql: `SELECT COUNT(*) as c FROM pointers WHERE queue = ? AND status = 'consumed'`, args: [q.name] });
    queues.push({
      name: q.name,
      pending: (p.rows[0] as any).c,
      consumed: (d.rows[0] as any).c,
      createdAt: q.created_at,
    });
  }

  const agentRows = agents.map((a: any) => `
    <tr><td>${a.agentId}</td><td>${a.name}</td><td>${a.role}</td>
    <td>${a.queues.join(", ")}</td><td>${a.registeredAt}</td></tr>`).join("") || '<tr><td colspan="5" style="color:#888">No agents</td></tr>';

  const queueRows = queues.map((q: any) => `
    <tr><td>${q.name}</td><td>${q.pending}</td><td>${q.consumed}</td><td>${q.createdAt}</td></tr>`).join("") || '<tr><td colspan="4" style="color:#888">No queues</td></tr>';

  return c.html(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>LiteHub Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 2rem; }
  h1 { color: #60a5fa; margin-bottom: 0.5rem; font-size: 1.8rem; }
  h2 { color: #a78bfa; margin: 1.5rem 0 0.5rem; font-size: 1.2rem; }
  p.sub { color: #888; margin-bottom: 2rem; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
  th { text-align: left; padding: 0.5rem 0.75rem; background: #1a1a2e; color: #60a5fa; font-size: 0.85rem; }
  td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #1a1a2e; font-size: 0.85rem; }
  tr:hover td { background: #111827; }
  .stats { display: flex; gap: 1rem; margin-bottom: 2rem; }
  .stat { background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 1rem 1.5rem; flex: 1; text-align: center; }
  .stat .num { font-size: 2rem; font-weight: bold; color: #60a5fa; }
  .stat .label { font-size: 0.8rem; color: #94a3b8; }
</style></head><body>
<h1>⚡ LiteHub Dashboard</h1>
<p class="sub">Agent & Queue Status · <a href="/" style="color:#a78bfa">← Back to Home</a></p>
<div class="stats">
  <div class="stat"><div class="num">${agents.length}</div><div class="label">Agents</div></div>
  <div class="stat"><div class="num">${queues.length}</div><div class="label">Queues</div></div>
  <div class="stat"><div class="num">${queues.reduce((s: number, q: any) => s + q.pending, 0)}</div><div class="label">Pending</div></div>
  <div class="stat"><div class="num">${queues.reduce((s: number, q: any) => s + q.consumed, 0)}</div><div class="label">Consumed</div></div>
</div>
<h2>Agents</h2>
<table><tr><th>ID</th><th>Name</th><th>Role</th><th>Queues</th><th>Registered</th></tr>${agentRows}</table>
<h2>Queues</h2>
<table><tr><th>Name</th><th>Pending</th><th>Consumed</th><th>Created</th></tr>${queueRows}</table>
</body></html>`);
});

export default app;
