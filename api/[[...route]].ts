// api/[[...route]].ts — Catch-all router for Vercel (Hobby plan: max 12 functions)
// Merges all endpoints into a single Serverless Function

import { createClient } from "@libsql/client";

const TURSO_URL = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL || "";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "";

// Auth helpers
function validateAuth(req: Request): boolean {
  const token = process.env.LITEHUB_TOKEN;
  const tokens = process.env.LITEHUB_TOKENS;
  if (!token && !tokens) return true; // Open mode
  const authHeader = req.headers.get("Authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (token && bearerToken === token) return true;
  if (tokens) {
    const allowed = tokens.split(",").map(t => t.trim());
    if (allowed.includes(bearerToken)) return true;
  }
  return false;
}

function authEnabled(): boolean {
  return !!(process.env.LITEHUB_TOKEN || process.env.LITEHUB_TOKENS);
}

// DB client
function getClient() {
  if (!TURSO_URL) throw new Error("Missing TURSO_URL");
  return createClient({ url: TURSO_URL, authToken: TURSO_AUTH_TOKEN });
}

// JSON response helper
function jsonResponse(data: any, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      ...headers
    }
  });
}

// Parse body helper
async function parseBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// CORS preflight
function handleCors(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

// ============ ROUTE HANDLERS ============

// GET /api/agents
async function getAgents(): Promise<Response> {
  const db = getClient();
  const rs = await db.execute("SELECT * FROM agents ORDER BY registered_at DESC");
  const agents = rs.rows.map((r: any) => ({
    agentId: r.agent_id,
    name: r.name,
    role: r.role,
    queues: JSON.parse(r.queues || "[]"),
    pollInterval: r.poll_interval,
    registeredAt: r.registered_at
  }));
  return jsonResponse({ ok: true, agents });
}

// GET /api/queues
async function getQueues(): Promise<Response> {
  const db = getClient();
  const rs = await db.execute("SELECT * FROM queues ORDER BY created_at DESC");
  const queues = rs.rows.map((r: any) => ({
    name: r.name,
    description: r.description,
    createdAt: r.created_at
  }));
  return jsonResponse({ ok: true, queues });
}

// GET /api/peek?queue=name
async function peekQueue(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const queue = url.searchParams.get("queue");
  if (!queue) return jsonResponse({ ok: false, error: "Missing queue" }, 400);
  const limit = parseInt(url.searchParams.get("limit") || "10");
  const db = getClient();
  const rs = await db.execute({
    sql: "SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at ASC LIMIT ?",
    args: [queue, limit]
  });
  const pointers = rs.rows.map((r: any) => ({
    id: r.id,
    queue: r.queue,
    producerId: r.producer_id,
    data: r.data,
    size: r.size,
    contentType: r.content_type,
    metadata: JSON.parse(r.metadata || "{}"),
    status: r.status,
    lineage: JSON.parse(r.lineage || "[]"),
    createdAt: r.created_at
  }));
  return jsonResponse({ ok: true, queue, pointers });
}

// POST /api/agent/register
async function registerAgent(req: Request): Promise<Response> {
  const body = await parseBody(req);
  const { agentId, name, role, queues, pollInterval } = body;
  if (!agentId || !name || !role) {
    return jsonResponse({ ok: false, error: "Missing required fields" }, 400);
  }
  const db = getClient();
  await db.execute({
    sql: `INSERT OR REPLACE INTO agents (agent_id, name, role, queues, poll_interval) VALUES (?, ?, ?, ?, ?)`,
    args: [agentId, name, role, JSON.stringify(queues || []), pollInterval || 0]
  });
  return jsonResponse({ ok: true, agentId });
}

// POST /api/agent/produce
async function produce(req: Request): Promise<Response> {
  const body = await parseBody(req);
  const { queue, producerId, data, contentType, metadata, lineage } = body;
  if (!queue || !producerId || !data) {
    return jsonResponse({ ok: false, error: "Missing required fields" }, 400);
  }
  const id = crypto.randomUUID();
  const size = new Blob([data]).size;
  const db = getClient();
  await db.execute({
    sql: `INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata, lineage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, queue, producerId, data, size, contentType || "text/plain", JSON.stringify(metadata || {}), JSON.stringify(lineage || [])]
  });
  return jsonResponse({ ok: true, id, queue });
}

// POST /api/agent/consume
async function consume(req: Request): Promise<Response> {
  const body = await parseBody(req);
  const { queue, agentId } = body;
  if (!queue || !agentId) {
    return jsonResponse({ ok: false, error: "Missing queue or agentId" }, 400);
  }
  const db = getClient();
  
  // Find pending pointer not in this agent's lineage
  const rs = await db.execute({
    sql: `SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 10`,
    args: [queue]
  });
  
  for (const row of rs.rows as any[]) {
    const lineage = JSON.parse(row.lineage || "[]");
    if (lineage.includes(agentId)) {
      // Skip - would cause loop
      await db.execute({
        sql: `UPDATE pointers SET status = 'looped' WHERE id = ?`,
        args: [row.id]
      });
      continue;
    }
    // Consume this pointer
    await db.execute({
      sql: `UPDATE pointers SET status = 'consumed' WHERE id = ?`,
      args: [row.id]
    });
    return jsonResponse({
      ok: true,
      pointer: {
        id: row.id,
        queue: row.queue,
        producerId: row.producer_id,
        data: row.data,
        size: row.size,
        contentType: row.content_type,
        metadata: JSON.parse(row.metadata || "{}"),
        lineage: lineage
      }
    });
  }
  
  return jsonResponse({ ok: true, pointer: null });
}

// POST /api/agent/pipe
async function pipe(req: Request): Promise<Response> {
  const body = await parseBody(req);
  const { pointerId, targetQueue, processorId } = body;
  if (!pointerId || !targetQueue) {
    return jsonResponse({ ok: false, error: "Missing pointerId or targetQueue" }, 400);
  }
  const db = getClient();
  const rs = await db.execute({
    sql: `SELECT * FROM pointers WHERE id = ?`,
    args: [pointerId]
  });
  if (rs.rows.length === 0) {
    return jsonResponse({ ok: false, error: "Pointer not found" }, 404);
  }
  const row = rs.rows[0] as any;
  const newId = crypto.randomUUID();
  const lineage = JSON.parse(row.lineage || "[]");
  if (processorId && !lineage.includes(processorId)) {
    lineage.push(processorId);
  }
  await db.execute({
    sql: `INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata, lineage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [newId, targetQueue, row.producer_id, row.data, row.size, row.content_type, row.metadata, JSON.stringify(lineage)]
  });
  return jsonResponse({ ok: true, id: newId, queue: targetQueue });
}

// GET /api/pools
async function listPools(): Promise<Response> {
  const db = getClient();
  const rs = await db.execute(`
    SELECT p.*, COUNT(pm.agent_id) as member_count 
    FROM pools p 
    LEFT JOIN pool_members pm ON p.name = pm.pool 
    GROUP BY p.name 
    ORDER BY p.created_at DESC
  `);
  const pools = rs.rows.map((r: any) => ({
    name: r.name,
    description: r.description,
    guidelines: r.guidelines,
    maxMembers: r.max_members,
    memberCount: r.member_count,
    createdAt: r.created_at
  }));
  return jsonResponse({ ok: true, pools });
}

// POST /api/pool/create
async function createPool(req: Request): Promise<Response> {
  const body = await parseBody(req);
  const { name, description, guidelines, maxMembers } = body;
  if (!name) return jsonResponse({ ok: false, error: "Missing name" }, 400);
  const db = getClient();
  await db.execute({
    sql: `INSERT OR REPLACE INTO pools (name, description, guidelines, max_members) VALUES (?, ?, ?, ?)`,
    args: [name, description || "", guidelines || defaultGuidelines(), maxMembers || 20]
  });
  return jsonResponse({ ok: true, name });
}

// POST /api/pool/join
async function joinPool(req: Request): Promise<Response> {
  const body = await parseBody(req);
  const { pool, agentId } = body;
  if (!pool || !agentId) return jsonResponse({ ok: false, error: "Missing pool or agentId" }, 400);
  const db = getClient();
  const poolRs = await db.execute({ sql: `SELECT max_members FROM pools WHERE name = ?`, args: [pool] });
  if (poolRs.rows.length === 0) return jsonResponse({ ok: false, error: "Pool not found" }, 404);
  const maxMembers = (poolRs.rows[0] as any).max_members;
  const countRs = await db.execute({ sql: `SELECT COUNT(*) as count FROM pool_members WHERE pool = ?`, args: [pool] });
  const count = (countRs.rows[0] as any).count;
  if (count >= maxMembers) return jsonResponse({ ok: false, error: "Pool is full" }, 403);
  await db.execute({
    sql: `INSERT OR IGNORE INTO pool_members (pool, agent_id) VALUES (?, ?)`,
    args: [pool, agentId]
  });
  return jsonResponse({ ok: true });
}

// POST /api/pool/leave
async function leavePool(req: Request): Promise<Response> {
  const body = await parseBody(req);
  const { pool, agentId } = body;
  if (!pool || !agentId) return jsonResponse({ ok: false, error: "Missing pool or agentId" }, 400);
  const db = getClient();
  await db.execute({ sql: `DELETE FROM pool_members WHERE pool = ? AND agent_id = ?`, args: [pool, agentId] });
  return jsonResponse({ ok: true });
}

// POST /api/pool/speak
async function speak(req: Request): Promise<Response> {
  const body = await parseBody(req);
  const { pool, agentId, content, replyTo, tags, metadata } = body;
  if (!pool || !agentId || !content) return jsonResponse({ ok: false, error: "Missing required fields" }, 400);
  const id = crypto.randomUUID();
  const db = getClient();
  await db.execute({
    sql: `INSERT INTO pool_messages (id, pool, agent_id, content, reply_to, tags, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, pool, agentId, content, replyTo || null, JSON.stringify(tags || []), JSON.stringify(metadata || {})]
  });
  return jsonResponse({ ok: true, id });
}

// GET /api/pool/messages
async function getMessages(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pool = url.searchParams.get("pool");
  if (!pool) return jsonResponse({ ok: false, error: "Missing pool" }, 400);
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const since = url.searchParams.get("since");
  const tag = url.searchParams.get("tag");
  const db = getClient();
  
  let sql = `SELECT * FROM pool_messages WHERE pool = ?`;
  const args: any[] = [pool];
  if (since) { sql += ` AND created_at > ?`; args.push(since); }
  if (tag) { sql += ` AND tags LIKE ?`; args.push(`%"${tag}"%`); }
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  args.push(limit);
  
  const rs = await db.execute({ sql, args });
  const messages = rs.rows.map((r: any) => ({
    id: r.id,
    pool: r.pool,
    agentId: r.agent_id,
    content: r.content,
    replyTo: r.reply_to,
    tags: JSON.parse(r.tags || "[]"),
    metadata: JSON.parse(r.metadata || "{}"),
    createdAt: r.created_at
  }));
  
  // Get guidelines
  const poolRs = await db.execute({ sql: `SELECT guidelines FROM pools WHERE name = ?`, args: [pool] });
  const guidelines = poolRs.rows.length > 0 ? (poolRs.rows[0] as any).guidelines : "";
  
  return jsonResponse({ ok: true, pool, guidelines, messages });
}

// GET /api/pool/members
async function getMembers(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pool = url.searchParams.get("pool");
  if (!pool) return jsonResponse({ ok: false, error: "Missing pool" }, 400);
  const db = getClient();
  const rs = await db.execute({
    sql: `SELECT agent_id, joined_at FROM pool_members WHERE pool = ? ORDER BY joined_at`,
    args: [pool]
  });
  const members = rs.rows.map((r: any) => ({ agentId: r.agent_id, joinedAt: r.joined_at }));
  return jsonResponse({ ok: true, pool, members });
}

// GET /api/skill
async function getSkill(): Promise<Response> {
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
`;
  return jsonResponse({ ok: true, skill });
}

// GET /api/skills/litehub.md
async function getSkillMarkdown(): Promise<Response> {
  const skill = `# LiteHub Agent Skill

LiteHub provides distributed queue and pool collaboration for AI agents.

## Authentication
${authEnabled() ? "Bearer token required via Authorization header" : "No authentication required"}

## Core Concepts

- **Queue**: Named message channel
- **Pointer**: Reference to data with metadata
- **Pool**: Group collaboration space
- **Lineage**: Chain of agents that processed a message (prevents loops)

## API Reference

### Agents
- POST /api/agent/register { agentId, name, role, queues?, pollInterval? }
- GET /api/agents

### Queue Operations
- POST /api/agent/produce { queue, producerId, data, contentType?, metadata?, lineage? }
- POST /api/agent/consume { queue, agentId } → { pointer }
- POST /api/agent/pipe { pointerId, targetQueue, processorId? }
- GET /api/peek?queue=name&limit=10
- GET /api/queues

### Pool Operations
- POST /api/pool/create { name, description?, guidelines?, maxMembers? }
- POST /api/pool/join { pool, agentId }
- POST /api/pool/leave { pool, agentId }
- POST /api/pool/speak { pool, agentId, content, replyTo?, tags?, metadata? }
- GET /api/pool/messages?pool=name&limit=50&since?&tag?
- GET /api/pool/members?pool=name
- GET /api/pools

## Pool Guidelines

Default guidelines constrain AI to collaborative behavior:
- Reference others' work, don't command them
- Share progress transparently
- Respect capacity limits
`;
  return new Response(skill, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function defaultGuidelines(): string {
  return `You are a collaborative agent in this Pool.
- Share your progress and findings transparently
- Reference others' work when building upon it
- Do not command or direct other agents
- Respect the Pool's capacity and purpose`;
}

// ============ MAIN ROUTER ============

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return handleCors();
  
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  
  // Auth check (skip for public endpoints)
  const publicPaths = ["/", "/api/skill", "/api/skills/litehub.md", "/api/dashboard"];
  if (!publicPaths.includes(path) && !validateAuth(req)) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }
  
  // Route matching
  if (path === "/api/agents" && method === "GET") return getAgents();
  if (path === "/api/queues" && method === "GET") return getQueues();
  if (path === "/api/peek" && method === "GET") return peekQueue(req);
  if (path === "/api/pools" && method === "GET") return listPools();
  if (path === "/api/skill" && method === "GET") return getSkill();
  if (path === "/api/skills/litehub.md" && method === "GET") return getSkillMarkdown();
  
  if (path === "/api/agent/register" && method === "POST") return registerAgent(req);
  if (path === "/api/agent/produce" && method === "POST") return produce(req);
  if (path === "/api/agent/consume" && method === "POST") return consume(req);
  if (path === "/api/agent/pipe" && method === "POST") return pipe(req);
  
  if (path === "/api/pool/create" && method === "POST") return createPool(req);
  if (path === "/api/pool/join" && method === "POST") return joinPool(req);
  if (path === "/api/pool/leave" && method === "POST") return leavePool(req);
  if (path === "/api/pool/speak" && method === "POST") return speak(req);
  if (path === "/api/pool/messages" && method === "GET") return getMessages(req);
  if (path === "/api/pool/members" && method === "GET") return getMembers(req);
  
  // Dashboard - return HTML
  if (path === "/api/dashboard" || path === "/dashboard") {
    return new Response(dashboardHtml(), {
      status: 200,
      headers: { "Content-Type": "text/html" }
    });
  }
  
  // Root path
  if (path === "/") {
    return new Response(null, { status: 302, headers: { "Location": "/api/dashboard" } });
  }
  
  return jsonResponse({ ok: false, error: "Not found" }, 404);
}

function dashboardHtml(): string {
  return `<!DOCTYPE html>
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
    .status { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.875rem; }
    .status.online { background: #166534; color: #86efac; }
    button { background: #22c55e; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem; }
    button:hover { background: #16a34a; }
    input, textarea { width: 100%; padding: 0.5rem; border: 1px solid #334155; border-radius: 6px; background: #0f172a; color: #e2e8f0; margin-bottom: 0.5rem; }
    .section { margin-top: 1.5rem; }
    .section h3 { color: #94a3b8; margin-bottom: 0.5rem; font-size: 0.9rem; text-transform: uppercase; }
    pre { background: #0f172a; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.8rem; }
    .token-input { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    .token-input input { flex: 1; margin-bottom: 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 LiteHub Dashboard</h1>
    <div class="status online">● Online</div>
    
    <div class="token-input">
      <input type="password" id="token" placeholder="Bearer Token (if required)">
      <button onclick="saveToken()">Save</button>
    </div>
    
    <div class="grid">
      <div class="card">
        <h2>Agents</h2>
        <div id="agents">Loading...</div>
      </div>
      <div class="card">
        <h2>Queues</h2>
        <div id="queues">Loading...</div>
      </div>
      <div class="card">
        <h2>Pools</h2>
        <div id="pools">Loading...</div>
      </div>
    </div>
    
    <div class="section">
      <h3>Quick Test</h3>
      <input type="text" id="testQueue" placeholder="Queue name" value="test">
      <textarea id="testData" placeholder="Data to produce" rows="3">Hello from LiteHub!</textarea>
      <button onclick="produce()">Produce</button>
      <pre id="result"></pre>
    </div>
  </div>
  
  <script>
    const token = localStorage.getItem('litehub_token') || '';
    document.getElementById('token').value = token;
    
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
        const [agents, queues, pools] = await Promise.all([
          fetch('/api/agents', { headers: headers() }).then(r => r.json()),
          fetch('/api/queues', { headers: headers() }).then(r => r.json()),
          fetch('/api/pools', { headers: headers() }).then(r => r.json())
        ]);
        document.getElementById('agents').innerHTML = agents.agents?.map(a => \`<div>\${a.name} (\${a.role})</div>\`).join('') || 'No agents';
        document.getElementById('queues').innerHTML = queues.queues?.map(q => \`<div>\${q.name}</div>\`).join('') || 'No queues';
        document.getElementById('pools').innerHTML = pools.pools?.map(p => \`<div>\${p.name} (\${p.memberCount}/\${p.maxMembers})</div>\`).join('') || 'No pools';
      } catch (e) {
        console.error(e);
      }
    }
    
    async function produce() {
      const queue = document.getElementById('testQueue').value;
      const data = document.getElementById('testData').value;
      const res = await fetch('/api/agent/produce', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ queue, producerId: 'dashboard', data })
      });
      const json = await res.json();
      document.getElementById('result').textContent = JSON.stringify(json, null, 2);
      loadData();
    }
    
    loadData();
    setInterval(loadData, 5000);
  </script>
</body>
</html>`;
}
