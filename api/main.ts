// api/main.ts — LiteHub Vercel 唯一入口
// 强制开启 Edge Runtime，解决 Node.js 环境下的超时和兼容问题
export const config = {
  runtime: 'edge',
};

// vercel.json rewrites 将所有 /api/* 路由到这里
// 所有逻辑内聚于此文件 + vercel-db.ts，确保 Vercel 打包时完整包含

import { getDb, validateAuth, json, body } from "./vercel-db";
import type { Client } from "@libsql/client/http";

// ─── CORS ──────────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ─── Pattern-based route matcher ──────────────────────────────────────────
// Matches a path pattern against an actual path, extracting named parameters.
// e.g. matchRoute("a2a/tasks/{id}", "a2a/tasks/abc123") → { matched: true, params: { id: "abc123" } }
function matchRoute(pattern: string, path: string): { matched: boolean; params: Record<string, string> } {
  const pParts = pattern.split("/");
  const pathParts = path.split("/");
  if (pParts.length !== pathParts.length) return { matched: false, params: {} };
  const params: Record<string, string> = {};
  for (let i = 0; i < pParts.length; i++) {
    if (pParts[i].startsWith("{") && pParts[i].endsWith("}")) {
      params[pParts[i].slice(1, -1)] = pathParts[i];
    } else if (pParts[i] !== pathParts[i]) {
      return { matched: false, params: {} };
    }
  }
  return { matched: true, params };
}

// Route definitions with patterns (order matters — most specific first)
interface RouteEntry {
  pattern: string;   // e.g. "a2a/tasks/{id}"
  handler: Handler;
  auth: boolean;
}

// Build sorted route list (longer patterns first to avoid partial matches)
const ROUTE_ENTRIES: RouteEntry[] = [
  // A2A
  { pattern: "a2a/tasks/{id}",      handler: handleA2AGetTask,       auth: false },
  { pattern: "a2a/tasks",           handler: handleA2ATasks,         auth: false  },
  { pattern: "a2a/tasks/cancel",    handler: handleA2ACancelTask,    auth: true  },
  { pattern: "a2a/tasks/pushNotificationConfig/set", handler: handleA2ASetPushNotification, auth: true },
  // ACP
  { pattern: "acp/runs/{id}/stream", handler: handleACPRunStream,     auth: false },
  { pattern: "acp/runs/{id}",       handler: handleACPGetRun,        auth: false },
  { pattern: "acp/contexts/{id}/messages", handler: handleACPGetContextMessages, auth: false },
  { pattern: "acp/contexts/{id}/join",  handler: handleACPJoinContext,  auth: true },
  { pattern: "acp/contexts/{id}/leave", handler: handleACPLeaveContext, auth: true },
  { pattern: "acp/contexts/{id}/speak", handler: handleACPSpeakContext, auth: true },
  { pattern: "acp/contexts/{id}",   handler: handleACPGetContext,    auth: false },
  { pattern: "acp/agents/{agentId}", handler: handleACPAgents,       auth: false },
  { pattern: "acp/runs",            handler: handleACPRuns,          auth: false  },
  { pattern: "acp/runs/cancel",     handler: handleACPCancelRun,     auth: true  },
  { pattern: "acp/contexts",        handler: handleACPContexts,      auth: false  },
  { pattern: "acp/contexts/join",   handler: handleACPJoinContext,   auth: true  },
  { pattern: "acp/contexts/leave",  handler: handleACPLeaveContext,  auth: true  },
  { pattern: "acp/agents",          handler: handleACPAgents,        auth: false },
  { pattern: "acp/contexts/messages", handler: handleACPGetMessages, auth: false },
  // Pool
  { pattern: "pool/messages",        handler: handlePoolMessages,    auth: false },
  { pattern: "pool/members",        handler: handlePoolMembers,     auth: false },
  { pattern: "pool/create",         handler: handlePoolCreate,      auth: true  },
  { pattern: "pool/join",           handler: handlePoolJoin,        auth: true  },
  { pattern: "pool/leave",          handler: handlePoolLeave,       auth: true  },
  { pattern: "pool/speak",          handler: handlePoolSpeak,       auth: true  },
  // Agent
  { pattern: "agent/register",      handler: handleAgentRegister,   auth: false },
  { pattern: "agent/produce",       handler: handleProduce,         auth: true  },
  { pattern: "agent/consume",       handler: handleConsume,         auth: true  },
  { pattern: "agent/pipe",          handler: handlePipe,            auth: true  },
  // Public
  { pattern: "",                    handler: handleIndex,           auth: false },
  { pattern: "/",                   handler: handleIndex,           auth: false },
  { pattern: "agents",             handler: handleAgents,          auth: false },
  { pattern: "queues",             handler: handleQueues,          auth: false },
  { pattern: "pools",              handler: handlePools,           auth: false },
  { pattern: "peek",               handler: handlePeek,            auth: false },
  { pattern: "skill",              handler: handleSkill,           auth: false },
  { pattern: "skills",             handler: handleSkill,           auth: false },
  { pattern: "dashboard",          handler: handleDashboard,       auth: false },
  { pattern: "mcp",                handler: handleMcpConfig,       auth: false },
  { pattern: ".well-known/agent-card.json", handler: handleAgentCard, auth: false },
];

function findHandler(path: string): { handler: Handler; auth: boolean; params: Record<string, string> } | null {
  for (const entry of ROUTE_ENTRIES) {
    const { matched, params } = matchRoute(entry.pattern, path);
    if (matched) return { handler: entry.handler, auth: entry.auth, params };
  }
  return null;
}

// ─── Route handlers ────────────────────────────────────────────────────────

// 校验 Agent 是否已注册
async function ensureAgent(db: Client, agentId: string): Promise<Response | null> {
  if (!agentId) return json({ ok: false, error: "Missing agentId" }, 400);
  const rs = await db.execute({ sql: "SELECT agent_id FROM agents WHERE agent_id = ?", args: [agentId] });
  if (rs.rows.length === 0) return json({ ok: false, error: "Agent not registered. Call litehub_register first." }, 403);
  return null; // null = 校验通过
}

// GET /api
async function handleIndex(_req: Request): Promise<Response> {
  return json({
    ok: true, name: "LiteHub", version: "2.0.0",
    endpoints: { agents: "/api/agents", queues: "/api/queues", pools: "/api/pools", dashboard: "/api/dashboard", skill: "/api/skill", mcp: "/api/mcp" },
  });
}

// GET /api/agents
async function handleAgents(_req: Request): Promise<Response> {
  const db = await getDb();
  const rs = await db.execute("SELECT * FROM agents ORDER BY registered_at DESC");
  const agents = rs.rows.map((r: any) => ({
    agentId: r.agent_id, name: r.name, role: r.role,
    queues: JSON.parse(r.queues || "[]"), pollInterval: r.poll_interval, registeredAt: r.registered_at,
  }));
  return json({ ok: true, agents });
}

// GET /api/queues
async function handleQueues(_req: Request): Promise<Response> {
  const db = await getDb();
  const rs = await db.execute("SELECT q.name, q.description, q.creator_id, q.created_at, COUNT(p.id) as pending FROM queues q LEFT JOIN pointers p ON q.name = p.queue AND p.status = 'pending' GROUP BY q.name ORDER BY q.name");
  const queues = rs.rows.map((r: any) => ({ name: r.name, description: r.description, creatorId: r.creator_id, pending: r.pending, createdAt: r.created_at }));
  return json({ ok: true, queues });
}

// GET /api/pools
async function handlePools(_req: Request): Promise<Response> {
  const db = await getDb();
  const rs = await db.execute(`
    SELECT p.*, COUNT(pm.agent_id) as member_count
    FROM pools p LEFT JOIN pool_members pm ON p.name = pm.pool
    GROUP BY p.name ORDER BY p.created_at DESC
  `);
  const pools = rs.rows.map((r: any) => ({
    name: r.name, description: r.description, guidelines: r.guidelines,
    maxMembers: r.max_members, memberCount: r.member_count, creatorId: r.creator_id, createdAt: r.created_at,
  }));
  return json({ ok: true, pools });
}

// GET /api/peek?queue=name
async function handlePeek(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const queue = url.searchParams.get("queue");
  if (!queue) return json({ ok: false, error: "Missing queue" }, 400);
  const limit = parseInt(url.searchParams.get("limit") || "10");
  const db = await getDb();
  // 校验队列是否存在
  const qRs = await db.execute({ sql: "SELECT name FROM queues WHERE name = ?", args: [queue] });
  if (qRs.rows.length === 0) return json({ ok: false, error: "Queue not found. Create it during registration first." }, 404);
  const rs = await db.execute({
    sql: "SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at ASC LIMIT ?",
    args: [queue, limit],
  });
  const pointers = rs.rows.map((r: any) => ({
    id: r.id, queue: r.queue, producerId: r.producer_id, data: r.data,
    size: r.size, contentType: r.content_type, metadata: JSON.parse(r.metadata || "{}"),
    status: r.status, lineage: JSON.parse(r.lineage || "[]"), createdAt: r.created_at,
  }));
  return json({ ok: true, queue, pointers });
}

// POST /api/agent/register
async function handleAgentRegister(req: Request): Promise<Response> {
  const b = await body(req);
  const { agentId, name, role, queues, pools, pollInterval } = b;
  if (!agentId || !name || !role) return json({ ok: false, error: "Missing required fields: agentId, name, role" }, 400);
  const db = await getDb();

  // 注册 Agent
  const queueNames: string[] = [];
  if (Array.isArray(queues)) {
    for (const q of queues) {
      if (typeof q === "string") {
        queueNames.push(q);
      } else if (q && q.name) {
        queueNames.push(q.name);
      }
    }
  }
  await db.execute({
    sql: "INSERT OR REPLACE INTO agents (agent_id, name, role, queues, poll_interval) VALUES (?, ?, ?, ?, ?)",
    args: [agentId, name, role, JSON.stringify(queueNames), pollInterval || 0],
  });

  // 注册阶段自动创建队列（带 description + creator_id）
  const createdQueues: string[] = [];
  if (Array.isArray(queues)) {
    for (const q of queues) {
      const qName = typeof q === "string" ? q : q.name;
      const qDesc = typeof q === "string" ? "" : (q.description || "");
      if (!qName) continue;
      try {
        await db.execute({
          sql: "INSERT OR IGNORE INTO queues (name, description, creator_id) VALUES (?, ?, ?)",
          args: [qName, qDesc, agentId],
        });
        createdQueues.push(qName);
      } catch { /* 忽略重复 */ }
    }
  }

  // 注册阶段自动创建 Pool（带 description + creator_id）
  const createdPools: string[] = [];
  if (Array.isArray(pools)) {
    for (const p of pools) {
      if (!p.name) continue;
      const defaultGuidelines = "You are a collaborative agent in this Pool. Share progress transparently. Reference others' work. Do not command other agents.";
      try {
        await db.execute({
          sql: "INSERT OR IGNORE INTO pools (name, description, guidelines, max_members, creator_id) VALUES (?, ?, ?, ?, ?)",
          args: [p.name, p.description || "", p.guidelines || defaultGuidelines, p.maxMembers || 20, agentId],
        });
        createdPools.push(p.name);
      } catch { /* 忽略重复 */ }
    }
  }

  return json({ ok: true, agentId, createdQueues, createdPools });
}

// POST /api/agent/produce
async function handleProduce(req: Request): Promise<Response> {
  const b = await body(req);
  const { queue, agentId, data, contentType, metadata, lineage } = b;
  if (!queue || !agentId || data === undefined) return json({ ok: false, error: "Missing required fields: queue, agentId, data" }, 400);
  const db = await getDb();
  const agentErr = await ensureAgent(db, agentId);
  if (agentErr) return agentErr;
  // 校验队列是否存在
  const qRs = await db.execute({ sql: "SELECT name FROM queues WHERE name = ?", args: [queue] });
  if (qRs.rows.length === 0) return json({ ok: false, error: "Queue not found. Create it during registration first." }, 404);
  const id = crypto.randomUUID();
  const size = new Blob([data]).size;
  await db.execute({
    sql: `INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata, lineage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, queue, agentId, data, size, contentType || "text/plain", JSON.stringify(metadata || {}), JSON.stringify(lineage || [])],
  });
  // Fire push notifications (non-blocking)
  notifySubscribers("queue", queue, "message_produced", { pointerId: id, producerId: agentId }).catch(() => {});
  return json({ ok: true, id, queue });
}

// POST /api/agent/consume
async function handleConsume(req: Request): Promise<Response> {
  const b = await body(req);
  const { queue, agentId } = b;
  if (!queue || !agentId) return json({ ok: false, error: "Missing queue or agentId" }, 400);
  const db = await getDb();
  const agentErr = await ensureAgent(db, agentId);
  if (agentErr) return agentErr;
  // 校验队列是否存在
  const qRs = await db.execute({ sql: "SELECT name FROM queues WHERE name = ?", args: [queue] });
  if (qRs.rows.length === 0) return json({ ok: false, error: "Queue not found. Create it during registration first." }, 404);
  const rs = await db.execute({
    sql: "SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 10",
    args: [queue],
  });
  for (const row of rs.rows as any[]) {
    const lineage: string[] = JSON.parse(row.lineage || "[]");
    if (lineage.includes(agentId)) {
      await db.execute({ sql: "UPDATE pointers SET status = 'looped' WHERE id = ?", args: [row.id] });
      continue;
    }
    await db.execute({ sql: "UPDATE pointers SET status = 'consumed' WHERE id = ?", args: [row.id] });
    // Fire push notifications (non-blocking)
    notifySubscribers("queue", queue, "message_consumed", { pointerId: row.id, consumerId: agentId }).catch(() => {});
    return json({
      ok: true,
      pointer: {
        id: row.id, queue: row.queue, producerId: row.producer_id, data: row.data,
        size: row.size, contentType: row.content_type, metadata: JSON.parse(row.metadata || "{}"), lineage,
      },
    });
  }
  return json({ ok: true, pointer: null });
}

// POST /api/agent/pipe
async function handlePipe(req: Request): Promise<Response> {
  const b = await body(req);
  const { pointerId, targetQueue, agentId } = b;
  if (!pointerId || !targetQueue) return json({ ok: false, error: "Missing pointerId or targetQueue" }, 400);
  const db = await getDb();
  if (agentId) {
    const agentErr = await ensureAgent(db, agentId);
    if (agentErr) return agentErr;
  }
  const rs = await db.execute({ sql: "SELECT * FROM pointers WHERE id = ?", args: [pointerId] });
  if (rs.rows.length === 0) return json({ ok: false, error: "Pointer not found" }, 404);
  const row = rs.rows[0] as any;
  const newId = crypto.randomUUID();
  const lineage = JSON.parse(row.lineage || "[]");
  if (agentId && !lineage.includes(agentId)) lineage.push(agentId);
  await db.execute({
    sql: `INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata, lineage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [newId, targetQueue, row.producer_id, row.data, row.size, row.content_type, row.metadata, JSON.stringify(lineage)],
  });
  return json({ ok: true, id: newId, queue: targetQueue });
}

// POST /api/pool/create
async function handlePoolCreate(req: Request): Promise<Response> {
  const b = await body(req);
  const { name, description, guidelines, maxMembers, agentId } = b;
  if (!name) return json({ ok: false, error: "Missing name" }, 400);
  if (!description) return json({ ok: false, error: "Missing description — please describe what this Pool is for" }, 400);
  const defaultGuidelines = "You are a collaborative agent in this Pool. Share progress transparently. Reference others' work. Do not command other agents.";
  const db = await getDb();
  await db.execute({
    sql: "INSERT OR REPLACE INTO pools (name, description, guidelines, max_members, creator_id) VALUES (?, ?, ?, ?, ?)",
    args: [name, description, guidelines || defaultGuidelines, maxMembers || 20, agentId || ""],
  });
  notifySubscribers("pool", name, "pool_created", { creatorId: agentId }).catch(() => {});
  return json({ ok: true, name });
}

// POST /api/pool/join
async function handlePoolJoin(req: Request): Promise<Response> {
  const b = await body(req);
  const { pool, agentId } = b;
  if (!pool || !agentId) return json({ ok: false, error: "Missing pool or agentId" }, 400);
  const db = await getDb();
  const agentErr = await ensureAgent(db, agentId);
  if (agentErr) return agentErr;
  const poolRs = await db.execute({ sql: "SELECT max_members FROM pools WHERE name = ?", args: [pool] });
  if (poolRs.rows.length === 0) return json({ ok: false, error: "Pool not found" }, 404);
  const maxMembers = (poolRs.rows[0] as any).max_members;
  const countRs = await db.execute({ sql: "SELECT COUNT(*) as count FROM pool_members WHERE pool = ?", args: [pool] });
  if ((countRs.rows[0] as any).count >= maxMembers) return json({ ok: false, error: "Pool is full" }, 403);
  await db.execute({ sql: "INSERT OR IGNORE INTO pool_members (pool, agent_id) VALUES (?, ?)", args: [pool, agentId] });
  return json({ ok: true });
}

// POST /api/pool/leave
async function handlePoolLeave(req: Request): Promise<Response> {
  const b = await body(req);
  const { pool, agentId } = b;
  if (!pool || !agentId) return json({ ok: false, error: "Missing pool or agentId" }, 400);
  const db = await getDb();
  const agentErr = await ensureAgent(db, agentId);
  if (agentErr) return agentErr;
  await db.execute({ sql: "DELETE FROM pool_members WHERE pool = ? AND agent_id = ?", args: [pool, agentId] });
  return json({ ok: true });
}

// POST /api/pool/speak
async function handlePoolSpeak(req: Request): Promise<Response> {
  const b = await body(req);
  const { pool, agentId, content, replyTo, tags, metadata } = b;
  if (!pool || !agentId || !content) return json({ ok: false, error: "Missing required fields" }, 400);
  const db = await getDb();
  const agentErr = await ensureAgent(db, agentId);
  if (agentErr) return agentErr;
  // 校验 Pool 是否存在
  const poolRs = await db.execute({ sql: "SELECT name FROM pools WHERE name = ?", args: [pool] });
  if (poolRs.rows.length === 0) return json({ ok: false, error: "Pool not found" }, 404);
  const id = crypto.randomUUID();
  await db.execute({
    sql: "INSERT INTO pool_messages (id, pool, agent_id, content, reply_to, tags, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [id, pool, agentId, content, replyTo || null, JSON.stringify(tags || []), JSON.stringify(metadata || {})],
  });
  // Fire push notifications for pool messages (non-blocking)
  notifySubscribers("pool", pool, "message_sent", { messageId: id, senderId: agentId }).catch(() => {});
  return json({ ok: true, id });
}

// GET /api/pool/messages?pool=name
async function handlePoolMessages(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pool = url.searchParams.get("pool");
  if (!pool) return json({ ok: false, error: "Missing pool" }, 400);
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const since = url.searchParams.get("since");
  const tag = url.searchParams.get("tag");
  const db = await getDb();
  let sql = "SELECT * FROM pool_messages WHERE pool = ?";
  const args: any[] = [pool];
  if (since) { sql += " AND created_at > ?"; args.push(since); }
  if (tag) { sql += " AND tags LIKE ?"; args.push(`%"${tag}"%`); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  args.push(limit);
  const rs = await db.execute({ sql, args });
  const messages = rs.rows.map((r: any) => ({
    id: r.id, pool: r.pool, agentId: r.agent_id, content: r.content,
    replyTo: r.reply_to, tags: JSON.parse(r.tags || "[]"),
    metadata: JSON.parse(r.metadata || "{}"), createdAt: r.created_at,
  }));
  const poolRs = await db.execute({ sql: "SELECT guidelines FROM pools WHERE name = ?", args: [pool] });
  const guidelines = poolRs.rows.length > 0 ? (poolRs.rows[0] as any).guidelines : "";
  return json({ ok: true, pool, guidelines, messages });
}

// GET /api/pool/members?pool=name
async function handlePoolMembers(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pool = url.searchParams.get("pool");
  if (!pool) return json({ ok: false, error: "Missing pool" }, 400);
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT agent_id, joined_at FROM pool_members WHERE pool = ? ORDER BY joined_at", args: [pool] });
  const members = rs.rows.map((r: any) => ({ agentId: r.agent_id, joinedAt: r.joined_at }));
  return json({ ok: true, pool, members });
}

// GET /api/skill
async function handleSkill(_req: Request): Promise<Response> {
  const skill = `# LiteHub Skill

LiteHub is a distributed message queue for AI agents.

## Endpoints

- POST /api/agent/register - Register an agent
- POST /api/agent/produce - Produce a message
- POST /api/agent/consume - Consume a message
- POST /api/agent/pipe - Pipe message to another queue
- GET /api/agents - List agents
- GET /api/queues - List queues
- GET /api/peek?queue=name - Peek queue
- GET /api/pools - List pools
- POST /api/pool/create - Create pool
- POST /api/pool/join - Join pool
- POST /api/pool/leave - Leave pool
- POST /api/pool/speak - Speak in pool
- GET /api/pool/messages?pool=name - Get pool messages
- GET /api/pool/members?pool=name - Get pool members

## MCP Support

Use MCP for efficient AI integration (85% token savings).
GET /api/mcp returns configuration for MCP clients.
`;
  return new Response(skill, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

// GET /api/dashboard
async function handleDashboard(_req: Request): Promise<Response> {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LiteHub Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.6; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    h1 { color: #4ade80; margin-bottom: 1rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-top: 2rem; }
    .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; border: 1px solid #334155; }
    .card h2 { color: #4ade80; margin-bottom: 0.75rem; font-size: 1.1rem; }
    .status { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.875rem; background: #166534; color: #86efac; }
    button { background: #22c55e; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem; }
    button:hover { background: #16a34a; }
    input, textarea { width: 100%; padding: 0.5rem; border: 1px solid #334155; border-radius: 6px; background: #0f172a; color: #e2e8f0; margin-bottom: 0.5rem; }
    .section { margin-top: 1.5rem; }
    .section h3 { color: #94a3b8; margin-bottom: 0.5rem; font-size: 0.9rem; text-transform: uppercase; }
    pre { background: #0f172a; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.8rem; }
    .token-input { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    .token-input input { flex: 1; margin-bottom: 0; }
    .tab-bar { display: flex; gap: 0.5rem; margin-top: 1.5rem; }
    .tab { padding: 0.5rem 1rem; border-radius: 6px 6px 0 0; cursor: pointer; background: #1e293b; color: #94a3b8; border: 1px solid #334155; border-bottom: none; }
    .tab.active { background: #334155; color: #4ade80; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 LiteHub Dashboard</h1>
    <div class="status">● Online</div>

    <div class="token-input">
      <input type="password" id="token" placeholder="Bearer Token (if required)">
      <button onclick="saveToken()">Save</button>
    </div>

    <div class="grid">
      <div class="card"><h2>🤖 Agents</h2><div id="agents">Loading...</div></div>
      <div class="card"><h2>📨 Queues</h2><div id="queues">Loading...</div></div>
      <div class="card"><h2>🏊 Pools</h2><div id="pools">Loading...</div></div>
    </div>

    <div class="grid">
      <div class="card"><h2>📋 A2A Tasks</h2><div id="a2a-tasks">Loading...</div></div>
      <div class="card"><h2>⚡ ACP Runs</h2><div id="acp-runs">Loading...</div></div>
      <div class="card"><h2>🔍 ACP Agents</h2><div id="acp-agents">Loading...</div></div>
    </div>

    <div class="section">
      <h3>Quick Test — Queue</h3>
      <input type="text" id="testQueue" placeholder="Queue name" value="test">
      <textarea id="testData" placeholder="Data to produce" rows="3">Hello from LiteHub!</textarea>
      <button onclick="produce()">Produce</button>
      <pre id="result"></pre>
    </div>

    <div class="section">
      <h3>Quick Test — A2A Task</h3>
      <input type="text" id="taskName" placeholder="Task name" value="test-task">
      <input type="text" id="taskDesc" placeholder="Task description" value="A test task">
      <input type="text" id="taskQueue" placeholder="Queue (optional)" value="">
      <button onclick="createTask()">Create Task</button>
      <pre id="task-result"></pre>
    </div>

    <div class="section">
      <h3>Quick Test — ACP Run</h3>
      <input type="text" id="runName" placeholder="Run name" value="test-run">
      <input type="text" id="runAgent" placeholder="Agent ID" value="dashboard-agent">
      <button onclick="createRun()">Create Run</button>
      <button onclick="speakRun()" style="background:#3b82f6;margin-left:0.5rem">Speak to Run</button>
      <input type="text" id="runMsg" placeholder="Message" value="Hello from run!" style="margin-top:0.5rem">
      <div id="sse-status" style="color:#94a3b8;font-size:0.8rem;margin-top:0.5rem"></div>
      <pre id="run-result"></pre>
    </div>
  </div>

  <script>
    const token = localStorage.getItem('litehub_token') || '';
    document.getElementById('token').value = token;
    let currentRunId = null;
    let eventSource = null;

    function saveToken() {
      localStorage.setItem('litehub_token', document.getElementById('token').value);
      alert('Token saved');
    }

    function headers() {
      const h = { 'Content-Type': 'application/json' };
      const t = localStorage.getItem('litehub_token');
      if (t) h['Authorization'] = 'Bearer ' + t;
      return h;
    }

    async function loadData() {
      try {
        const [agents, queues, pools, a2aTasks, acpRuns, acpAgents] = await Promise.all([
          fetch('/api/agents', { headers: headers() }).then(r => r.json()).catch(() => ({})),
          fetch('/api/queues', { headers: headers() }).then(r => r.json()).catch(() => ({})),
          fetch('/api/pools', { headers: headers() }).then(r => r.json()).catch(() => ({})),
          fetch('/api/a2a/tasks', { headers: headers() }).then(r => r.json()).catch(() => ({})),
          fetch('/api/acp/runs', { headers: headers() }).then(r => r.json()).catch(() => ({})),
          fetch('/api/acp/agents', { headers: headers() }).then(r => r.json()).catch(() => ({}))
        ]);
        document.getElementById('agents').innerHTML = agents.agents?.map(a => '<div>' + a.name + ' <span style="color:#94a3b8">(' + a.role + ')</span></div>').join('') || '<div style="color:#64748b">No agents</div>';
        document.getElementById('queues').innerHTML = queues.queues?.map(q => '<div>' + q.name + ' <span style="color:#64748b">(' + q.size + ' msgs)</span></div>').join('') || '<div style="color:#64748b">No queues</div>';
        document.getElementById('pools').innerHTML = pools.pools?.map(p => '<div>' + p.name + ' <span style="color:#64748b">(' + p.memberCount + '/' + p.maxMembers + ')</span></div>').join('') || '<div style="color:#64748b">No pools</div>';
        document.getElementById('a2a-tasks').innerHTML = a2aTasks.tasks?.map(t => '<div>' + t.name + ' <span style="color:#f59e0b">[' + t.status + ']</span></div>').join('') || '<div style="color:#64748b">No tasks</div>';
        document.getElementById('acp-runs').innerHTML = acpRuns.runs?.map(r => '<div>' + r.name + ' <span style="color:#3b82f6">[' + r.status + ']</span></div>').join('') || '<div style="color:#64748b">No runs</div>';
        document.getElementById('acp-agents').innerHTML = acpAgents.agents?.map(a => '<div>' + a.agentId + '</div>').join('') || '<div style="color:#64748b">No ACP agents</div>';
      } catch (e) { console.error(e); }
    }

    async function produce() {
      const queue = document.getElementById('testQueue').value;
      const data = document.getElementById('testData').value;
      const res = await fetch('/api/agent/produce', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ queue, agentId: 'dashboard', data })
      });
      const j = await res.json();
      document.getElementById('result').textContent = JSON.stringify(j, null, 2);
      loadData();
    }

    async function createTask() {
      const name = document.getElementById('taskName').value;
      const description = document.getElementById('taskDesc').value;
      const queue = document.getElementById('taskQueue').value || undefined;
      const res = await fetch('/api/a2a/tasks', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ name, description, queue })
      });
      const j = await res.json();
      document.getElementById('task-result').textContent = JSON.stringify(j, null, 2);
      loadData();
    }

    async function createRun() {
      const name = document.getElementById('runName').value;
      const agentId = document.getElementById('runAgent').value;
      const res = await fetch('/api/acp/runs', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ name, agentId })
      });
      const j = await res.json();
      document.getElementById('run-result').textContent = JSON.stringify(j, null, 2);
      if (j.ok && j.run?.id) {
        currentRunId = j.run.id;
        startSSE(j.run.id);
      }
      loadData();
    }

    async function speakRun() {
      if (!currentRunId) { alert('Create a run first'); return; }
      const agentId = document.getElementById('runAgent').value;
      const content = document.getElementById('runMsg').value;
      const res = await fetch('/api/acp/contexts/' + currentRunId + '/speak', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ agentId, content })
      });
      const j = await res.json();
      document.getElementById('run-result').textContent = JSON.stringify(j, null, 2);
    }

    function startSSE(runId) {
      if (eventSource) eventSource.close();
      const sseStatus = document.getElementById('sse-status');
      sseStatus.textContent = 'SSE: Connecting to run ' + runId + '...';
      eventSource = new EventSource('/api/acp/runs/' + runId + '/stream');
      eventSource.addEventListener('init', (e) => {
        const data = JSON.parse(e.data);
        sseStatus.textContent = 'SSE: Connected — ' + data.messageCount + ' messages';
      });
      eventSource.addEventListener('messages', (e) => {
        const data = JSON.parse(e.data);
        sseStatus.textContent = 'SSE: ' + data.newMessages.length + ' new message(s) received';
      });
      eventSource.addEventListener('close', () => {
        sseStatus.textContent = 'SSE: Stream closed';
        eventSource.close();
      });
      eventSource.onerror = () => {
        sseStatus.textContent = 'SSE: Connection error';
      };
    }

    loadData();
    setInterval(loadData, 5000);
  </script>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

// MCP 工具定义
const MCP_TOOLS = [
  {
    name: "litehub_register",
    description: "注册一个新的 Agent 到 LiteHub，可同时创建队列和 Pool",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent 的唯一标识符" },
        name: { type: "string", description: "Agent 的显示名称" },
        role: { type: "string", description: "Agent 的角色: producer, consumer, 或 both" },
        queues: {
          type: "array",
          description: "Agent 关联的队列列表，支持字符串或对象",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  name: { type: "string", description: "队列名称" },
                  description: { type: "string", description: "队列描述，说明这个队列是做什么的" }
                },
                required: ["name"]
              }
            ]
          }
        },
        pools: {
          type: "array",
          description: "Agent 创建的 Pool 列表",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Pool 名称" },
              description: { type: "string", description: "Pool 描述，说明这个 Pool 是做什么的" },
              guidelines: { type: "string", description: "Pool 指导原则，可选" },
              maxMembers: { type: "number", description: "最大成员数，默认 20" }
            },
            required: ["name", "description"]
          }
        },
        pollInterval: { type: "number", description: "轮询间隔（毫秒），可选" }
      },
      required: ["agentId", "name", "role"]
    }
  },
  {
    name: "litehub_produce",
    description: "向指定队列生产数据",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "目标队列名称" },
        agentId: { type: "string", description: "Agent ID" },
        data: { description: "要生产的数据，可以是字符串或对象" },
        contentType: { type: "string", description: "内容类型，默认 text/plain" },
        metadata: { type: "object", description: "元数据，可选" },
        lineage: { type: "array", items: { type: "string" }, description: "溯源信息，可选" }
      },
      required: ["queue", "agentId", "data"]
    }
  },
  {
    name: "litehub_consume",
    description: "从指定队列消费数据（FIFO）",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "目标队列名称" },
        agentId: { type: "string", description: "消费者 ID" }
      },
      required: ["queue", "agentId"]
    }
  },
  {
    name: "litehub_peek",
    description: "预览队列中的数据（不消费）",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "队列名称" },
        limit: { type: "number", description: "返回的最大数量，默认 10" }
      },
      required: ["queue"]
    }
  },
  {
    name: "litehub_pipe",
    description: "将数据从一个队列管道传输到另一个队列",
    inputSchema: {
      type: "object",
      properties: {
        pointerId: { type: "string", description: "源消息 ID" },
        targetQueue: { type: "string", description: "目标队列名称" },
        agentId: { type: "string", description: "Agent ID，可选" }
      },
      required: ["pointerId", "targetQueue"]
    }
  },
  {
    name: "litehub_pool_create",
    description: "创建一个新的 Pool（协作池）",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Pool 名称" },
        description: { type: "string", description: "Pool 描述，说明这个 Pool 是做什么的（必填）" },
        guidelines: { type: "string", description: "Pool 指导原则，可选" },
        maxMembers: { type: "number", description: "最大成员数，默认 20" },
        agentId: { type: "string", description: "创建者 Agent ID" }
      },
      required: ["name", "description", "agentId"]
    }
  },
  {
    name: "litehub_pool_join",
    description: "加入一个 Pool",
    inputSchema: {
      type: "object",
      properties: {
        pool: { type: "string", description: "Pool 名称" },
        agentId: { type: "string", description: "Agent ID" }
      },
      required: ["pool", "agentId"]
    }
  },
  {
    name: "litehub_pool_leave",
    description: "离开一个 Pool",
    inputSchema: {
      type: "object",
      properties: {
        pool: { type: "string", description: "Pool 名称" },
        agentId: { type: "string", description: "Agent ID" }
      },
      required: ["pool", "agentId"]
    }
  },
  {
    name: "litehub_pool_speak",
    description: "在 Pool 中发送消息",
    inputSchema: {
      type: "object",
      properties: {
        pool: { type: "string", description: "Pool 名称" },
        agentId: { type: "string", description: "Agent ID" },
        content: { type: "string", description: "消息内容" },
        replyTo: { type: "string", description: "回复的消息 ID，可选" },
        tags: { type: "array", items: { type: "string" }, description: "标签，可选" },
        metadata: { type: "object", description: "元数据，可选" }
      },
      required: ["pool", "agentId", "content"]
    }
  },
  {
    name: "litehub_pool_messages",
    description: "获取 Pool 中的消息列表",
    inputSchema: {
      type: "object",
      properties: {
        pool: { type: "string", description: "Pool 名称" },
        limit: { type: "number", description: "返回的最大数量，默认 50" },
        since: { type: "string", description: "只返回此时间之后的消息，可选" },
        tag: { type: "string", description: "按标签过滤，可选" }
      },
      required: ["pool"]
    }
  },
  {
    name: "litehub_agents",
    description: "获取所有注册的 Agent 列表",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "litehub_queues",
    description: "获取所有队列及其统计信息",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "litehub_pools",
    description: "获取所有 Pool 列表",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "litehub_my_resources",
    description: "查询当前 Agent 创建的所有队列和 Pool，方便智能体了解自己之前创建了哪些资源",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent ID" }
      },
      required: ["agentId"]
    }
  },
  // ── A2A Protocol Tools (Google Agent-to-Agent) ──
  {
    name: "a2a_create_task",
    description: "创建一个 A2A Task，映射到 LiteHub Queue 系统（Agent 间任务委派）",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "发起者 Agent ID" },
        targetAgentId: { type: "string", description: "目标 Agent ID（可选，默认发给所有消费者）" },
        taskId: { type: "string", description: "Task ID（可选，默认自动生成 UUID）" },
        name: { type: "string", description: "Task 名称" },
        input: { description: "Task 输入数据（任意格式）" },
        messageId: { type: "string", description: "关联的消息 ID（可选）" },
        metadata: { type: "object", description: "元数据（可选，包含 priority 等）" }
      },
      required: ["agentId"]
    }
  },
  {
    name: "a2a_get_task",
    description: "查询 A2A Task 详情（状态 + 所有消息）",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID" }
      },
      required: ["taskId"]
    }
  },
  {
    name: "a2a_cancel_task",
    description: "取消一个 A2A Task（将 pointer 状态设为 cancelled）",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID" },
        agentId: { type: "string", description: "操作者 Agent ID" }
      },
      required: ["taskId", "agentId"]
    }
  },
  {
    name: "a2a_list_tasks",
    description: "列出所有 A2A Task（队列名以 a2a: 开头的 pointer）",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "过滤：只返回指定 Agent 创建的 tasks" },
        status: { type: "string", description: "过滤：pending / consumed / looped / cancelled" },
        limit: { type: "number", description: "返回数量限制，默认 20" }
      }
    }
  },
  {
    name: "a2a_set_push_notification",
    description: "配置 Task 的 Webhook 推送通知（订阅 push）",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent ID" },
        webhookUrl: { type: "string", description: "推送目标 URL" },
        event: { type: "string", description: "事件类型：task_created / task_updated / task_completed" }
      },
      required: ["agentId", "webhookUrl"]
    }
  },
  {
    name: "a2a_get_push_notification",
    description: "查询已配置的 Webhook 推送订阅",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent ID" }
      },
      required: ["agentId"]
    }
  },
  // ── ACP Protocol Tools (Agent Communication Protocol) ──
  {
    name: "acp_create_run",
    description: "创建一个 ACP Run（映射到 Pool，协作会话）",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "创建者 Agent ID" },
        runId: { type: "string", description: "Run ID（可选，默认自动生成）" },
        name: { type: "string", description: "Run 名称" },
        guidelines: { type: "string", description: "协作指导原则（可选）" }
      },
      required: ["agentId"]
    }
  },
  {
    name: "acp_get_run",
    description: "查询 ACP Run 详情（Pool 信息 + 成员列表）",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run ID" }
      },
      required: ["runId"]
    }
  },
  {
    name: "acp_cancel_run",
    description: "取消一个 ACP Run（标记 Pool 描述加 [cancelled]）",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run ID" },
        agentId: { type: "string", description: "操作者 Agent ID" }
      },
      required: ["runId", "agentId"]
    }
  },
  {
    name: "acp_list_runs",
    description: "列出所有 ACP Run（Pool 名称以 acp: 开头的）",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "过滤：只返回指定 Agent 创建的 runs" },
        limit: { type: "number", description: "返回数量限制，默认 20" }
      }
    }
  },
  {
    name: "acp_create_context",
    description: "创建一个 ACP Context（Pool，协作上下文）",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "创建者 Agent ID" },
        contextId: { type: "string", description: "Context ID（可选）" },
        name: { type: "string", description: "Context 名称" },
        guidelines: { type: "string", description: "协作指导原则" }
      },
      required: ["agentId"]
    }
  },
  {
    name: "acp_get_context",
    description: "查询 ACP Context 详情（Pool 信息 + 成员）",
    inputSchema: {
      type: "object",
      properties: {
        contextId: { type: "string", description: "Context ID（Pool 名称）" }
      },
      required: ["contextId"]
    }
  },
  {
    name: "acp_join_context",
    description: "加入一个 ACP Context（加入 Pool 协作）",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent ID" },
        contextId: { type: "string", description: "Context ID（Pool 名称）" }
      },
      required: ["agentId", "contextId"]
    }
  },
  {
    name: "acp_leave_context",
    description: "离开一个 ACP Context（离开 Pool）",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent ID" },
        contextId: { type: "string", description: "Context ID（Pool 名称）" }
      },
      required: ["agentId", "contextId"]
    }
  },
  {
    name: "acp_speak_context",
    description: "在 ACP Context 中发送消息（Pool speak）",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent ID" },
        contextId: { type: "string", description: "Context ID（Pool 名称）" },
        content: { type: "string", description: "消息内容" },
        replyTo: { type: "string", description: "回复的消息 ID，可选" },
        tags: { type: "array", items: { type: "string" }, description: "标签，可选" }
      },
      required: ["agentId", "contextId", "content"]
    }
  }
];

// MCP JSON-RPC 请求类型
interface McpRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
}

interface McpResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

// MCP JSON-RPC 处理函数
async function handleMcpRequest(req: Request): Promise<Response> {
  try {
    const request = await req.json() as McpRequest;
    
    if (!request.jsonrpc || request.jsonrpc !== "2.0") {
      return json({ jsonrpc: "2.0", id: request.id || null, error: { code: -32600, message: "Invalid Request" } }, 400);
    }

    const { id, method, params } = request;

    switch (method) {
      case "initialize":
        return json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11",
            capabilities: {
              tools: { listChanged: true }
            },
            serverInfo: {
              name: "LiteHub MCP Server",
              version: "2.0.0"
            }
          }
        });

      case "tools/list":
        return json({
          jsonrpc: "2.0",
          id,
          result: { tools: MCP_TOOLS }
        });

      case "tools/call": {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};
        
        const tool = MCP_TOOLS.find(t => t.name === toolName);
        if (!tool) {
          return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Tool not found" } }, 404);
        }

        try {
          const result = await executeMcpTool(req, toolName, toolArgs);
          return json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2)
                }
              ]
            }
          });
        } catch (error) {
          return json({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32603,
              message: "Internal error",
              data: error instanceof Error ? error.message : String(error)
            }
          }, 500);
        }
      }

      default:
        return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }, 404);
    }
  } catch (error) {
    return json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" }
    }, 400);
  }
}

// Fire webhooks for push subscriptions (non-blocking)
async function firePushNotification(webhookUrl: string, payload: object, secret?: string): Promise<void> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret) headers["X-LiteHub-Secret"] = secret;
    // A2A spec compliant payload wrapping
    const a2aPayload = {
      jsonrpc: "2.0",
      method: "notifications/task_updated",
      params: payload,
    };
    await fetch(webhookUrl, { method: "POST", headers, body: JSON.stringify(a2aPayload), signal: AbortSignal.timeout(5000) });
  } catch { /* non-critical */ }
}

async function notifySubscribers(scope: string, scopeName: string, event: string, data: object): Promise<void> {
  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT target_url, secret FROM push_subscriptions WHERE scope = ? AND scope_name = ?",
    args: [scope, scopeName],
  });
  // A2A spec: { event, taskId, status } for A2A scope
  // ACP spec: { event, runId/contextId, ... } for ACP/Pool scope
  for (const row of rs.rows as any[]) {
    let payload: any;
    if (scope === 'a2a' || scope === 'queue') {
      // A2A spec compliant: task_updated notification
      const pointerId = (data as any).pointerId || (data as any).messageId || scopeName;
      const status = event.includes('produced') || event.includes('created') ? 'pending'
        : event.includes('consumed') ? 'working'
        : event.includes('completed') ? 'completed'
        : event.includes('cancelled') ? 'cancelled'
        : 'pending';
      payload = { event: 'task_updated', taskId: pointerId, status, ...data };
    } else {
      payload = { event, scope, scopeName, ...data };
    }
    firePushNotification(row.target_url, payload, row.secret);
  }
}

// ─── Shared JSON helper (module-level) ───────────────────────────────────
const getJson = async (res: Response) => {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
};

async function executeMcpTool(req: Request, toolName: string, args: any): Promise<any> {
  const baseUrl = new URL(req.url).origin;

  switch (toolName) {
    case "litehub_register": {
      const mockReq = new Request(`${baseUrl}/api/agent/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      const res = await handleAgentRegister(mockReq);
      return await getJson(res);
    }

    case "litehub_produce": {
      const mockReq = new Request(`${baseUrl}/api/agent/produce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      const res = await handleProduce(mockReq);
      return await getJson(res);
    }

    case "litehub_consume": {
      const mockReq = new Request(`${baseUrl}/api/agent/consume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      const res = await handleConsume(mockReq);
      return await getJson(res);
    }

    case "litehub_peek": {
      const mockReq = new Request(`${baseUrl}/api/peek?queue=${args.queue}&limit=${args.limit || 10}`);
      const res = await handlePeek(mockReq);
      return await getJson(res);
    }

    case "litehub_pipe": {
      const mockReq = new Request(`${baseUrl}/api/agent/pipe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      const res = await handlePipe(mockReq);
      return await getJson(res);
    }

    case "litehub_pool_create": {
      const mockReq = new Request(`${baseUrl}/api/pool/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      const res = await handlePoolCreate(mockReq);
      return await getJson(res);
    }

    case "litehub_pool_join": {
      const mockReq = new Request(`${baseUrl}/api/pool/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      const res = await handlePoolJoin(mockReq);
      return await getJson(res);
    }

    case "litehub_pool_leave": {
      const mockReq = new Request(`${baseUrl}/api/pool/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      const res = await handlePoolLeave(mockReq);
      return await getJson(res);
    }

    case "litehub_pool_speak": {
      const mockReq = new Request(`${baseUrl}/api/pool/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      const res = await handlePoolSpeak(mockReq);
      return await getJson(res);
    }

    case "litehub_pool_messages": {
      const mockReq = new Request(`${baseUrl}/api/pool/messages?pool=${args.pool}&limit=${args.limit || 50}${args.since ? `&since=${args.since}` : ""}${args.tag ? `&tag=${args.tag}` : ""}`);
      const res = await handlePoolMessages(mockReq);
      return await getJson(res);
    }

    case "litehub_agents": {
      const mockReq = new Request(`${baseUrl}/api/agents`);
      const res = await handleAgents(mockReq);
      return await getJson(res);
    }

    case "litehub_queues": {
      const mockReq = new Request(`${baseUrl}/api/queues`);
      const res = await handleQueues(mockReq);
      return await getJson(res);
    }

    case "litehub_pools": {
      const mockReq = new Request(`${baseUrl}/api/pools`);
      const res = await handlePools(mockReq);
      return await getJson(res);
    }

    case "litehub_my_resources": {
      const db = await getDb();
      const { agentId } = args;
      if (!agentId) return { ok: false, error: "Missing agentId" };
      // 校验 Agent 已注册
      const agentErr = await ensureAgent(db, agentId);
      if (agentErr) return await getJson(agentErr);
      // 查询该 Agent 创建的队列
      const qRs = await db.execute({ sql: "SELECT name, description, created_at FROM queues WHERE creator_id = ? ORDER BY created_at", args: [agentId] });
      const myQueues = qRs.rows.map((r: any) => ({ name: r.name, description: r.description, createdAt: r.created_at }));
      // 查询该 Agent 创建的 Pool
      const pRs = await db.execute({ sql: "SELECT name, description, max_members, created_at FROM pools WHERE creator_id = ? ORDER BY created_at", args: [agentId] });
      const myPools = pRs.rows.map((r: any) => ({ name: r.name, description: r.description, maxMembers: r.max_members, createdAt: r.created_at }));
      return { ok: true, agentId, queues: myQueues, pools: myPools };
    }

    // ── A2A Protocol Tools ──
    case "a2a_create_task": {
      const db = await getDb();
      const { agentId, targetAgentId, taskId, name, input, messageId, metadata } = args;
      if (!agentId) return { ok: false, error: "Missing agentId" };
      const agentErr = await ensureAgent(db, agentId);
      if (agentErr) return await getJson(agentErr);
      const realTaskId = taskId || crypto.randomUUID();
      const queueName = `a2a:${targetAgentId || agentId}:${realTaskId}`;
      // Insert into a2a_tasks table for A2A protocol tracking
      await db.execute({ sql: "INSERT OR IGNORE INTO a2a_tasks (id, name, description, status, queue, agent_id) VALUES (?, ?, ?, 'pending', ?, ?)", args: [realTaskId, name ?? '', JSON.stringify(input ?? {}), queueName, agentId] });
      // Produce the task message into the queue
      const produceReq = new Request(`${new URL(req.url).origin}/api/agent/produce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': req.headers.get('Authorization') || '' },
        body: JSON.stringify({ agentId, queue: queueName, data: JSON.stringify({ taskId: realTaskId, name, input, messageId, metadata }) })
      });
      return await getJson(await handleProduce(produceReq));
    }
    case "a2a_get_task": {
      const { taskId } = args;
      if (!taskId) return { ok: false, error: "Missing taskId" };
      const db = await getDb();
      const rs = await db.execute({ sql: "SELECT id, name, description, status, queue, agent_id, created_at, updated_at FROM a2a_tasks WHERE id = ?", args: [taskId] });
      if (!rs.rows?.length) return { ok: false, error: "Task not found" };
      const task = rs.rows[0] as any;
      const msgRs = await db.execute({ sql: "SELECT data, created_at FROM pointers WHERE queue = ? ORDER BY created_at", args: [task.queue] });
      return { taskId: task.id, name: task.name, description: task.description, queueName: task.queue, status: task.status, agentId: task.agent_id, createdAt: task.created_at, updatedAt: task.updated_at, messages: msgRs.rows?.map((r: any) => ({ data: r.data, createdAt: r.created_at })) ?? [] };
    }
    case "a2a_cancel_task": {
      const { taskId, agentId } = args;
      if (!taskId || !agentId) return { ok: false, error: "Missing taskId or agentId" };
      const db = await getDb();
      const agentErr = await ensureAgent(db, agentId);
      if (agentErr) return await getJson(agentErr);
      const rs = await db.execute({ sql: "UPDATE a2a_tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND agent_id = ? AND status = 'pending'", args: [taskId, agentId] });
      return { ok: true, cancelled: rs.rowsAffected ?? 0 };
    }
    case "a2a_list_tasks": {
      const { agentId, status, limit } = args;
      const db = await getDb();
      let sql = "SELECT id, name, description, status, queue, agent_id, created_at, updated_at FROM a2a_tasks WHERE 1=1";
      const a: any[] = [];
      if (agentId) { sql += " AND agent_id = ?"; a.push(agentId); }
      if (status) { sql += " AND status = ?"; a.push(status); }
      sql += " ORDER BY created_at DESC LIMIT ?"; a.push(limit ?? 20);
      const rs = await db.execute({ sql, args: a });
      return { tasks: rs.rows?.map((r: any) => ({ taskId: r.id, name: r.name, queueName: r.queue, agentId: r.agent_id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at })) ?? [] };
    }
    case "a2a_set_push_notification": {
      const { agentId, webhookUrl, event } = args;
      if (!agentId || !webhookUrl) return { ok: false, error: "Missing agentId or webhookUrl" };
      const db = await getDb();
      const agentErr = await ensureAgent(db, agentId);
      if (agentErr) return await getJson(agentErr);
      await db.execute({ sql: "INSERT OR REPLACE INTO push_subscriptions (id, subscriber_id, target_url, scope, scope_name, secret, created_at) VALUES (?, ?, ?, 'a2a', ?, '', datetime('now'))", args: [`${agentId}-a2a-${Date.now()}`, agentId, webhookUrl, agentId] });
      return { ok: true, message: "Push notification configured" };
    }
    case "a2a_get_push_notification": {
      const { agentId } = args;
      if (!agentId) return { ok: false, error: "Missing agentId" };
      const db = await getDb();
      const rs = await db.execute({ sql: "SELECT scope_name, target_url, created_at FROM push_subscriptions WHERE subscriber_id = ? AND scope = 'a2a'", args: [agentId] });
      return { subscriptions: rs.rows?.map((r: any) => ({ scopeName: r.scope_name, targetUrl: r.target_url, createdAt: r.created_at })) ?? [] };
    }

    // ── ACP Protocol Tools ──
    case "acp_create_run": {
      const { agentId, runId, name, guidelines } = args;
      if (!agentId) return { ok: false, error: "Missing agentId" };
      const db = await getDb();
      const agentErr = await ensureAgent(db, agentId);
      if (agentErr) return await getJson(agentErr);
      const id = runId || crypto.randomUUID();
      await db.execute({ sql: "INSERT OR IGNORE INTO pools (name, description, guidelines, creator_id, max_members) VALUES (?, ?, ?, ?, 20)", args: [`acp:${id}`, name || id, guidelines || '', agentId] });
      notifySubscribers("acp", `acp:${id}`, "run_created", { runId: id, creatorId: agentId }).catch(() => {});
      return { ok: true, runId: id };
    }
    case "acp_get_run": {
      const { runId } = args;
      if (!runId) return { ok: false, error: "Missing runId" };
      const db = await getDb();
      const rs = await db.execute({ sql: "SELECT name, description, guidelines, creator_id, created_at FROM pools WHERE name = ?", args: [`acp:${runId}`] });
      if (!rs.rows?.length) return { ok: false, error: "Run not found" };
      const pool = rs.rows[0] as any;
      const memRs = await db.execute({ sql: "SELECT agent_id, joined_at FROM pool_members WHERE pool = ?", args: [`acp:${runId}`] });
      return { runId, name: pool.name, description: pool.description, guidelines: pool.guidelines, creatorId: pool.creator_id, createdAt: pool.created_at, members: memRs.rows?.map((r: any) => ({ agentId: r.agent_id, joinedAt: r.joined_at })) ?? [] };
    }
    case "acp_cancel_run": {
      const { runId, agentId } = args;
      if (!runId || !agentId) return { ok: false, error: "Missing runId or agentId" };
      const db = await getDb();
      const agentErr = await ensureAgent(db, agentId);
      if (agentErr) return await getJson(agentErr);
      const rs = await db.execute({ sql: "UPDATE pools SET description = description || ' [cancelled]' WHERE name = ? AND creator_id = ?", args: [`acp:${runId}`, agentId] });
      return { ok: true, cancelled: rs.rowsAffected ?? 0 };
    }
    case "acp_list_runs": {
      const { agentId, limit } = args;
      const db = await getDb();
      let sql = "SELECT name, description, creator_id, created_at FROM pools WHERE name LIKE 'acp:%'";
      const a: any[] = [];
      if (agentId) { sql += " AND creator_id = ?"; a.push(agentId); }
      sql += " ORDER BY created_at DESC LIMIT ?"; a.push(limit ?? 20);
      const rs = await db.execute({ sql, args: a });
      return { runs: rs.rows?.map((r: any) => ({ runId: r.name.replace('acp:', ''), description: r.description, creatorId: r.creator_id, createdAt: r.created_at })) ?? [] };
    }
    case "acp_create_context": {
      const { agentId, contextId, name, guidelines } = args;
      if (!agentId) return { ok: false, error: "Missing agentId" };
      const db = await getDb();
      const agentErr = await ensureAgent(db, agentId);
      if (agentErr) return await getJson(agentErr);
      const id = contextId || crypto.randomUUID();
      await db.execute({ sql: "INSERT OR IGNORE INTO pools (name, description, guidelines, creator_id, max_members) VALUES (?, ?, ?, ?, 20)", args: [id, name || id, guidelines || '', agentId] });
      return { ok: true, contextId: id };
    }
    case "acp_get_context": {
      const { contextId } = args;
      if (!contextId) return { ok: false, error: "Missing contextId" };
      const db = await getDb();
      const rs = await db.execute({ sql: "SELECT name, description, guidelines, creator_id, max_members, created_at FROM pools WHERE name = ?", args: [contextId] });
      if (!rs.rows?.length) return { ok: false, error: "Context not found" };
      const pool = rs.rows[0] as any;
      const memRs = await db.execute({ sql: "SELECT agent_id, joined_at FROM pool_members WHERE pool = ?", args: [contextId] });
      return { contextId, name: pool.name, description: pool.description, guidelines: pool.guidelines, creatorId: pool.creator_id, maxMembers: pool.max_members, createdAt: pool.created_at, members: memRs.rows?.map((r: any) => ({ agentId: r.agent_id, joinedAt: r.joined_at })) ?? [] };
    }
    case "acp_join_context": {
      const { agentId, contextId } = args;
      if (!agentId || !contextId) return { ok: false, error: "Missing agentId or contextId" };
      const db = await getDb();
      const agentErr = await ensureAgent(db, agentId);
      if (agentErr) return await getJson(agentErr);
      const poolRs = await db.execute({ sql: "SELECT max_members FROM pools WHERE name = ?", args: [contextId] });
      if (!poolRs.rows.length) return { ok: false, error: "Context not found" };
      const maxMembers = (poolRs.rows[0] as any).max_members;
      const countRs = await db.execute({ sql: "SELECT COUNT(*) as count FROM pool_members WHERE pool = ?", args: [contextId] });
      if ((countRs.rows[0] as any).count >= maxMembers) return { ok: false, error: "Context is full" };
      await db.execute({ sql: "INSERT OR IGNORE INTO pool_members (pool, agent_id) VALUES (?, ?)", args: [contextId, agentId] });
      notifySubscribers('pool', contextId, 'agent_joined', { contextId, agentId }).catch(() => {});
      return { ok: true, contextId, agentId };
    }
    case "acp_leave_context": {
      const { agentId, contextId } = args;
      if (!agentId || !contextId) return { ok: false, error: "Missing agentId or contextId" };
      const db = await getDb();
      const agentErr = await ensureAgent(db, agentId);
      if (agentErr) return await getJson(agentErr);
      await db.execute({ sql: "DELETE FROM pool_members WHERE pool = ? AND agent_id = ?", args: [contextId, agentId] });
      notifySubscribers('pool', contextId, 'agent_left', { contextId, agentId }).catch(() => {});
      return { ok: true, contextId, agentId };
    }
    case "acp_speak_context": {
      const { agentId, contextId, content, replyTo, tags } = args;
      if (!agentId || !contextId || !content) return { ok: false, error: "Missing agentId, contextId, or content" };
      const db = await getDb();
      const agentErr = await ensureAgent(db, agentId);
      if (agentErr) return await getJson(agentErr);
      const poolRs = await db.execute({ sql: "SELECT name FROM pools WHERE name = ?", args: [contextId] });
      if (!poolRs.rows.length) return { ok: false, error: "Context not found" };
      const id = crypto.randomUUID();
      await db.execute({ sql: "INSERT INTO pool_messages (id, pool, agent_id, content, reply_to, tags, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)", args: [id, contextId, agentId, content, replyTo || null, JSON.stringify(tags || []), JSON.stringify({})] });
      notifySubscribers('pool', contextId, 'message_sent', { contextId, messageId: id, senderId: agentId }).catch(() => {});
      return { ok: true, id, contextId };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// GET /api/mcp - 保留用于向后兼容
async function handleMcpConfig(req: Request): Promise<Response> {
  const baseUrl = new URL(req.url).origin;
  const config = {
    name: "LiteHub MCP Server",
    version: "2.0.0",
    description: "LiteHub — Agent Collaboration Hub via MCP",
    transport: "http",
    endpoint: `${baseUrl}/api/mcp`,
    tools: MCP_TOOLS.map(t => ({
      name: t.name,
      description: t.description
    })),
    auth: { type: "bearer", description: "Set LITEHUB_TOKEN env var, then send Authorization: Bearer <token>" }
  };
  return new Response(JSON.stringify(config, null, 2), {
    headers: {
      "Content-Type": "application/json", "Access-Control-Allow-Origin": "*",
      "Content-Disposition": 'attachment; filename="litehub-mcp.json"',
    },
  });
}

// GET /.well-known/agent-card.json — A2A Agent Card (Google spec)
async function handleAgentCard(_req: Request): Promise<Response> {
  const baseUrl = new URL(_req.url).origin;
  return json({
    name: "LiteHub",
    version: "2.0.0",
    description: "Distributed Agent Collaboration Hub — Queue + Pool messaging",
    capabilities: {
      queue: { produce: `${baseUrl}/api/agent/produce`, consume: `${baseUrl}/api/agent/consume`, peek: `${baseUrl}/api/peek` },
      pool: { create: `${baseUrl}/api/pool/create`, join: `${baseUrl}/api/pool/join`, speak: `${baseUrl}/api/pool/speak`, messages: `${baseUrl}/api/pool/messages` },
      a2a: { tasks: `${baseUrl}/api/a2a/tasks`, pushNotificationConfig: `${baseUrl}/api/a2a/tasks/pushNotificationConfig/set` },
      acp: { runs: `${baseUrl}/api/acp/runs`, contexts: `${baseUrl}/api/acp/contexts` },
      mcp: { endpoint: `${baseUrl}/api/mcp`, config: `${baseUrl}/api/mcp` },
    },
    protocols: ["a2a", "acp", "mcp"],
  });
}

// ─── A2A Protocol Handlers (Google Agent-to-Agent) ────────────────────────
// Maps to existing Queue operations (produce/consume)

// A2A Tasks - dispatches GET (list) vs POST (create)
async function handleA2ATasks(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    return handleA2AListTasks(req);
  }
  // POST requires auth
  if (!validateAuth(req)) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }
  return handleA2ACreateTask(req);
}

// GET /api/a2a/tasks — List A2A tasks
async function handleA2AListTasks(req: Request): Promise<Response> {
  try {
    const db = await getDb();
    const rs = await db.execute({ sql: "SELECT id, name, description, status, queue, agent_id, created_at, updated_at FROM a2a_tasks ORDER BY created_at DESC LIMIT 50", args: [] });
    return json({ ok: true, tasks: rs.rows?.map((r: any) => ({ taskId: r.id, name: r.name, status: r.status, queueName: r.queue, agentId: r.agent_id, createdAt: r.created_at, updatedAt: r.updated_at })) ?? [] });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

async function handleA2ACreateTask(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { taskId, agentId, targetAgentId, name, input, messageId, metadata } = body as { taskId?: string; agentId: string; targetAgentId?: string; name?: string; input?: any; messageId?: string; metadata?: any };
    const db = await getDb();
    
    // Validate agent
    const agentErr = await ensureAgent(db, agentId);
    if (agentErr) return await getJson(agentErr);
    
    // Use existing queue/pointer system
    const realTaskId = taskId || crypto.randomUUID();
    const queueName = `a2a:${targetAgentId || agentId}:${realTaskId}`;
    
    // Insert into a2a_tasks for protocol tracking
    await db.execute({
      sql: "INSERT OR IGNORE INTO a2a_tasks (id, name, description, status, queue, agent_id) VALUES (?, ?, ?, 'pending', ?, ?)",
      args: [realTaskId, name ?? '', JSON.stringify(input ?? {}), queueName, agentId]
    });
    
    // Create the task via produce
    const produceReq = new Request(req.url.replace('/a2a/tasks', '/agent/produce'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': req.headers.get('Authorization') || '' },
      body: JSON.stringify({ agentId, queue: queueName, data: JSON.stringify({ taskId: realTaskId, name, input, messageId, metadata }) })
    });
    return await handleProduce(produceReq);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

async function handleA2ACancelTask(req: Request): Promise<Response> {
  try {
    const { taskId, agentId } = await req.json() as { taskId: string; agentId: string };
    const db = await getDb();
    const agentErr = await ensureAgent(db, agentId);
    if (agentErr) return await getJson(agentErr);
    
    const rs = await db.execute({ 
      sql: "UPDATE a2a_tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND agent_id = ?",
      args: [taskId, agentId]
    });
    return json({ ok: true, cancelled: rs.rowsAffected ?? 0 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

async function handleA2ASetPushNotification(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { agentId, taskId, webhookUrl, secret } = body as { agentId: string; taskId: string; webhookUrl: string; secret?: string };
    const db = await getDb();
    const agentErr = await ensureAgent(db, agentId);
    if (agentErr) return await getJson(agentErr);
    
    // Store push subscription in push_subscriptions table
    await db.execute({
      sql: `INSERT OR REPLACE INTO push_subscriptions (id, subscriber_id, target_url, scope, scope_name, secret, created_at)
            VALUES (?, ?, ?, 'a2a', ?, ?, datetime('now'))`,
      args: [`${agentId}-a2a-${taskId}`, agentId, webhookUrl, taskId, secret ?? '']
    });
    return json({ ok: true, message: 'Push notification configured for task' });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

// ─── ACP Protocol Handlers (Agent Communication Protocol) ─────────────────
// Maps to existing Pool operations

// ACP Runs - dispatches GET (list) vs POST (create)
async function handleACPRuns(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    return handleACPListRuns(req);
  }
  if (!validateAuth(req)) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }
  return handleACPCreateRun(req);
}

// GET /api/acp/runs — List ACP runs
async function handleACPListRuns(req: Request): Promise<Response> {
  try {
    const db = await getDb();
    const rs = await db.execute({ sql: "SELECT id, context_id, pool, agent_id, role, guidelines, status, created_at, ended_at FROM acp_runs ORDER BY created_at DESC LIMIT 50", args: [] });
    return json({ ok: true, runs: rs.rows?.map((r: any) => ({ runId: r.id, contextId: r.context_id, poolName: r.pool, agentId: r.agent_id, role: r.role, status: r.status, createdAt: r.created_at, endedAt: r.ended_at })) ?? [] });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

// ACP Contexts - dispatches GET (list) vs POST (create)
async function handleACPContexts(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    return handleACPListContexts(req);
  }
  if (!validateAuth(req)) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }
  return handleACPCreateContext(req);
}

// GET /api/acp/contexts — List ACP contexts (pools used as contexts)
async function handleACPListContexts(req: Request): Promise<Response> {
  try {
    const db = await getDb();
    const rs = await db.execute({ sql: "SELECT name, description, guidelines, max_members, creator_id, created_at FROM pools ORDER BY created_at DESC LIMIT 50", args: [] });
    return json({ ok: true, contexts: rs.rows?.map((r: any) => ({ contextId: r.name, name: r.description, guidelines: r.guidelines, maxMembers: r.max_members, creatorId: r.creator_id, createdAt: r.created_at })) ?? [] });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

async function handleACPCreateRun(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { agentId, runId, contextId, name, participants } = body as { agentId: string; runId?: string; contextId?: string; name?: string; participants?: number };
    const db = await getDb();
    const agentErr = await ensureAgent(db, agentId);
    if (agentErr) return await getJson(agentErr);
    
    // Create a Pool as a "run"
    const poolName = `acp:${runId || crypto.randomUUID()}`;
    const createReq = new Request(req.url.replace('/acp/runs', '/pool/create'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': req.headers.get('Authorization') || '' },
      body: JSON.stringify({ agentId, name: poolName, description: name ?? '', maxMembers: participants ?? 10 })
    });
    return await handlePoolCreate(createReq);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

async function handleACPCancelRun(req: Request): Promise<Response> {
  try {
    const { runId, agentId } = await req.json() as { runId: string; agentId: string };
    const db = await getDb();
    const agentErr = await ensureAgent(db, agentId);
    if (agentErr) return await getJson(agentErr);
    
    // Archive the Pool (soft delete)
    const rs = await db.execute({ 
      sql: "UPDATE pools SET description = description || ' [cancelled]' WHERE name = ? AND creator_id = ?",
      args: [`acp:${runId}`, agentId]
    });
    return json({ ok: true, cancelled: rs.rowsAffected ?? rs.rows?.length ?? 0 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

// GET /api/a2a/tasks/{id} — Get A2A task by ID
async function handleA2AGetTask(req: Request): Promise<Response> {
  try {
    const params = (req as any)._params as Record<string, string> | undefined;
    const taskId = params?.id;
    if (!taskId) return json({ ok: false, error: "Missing taskId" }, 400);

    const db = await getDb();
    // Query a2a_tasks table for task metadata
    const rs = await db.execute({
      sql: "SELECT id, name, description, status, queue, agent_id, created_at, updated_at FROM a2a_tasks WHERE id = ?",
      args: [taskId]
    });
    if (!rs.rows?.length) return json({ ok: false, error: "Task not found" }, 404);
    const task = rs.rows[0] as any;
    // Get all messages in this queue from pointers
    const msgRs = await db.execute({
      sql: "SELECT data, created_at FROM pointers WHERE queue = ? ORDER BY created_at",
      args: [task.queue]
    });
    return json({
      taskId: task.id,
      name: task.name,
      queueName: task.queue,
      status: task.status,
      agentId: task.agent_id,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      messages: msgRs.rows?.map((r: any) => { let d: any = r.data; try { d = JSON.parse(r.data); } catch {} return { data: d, createdAt: r.created_at }; }) ?? []
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

// GET /api/acp/runs/{id}/stream — SSE stream for ACP run updates
// Vercel Edge Runtime compatible: polling-based SSE with periodic DB checks
async function handleACPRunStream(req: Request): Promise<Response> {
  const params = (req as any)._params as Record<string, string> | undefined;
  const runId = params?.id;
  if (!runId) return json({ ok: false, error: 'Missing runId' }, 400);

  // Verify the run exists
  const db = await getDb();
  const poolRs = await db.execute({ sql: "SELECT name FROM pools WHERE name = ?", args: [`acp:${runId}`] });
  if (!poolRs.rows.length) return json({ ok: false, error: 'Run not found' }, 404);

  const encoder = new TextEncoder();
  let lastMsgCount = 0;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial event with current state
      const initRs = await db.execute({
        sql: "SELECT agent_id, content, created_at FROM pool_messages WHERE pool = ? ORDER BY created_at ASC LIMIT 100",
        args: [`acp:${runId}`],
      });
      lastMsgCount = initRs.rows.length;

      const initData = {
        type: 'init',
        runId,
        messageCount: lastMsgCount,
        messages: initRs.rows.map((r: any) => ({ agentId: r.agent_id, content: r.content, createdAt: r.created_at })),
      };
      controller.enqueue(encoder.encode(`event: init\ndata: ${JSON.stringify(initData)}\n\n`));

      // Polling loop — check for new messages every 2 seconds
      const pollInterval = setInterval(async () => {
        if (closed) { clearInterval(pollInterval); return; }
        try {
          const rs = await db.execute({
            sql: "SELECT agent_id, content, created_at FROM pool_messages WHERE pool = ? ORDER BY created_at ASC LIMIT 100",
            args: [`acp:${runId}`],
          });
          const currentCount = rs.rows.length;
          if (currentCount > lastMsgCount) {
            // Send only new messages
            const newMessages = rs.rows.slice(lastMsgCount).map((r: any) => ({
              agentId: r.agent_id, content: r.content, createdAt: r.created_at,
            }));
            const eventData = { type: 'messages', runId, newMessages };
            controller.enqueue(encoder.encode(`event: messages\ndata: ${JSON.stringify(eventData)}\n\n`));
            lastMsgCount = currentCount;
          }
          // Heartbeat to keep connection alive
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch {
          // DB error — skip this tick
        }
      }, 2000);

      // Cleanup on client disconnect
      req.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(pollInterval);
        try { controller.close(); } catch {}
      });

      // Auto-close after 5 minutes to prevent resource exhaustion
      setTimeout(() => {
        closed = true;
        clearInterval(pollInterval);
        try {
          controller.enqueue(encoder.encode(`event: close\ndata: {"type":"timeout","message":"Stream closed after 5 minutes"}\n\n`));
          controller.close();
        } catch {}
      }, 5 * 60 * 1000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    },
  });
}

// GET /api/acp/runs/{id} — Get ACP run by ID
async function handleACPGetRun(req: Request): Promise<Response> {
  try {
    const params = (req as any)._params as Record<string, string> | undefined;
    const runId = params?.id;
    if (!runId) return json({ ok: false, error: "Missing runId" }, 400);

    const db = await getDb();
    // ACP runs are stored as Pool with name "acp:{runId}"
    const rs = await db.execute({
      sql: "SELECT name, description, guidelines, creator_id, created_at FROM pools WHERE name = ?",
      args: [`acp:${runId}`]
    });
    if (!rs.rows?.length) return json({ ok: false, error: "Run not found" }, 404);
    const pool = rs.rows[0] as any;
    // Get members
    const memRs = await db.execute({
      sql: "SELECT agent_id, joined_at FROM pool_members WHERE pool = ?",
      args: [`acp:${runId}`]
    });
    return json({
      runId,
      name: pool.name,
      description: pool.description,
      guidelines: pool.guidelines,
      creatorId: pool.creator_id,
      createdAt: pool.created_at,
      members: memRs.rows?.map((r: any) => ({ agentId: r.agent_id, joinedAt: r.joined_at })) ?? []
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

// GET /api/acp/contexts/{id} — Get ACP context (Pool) by ID
async function handleACPGetContext(req: Request): Promise<Response> {
  try {
    const params = (req as any)._params as Record<string, string> | undefined;
    const contextId = params?.id;
    if (!contextId) return json({ ok: false, error: "Missing contextId" }, 400);

    const db = await getDb();
    const rs = await db.execute({
      sql: "SELECT name, description, guidelines, creator_id, max_members, created_at FROM pools WHERE name = ?",
      args: [contextId]
    });
    if (!rs.rows?.length) return json({ ok: false, error: "Context not found" }, 404);
    const pool = rs.rows[0] as any;
    const memRs = await db.execute({
      sql: "SELECT agent_id, joined_at FROM pool_members WHERE pool = ?",
      args: [contextId]
    });
    return json({
      contextId,
      name: pool.name,
      description: pool.description,
      guidelines: pool.guidelines,
      creatorId: pool.creator_id,
      maxMembers: pool.max_members,
      createdAt: pool.created_at,
      members: memRs.rows?.map((r: any) => ({ agentId: r.agent_id, joinedAt: r.joined_at })) ?? []
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

// GET /api/acp/contexts/{id}/messages — Get messages in an ACP context
async function handleACPGetContextMessages(req: Request): Promise<Response> {
  try {
    const params = (req as any)._params as Record<string, string> | undefined;
    const contextId = params?.id;
    if (!contextId) return json({ ok: false, error: "Missing contextId" }, 400);

    const db = await getDb();
    const msgsRs = await db.execute({
      sql: "SELECT agent_id, content, tags, reply_to, created_at FROM pool_messages WHERE pool = ? ORDER BY created_at ASC LIMIT 100",
      args: [contextId]
    });
    return json({
      contextId,
      messages: msgsRs.rows?.map((r: any) => ({
        agentId: r.agent_id,
        content: r.content,
        tags: r.tags ? JSON.parse(r.tags) : [],
        replyTo: r.reply_to,
        createdAt: r.created_at
      })) ?? []
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

async function handleACPCreateContext(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { agentId, contextId, name, guidelines } = body as { agentId: string; contextId?: string; name?: string; guidelines?: string };
    const db = await getDb();
    const agentErr = await ensureAgent(db, agentId);
    if (agentErr) return await getJson(agentErr);
    
    // Create a Pool as a "context"
    const createReq = new Request(req.url.replace('/acp/contexts', '/pool/create'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': req.headers.get('Authorization') || '' },
      body: JSON.stringify({ agentId, name: contextId || crypto.randomUUID(), description: name ?? guidelines ?? '' })
    });
    return await handlePoolCreate(createReq);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

async function handleACPJoinContext(req: Request): Promise<Response> {
  try {
    const b = await body(req);
    const agentId = b.agentId;
    // contextId can come from body or from URL params (pattern: acp/contexts/{id}/join)
    const params = (req as any)._params as Record<string, string> | undefined;
    const contextId = b.contextId || params?.id || '';
    if (!agentId || !contextId) return json({ ok: false, error: 'Missing agentId or contextId' }, 400);
    const db = await getDb();
    const agentErr = await ensureAgent(db, agentId);
    if (agentErr) return await getJson(agentErr);
    // Directly join the Pool (contextId = pool name)
    const poolRs = await db.execute({ sql: "SELECT max_members FROM pools WHERE name = ?", args: [contextId] });
    if (poolRs.rows.length === 0) return json({ ok: false, error: 'Context not found' }, 404);
    const maxMembers = (poolRs.rows[0] as any).max_members;
    const countRs = await db.execute({ sql: "SELECT COUNT(*) as count FROM pool_members WHERE pool = ?", args: [contextId] });
    if ((countRs.rows[0] as any).count >= maxMembers) return json({ ok: false, error: 'Context is full' }, 403);
    await db.execute({ sql: "INSERT OR IGNORE INTO pool_members (pool, agent_id) VALUES (?, ?)", args: [contextId, agentId] });
    notifySubscribers('pool', contextId, 'agent_joined', { contextId, agentId }).catch(() => {});
    return json({ ok: true, contextId, agentId });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

async function handleACPLeaveContext(req: Request): Promise<Response> {
  try {
    const b = await body(req);
    const agentId = b.agentId;
    const params = (req as any)._params as Record<string, string> | undefined;
    const contextId = b.contextId || params?.id || '';
    if (!agentId || !contextId) return json({ ok: false, error: 'Missing agentId or contextId' }, 400);
    const db = await getDb();
    const agentErr = await ensureAgent(db, agentId);
    if (agentErr) return await getJson(agentErr);
    await db.execute({ sql: "DELETE FROM pool_members WHERE pool = ? AND agent_id = ?", args: [contextId, agentId] });
    notifySubscribers('pool', contextId, 'agent_left', { contextId, agentId }).catch(() => {});
    return json({ ok: true, contextId, agentId });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

// GET /api/acp/agents — List all agents (public)
// GET /api/acp/agents/{agentId} — Get single agent details (public)
async function handleACPAgents(req: Request): Promise<Response> {
  const params = (req as any)._params as Record<string, string> | undefined;
  const agentId = params?.agentId;
  if (agentId) {
    // Single agent detail
    const db = await getDb();
    const rs = await db.execute({ sql: "SELECT agent_id, name, role, queues, poll_interval, registered_at FROM agents WHERE agent_id = ?", args: [agentId] });
    if (!rs.rows.length) return json({ ok: false, error: 'Agent not found' }, 404);
    const r = rs.rows[0] as any;
    // Also get which pools this agent is in
    const poolRs = await db.execute({ sql: "SELECT pool FROM pool_members WHERE agent_id = ?", args: [agentId] });
    return json({
      ok: true,
      agent: {
        agentId: r.agent_id, name: r.name, role: r.role,
        queues: JSON.parse(r.queues || '[]'), pollInterval: r.poll_interval,
        registeredAt: r.registered_at,
        pools: poolRs.rows.map((p: any) => p.pool),
      }
    });
  }
  // List all agents
  return handleAgents(req);
}

// POST /api/acp/contexts/{id}/messages — Speak in a context (Pool)
async function handleACPSpeakContext(req: Request): Promise<Response> {
  try {
    const b = await body(req);
    const agentId = b.agentId;
    const content = b.content;
    const params = (req as any)._params as Record<string, string> | undefined;
    const contextId = b.contextId || params?.id || '';
    if (!agentId || !contextId || !content) return json({ ok: false, error: 'Missing agentId, contextId, or content' }, 400);
    const db = await getDb();
    const agentErr = await ensureAgent(db, agentId);
    if (agentErr) return await getJson(agentErr);
    // Verify context exists
    const poolRs = await db.execute({ sql: "SELECT name FROM pools WHERE name = ?", args: [contextId] });
    if (poolRs.rows.length === 0) return json({ ok: false, error: 'Context not found' }, 404);
    const id = crypto.randomUUID();
    await db.execute({
      sql: "INSERT INTO pool_messages (id, pool, agent_id, content, reply_to, tags, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [id, contextId, agentId, content, b.replyTo || null, JSON.stringify(b.tags || []), JSON.stringify(b.metadata || {})],
    });
    notifySubscribers('pool', contextId, 'message_sent', { contextId, messageId: id, senderId: agentId }).catch(() => {});
    return json({ ok: true, id, contextId });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bad request' }, 400);
  }
}

async function handleACPGetMessages(req: Request): Promise<Response> {
  // Public endpoint - get Pool messages
  return handlePoolMessages(req);
}

// ─── Route table ───────────────────────────────────────────────────────────
type Handler = (req: Request) => Promise<Response>;

const PUBLIC_ROUTES: Record<string, Handler> = {
  "": handleIndex, // 匹配 /api
  "/": handleIndex, // 兼容旧路径
  "agents": handleAgents,
  "queues": handleQueues,
  "peek": handlePeek,
  "pools": handlePools,
  "skill": handleSkill,
  "skills": handleSkill,
  "dashboard": handleDashboard,
  "mcp": handleMcpConfig,
  "pool/messages": handlePoolMessages,
  "pool/members": handlePoolMembers,
  // A2A Protocol (Google Agent-to-Agent)
  "a2a/tasks": handleA2ATasks,
  "a2a/tasks/cancel": handleA2ACancelTask,
  "a2a/tasks/pushNotificationConfig/set": handleA2ASetPushNotification,
  // ACP Protocol (Agent Communication Protocol)
  "acp/runs": handleACPRuns,
  "acp/runs/cancel": handleACPCancelRun,
  "acp/contexts": handleACPContexts,
  "acp/contexts/join": handleACPJoinContext,
  "acp/contexts/leave": handleACPLeaveContext,
  // ACP read-only (public for polling)
  "acp/agents": handleACPAgents,
  "acp/contexts/messages": handleACPGetMessages,
  ".well-known/agent-card.json": handleAgentCard,
};

const AUTH_ROUTES: Record<string, Handler> = {
  "agent/register": handleAgentRegister,
  "agent/produce": handleProduce,
  "agent/consume": handleConsume,
  "agent/pipe": handlePipe,
  "pool/create": handlePoolCreate,
  "pool/join": handlePoolJoin,
  "pool/leave": handlePoolLeave,
  "pool/speak": handlePoolSpeak,
};

// ─── Entry point ───────────────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  // CORS 预检请求直接返回
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(req.url);
  
  // MCP JSON-RPC 请求处理（POST /api/mcp）
  if (url.pathname === "/api/mcp" && req.method === "POST") {
    return handleMcpRequest(req);
  }
  
  // 新增：处理 /mcp 路径（不带 /api 前缀）
  if (url.pathname === "/mcp") {
    if (req.method === "GET") {
      // GET /mcp - 返回 SSE 流
      const encoder = new TextEncoder();
      
      const stream = new ReadableStream({
        start(controller) {
          // 发送 MCP 初始化消息
          const initMessage = {
            jsonrpc: "2.0",
            method: "notifications/initialized",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: { listChanged: true },
                resources: {},
              },
              serverInfo: {
                name: "LiteHub",
                version: "2.0.0",
              },
            },
          };
          
          const sseMessage = `data: ${JSON.stringify(initMessage)}\n\n`;
          controller.enqueue(encoder.encode(sseMessage));
          
          // 心跳保持连接
          const interval = setInterval(() => {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }, 15000);
          
          // 连接关闭时清理
          req.signal.addEventListener("abort", () => {
            clearInterval(interval);
            controller.close();
          });
        },
      });
      
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, mcp-session-id",
          // 强制设置 Content-Type
          "X-Content-Type-Options": "nosniff",
        },
      });
    } else if (req.method === "POST" || req.method === "DELETE") {
      // POST/DELETE /mcp - 处理 JSON-RPC
      return handleMcpRequest(req);
    } else {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }
  }
  
  const path = url.pathname.replace(/^\/api/, "").replace(/^\/+/, "").replace(/\/+$/, "") || "";
  
  // Pattern-based route dispatch — supports {id} params
  let matched = findHandler(path);
  if (!matched) {
    return json({ ok: false, error: "Not Found", path }, 404);
  }

  // Auth check for protected routes
  if (matched.auth && !validateAuth(req)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  try {
    // Attach params to request for handlers that need them
    (req as any)._params = matched.params;
    return await matched.handler(req);
  } catch (err) {
    console.error(`Handler error for ${path}:`, err);
    return json({
      ok: false, error: "Internal Server Error",
      message: err instanceof Error ? err.message : "Unknown error",
    }, 500);
  }
}