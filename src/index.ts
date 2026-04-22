// src/index.ts — Hono 主入口
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import {
  registerAgent, getAgent, listAgents,
  ensureQueue, getQueueStatus, listQueues,
  produce, consume, peek, pipe,
} from "./lib/queue";

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

// ─── Dashboard HTML ────────────────────────────────────────────────────────

app.get("/", (c) => {
  const agents = listAgents();
  const queues = listQueues();

  const agentRows = agents.map(a => `
    <tr>
      <td>${a.agentId}</td><td>${a.name}</td><td>${a.role}</td>
      <td>${a.queues.join(", ")}</td><td>${a.registeredAt}</td>
    </tr>`).join("") || '<tr><td colspan="5" style="color:#888">暂无 Agent</td></tr>';

  const queueRows = queues.map(q => `
    <tr>
      <td>${q.name}</td><td>${q.pending}</td><td>${q.consumed}</td><td>${q.createdAt}</td>
    </tr>`).join("") || '<tr><td colspan="4" style="color:#888">暂无队列</td></tr>';

  return c.html(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>LiteHub</title>
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
  .api-box { background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 1rem; margin-bottom: 0.5rem; }
  .api-box code { color: #34d399; font-size: 0.85rem; }
  .api-box .desc { color: #94a3b8; font-size: 0.8rem; margin-top: 0.25rem; }
  .stats { display: flex; gap: 1rem; margin-bottom: 2rem; }
  .stat { background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 1rem 1.5rem; flex: 1; text-align: center; }
  .stat .num { font-size: 2rem; font-weight: bold; color: #60a5fa; }
  .stat .label { font-size: 0.8rem; color: #94a3b8; }
</style></head><body>
<h1>⚡ LiteHub</h1>
<p class="sub">轻量级 Agent 协作枢纽 — 数据像水一样在 Agent 之间流动</p>

<div class="stats">
  <div class="stat"><div class="num">${agents.length}</div><div class="label">Agents</div></div>
  <div class="stat"><div class="num">${queues.length}</div><div class="label">Queues</div></div>
  <div class="stat"><div class="num">${queues.reduce((s, q) => s + q.pending, 0)}</div><div class="label">Pending</div></div>
  <div class="stat"><div class="num">${queues.reduce((s, q) => s + q.consumed, 0)}</div><div class="label">Consumed</div></div>
</div>

<h2>Agents</h2>
<table><tr><th>ID</th><th>Name</th><th>Role</th><th>Queues</th><th>Registered</th></tr>${agentRows}</table>

<h2>Queues</h2>
<table><tr><th>Name</th><th>Pending</th><th>Consumed</th><th>Created</th></tr>${queueRows}</table>

<h2>API</h2>
<div class="api-box"><code>POST /api/agent/register</code><div class="desc">注册 Agent {agentId, name, role, queues}</div></div>
<div class="api-box"><code>POST /api/agent/produce</code><div class="desc">生产数据 {agentId, queue, data}</div></div>
<div class="api-box"><code>POST /api/agent/consume</code><div class="desc">消费数据 {agentId, queue, maxItems?}</div></div>
<div class="api-box"><code>POST /api/agent/pipe</code><div class="desc">链式传递 {agentId, sourceQueue, targetQueue, data}</div></div>
<div class="api-box"><code>GET  /api/queues</code><div class="desc">列出所有队列状态</div></div>
<div class="api-box"><code>GET  /api/peek?queue=name</code><div class="desc">窥探队首（不出队）</div></div>
<div class="api-box"><code>GET  /api/agents</code><div class="desc">列出所有 Agent</div></div>
</body></html>`);
});

// ─── Agent API ─────────────────────────────────────────────────────────────

app.post("/api/agent/register", async (c) => {
  const body = await c.req.json();
  const { agentId, name, role, queues, pollInterval } = body;
  if (!agentId || !name || !role || !queues?.length) {
    return c.json({ ok: false, error: "缺少必填字段: agentId, name, role, queues" }, 400);
  }
  const agent = registerAgent({ agentId, name, role, queues, pollInterval });
  return c.json({ ok: true, agent });
});

app.get("/api/agents", (c) => {
  return c.json({ ok: true, agents: listAgents() });
});

// ─── Produce / Consume / Pipe ──────────────────────────────────────────────

app.post("/api/agent/produce", async (c) => {
  const body = await c.req.json();
  const { agentId, queue, data, contentType, metadata } = body;
  if (!agentId || !queue || data === undefined) {
    return c.json({ ok: false, error: "缺少必填字段: agentId, queue, data" }, 400);
  }
  const pointer = produce(queue, String(data), agentId, { contentType, metadata });
  return c.json({ ok: true, pointer });
});

app.post("/api/agent/consume", async (c) => {
  const body = await c.req.json();
  const { agentId, queue, maxItems } = body;
  if (!agentId || !queue) {
    return c.json({ ok: false, error: "缺少必填字段: agentId, queue" }, 400);
  }
  const items = consume(queue, agentId, maxItems || 1);
  return c.json({ ok: true, items });
});

app.post("/api/agent/pipe", async (c) => {
  const body = await c.req.json();
  const { agentId, sourceQueue, targetQueue, data, contentType, metadata } = body;
  if (!agentId || !sourceQueue || !targetQueue || data === undefined) {
    return c.json({ ok: false, error: "缺少必填字段: agentId, sourceQueue, targetQueue, data" }, 400);
  }
  const result = pipe(sourceQueue, targetQueue, agentId, String(data), { contentType, metadata });
  if (!result) return c.json({ ok: false, error: "源队列无数据" }, 404);
  return c.json({ ok: true, input: result.input, output: result.output });
});

// ─── Queue API ─────────────────────────────────────────────────────────────

app.get("/api/queues", (c) => {
  return c.json({ ok: true, queues: listQueues() });
});

app.get("/api/peek", (c) => {
  const queue = c.req.query("queue");
  if (!queue) return c.json({ ok: false, error: "缺少 query: queue" }, 400);
  const pointer = peek(queue);
  if (!pointer) return c.json({ ok: false, error: "队列为空或不存在" }, 404);
  return c.json({ ok: true, pointer });
});

// ─── Start ─────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`⚡ LiteHub running on http://localhost:${info.port}`);
});
