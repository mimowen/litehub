// api/main.ts — LiteHub Vercel 唯一入口
// 强制开启 Edge Runtime，解决 Node.js 环境下的超时和兼容问题
export const config = {
  runtime: 'edge',
};

// vercel.json rewrites 将所有 /api/* 路由到这里
// 所有逻辑内聚于此文件 + vercel-db.ts，确保 Vercel 打包时完整包含

import { getDb, validateAuth, json, body } from "./vercel-db";

// ─── CORS ──────────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ─── Route handlers ────────────────────────────────────────────────────────

// GET /api
async function handleIndex(_req: Request): Promise<Response> {
  return json({
    ok: true, name: "LiteHub", version: "2.0.0",
    endpoints: { agents: "/api/agents", queues: "/api/queues", pools: "/api/pools", dashboard: "/api/dashboard", skill: "/api/skill", mcp: "/api/mcp" },
  });
}

// GET /api/agents
async function handleAgents(_req: Request): Promise<Response> {
  const db = getDb();
  const rs = await db.execute("SELECT * FROM agents ORDER BY registered_at DESC");
  const agents = rs.rows.map((r: any) => ({
    agentId: r.agent_id, name: r.name, role: r.role,
    queues: JSON.parse(r.queues || "[]"), pollInterval: r.poll_interval, registeredAt: r.registered_at,
  }));
  return json({ ok: true, agents });
}

// GET /api/queues
async function handleQueues(_req: Request): Promise<Response> {
  const db = getDb();
  const rs = await db.execute("SELECT queue, COUNT(*) as pending FROM pointers WHERE status = 'pending' GROUP BY queue ORDER BY queue");
  const queues = rs.rows.map((r: any) => ({ name: r.queue, pending: r.pending }));
  return json({ ok: true, queues });
}

// GET /api/pools
async function handlePools(_req: Request): Promise<Response> {
  const db = getDb();
  const rs = await db.execute(`
    SELECT p.*, COUNT(pm.agent_id) as member_count
    FROM pools p LEFT JOIN pool_members pm ON p.name = pm.pool
    GROUP BY p.name ORDER BY p.created_at DESC
  `);
  const pools = rs.rows.map((r: any) => ({
    name: r.name, description: r.description, guidelines: r.guidelines,
    maxMembers: r.max_members, memberCount: r.member_count, createdAt: r.created_at,
  }));
  return json({ ok: true, pools });
}

// GET /api/peek?queue=name
async function handlePeek(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const queue = url.searchParams.get("queue");
  if (!queue) return json({ ok: false, error: "Missing queue" }, 400);
  const limit = parseInt(url.searchParams.get("limit") || "10");
  const db = getDb();
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
  const { agentId, name, role, queues, pollInterval } = b;
  if (!agentId || !name || !role) return json({ ok: false, error: "Missing required fields: agentId, name, role" }, 400);
  const db = getDb();
  await db.execute({
    sql: "INSERT OR REPLACE INTO agents (agent_id, name, role, queues, poll_interval) VALUES (?, ?, ?, ?, ?)",
    args: [agentId, name, role, JSON.stringify(queues || []), pollInterval || 0],
  });
  return json({ ok: true, agentId });
}

// POST /api/agent/produce
async function handleProduce(req: Request): Promise<Response> {
  const b = await body(req);
  const { queue, producerId, data, contentType, metadata, lineage } = b;
  if (!queue || !producerId || data === undefined) return json({ ok: false, error: "Missing required fields" }, 400);
  const id = crypto.randomUUID();
  const size = new Blob([data]).size;
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata, lineage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, queue, producerId, data, size, contentType || "text/plain", JSON.stringify(metadata || {}), JSON.stringify(lineage || [])],
  });
  return json({ ok: true, id, queue });
}

// POST /api/agent/consume
async function handleConsume(req: Request): Promise<Response> {
  const b = await body(req);
  const { queue, agentId } = b;
  if (!queue || !agentId) return json({ ok: false, error: "Missing queue or agentId" }, 400);
  const db = getDb();
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
  const { pointerId, targetQueue, processorId } = b;
  if (!pointerId || !targetQueue) return json({ ok: false, error: "Missing pointerId or targetQueue" }, 400);
  const db = getDb();
  const rs = await db.execute({ sql: "SELECT * FROM pointers WHERE id = ?", args: [pointerId] });
  if (rs.rows.length === 0) return json({ ok: false, error: "Pointer not found" }, 404);
  const row = rs.rows[0] as any;
  const newId = crypto.randomUUID();
  const lineage = JSON.parse(row.lineage || "[]");
  if (processorId && !lineage.includes(processorId)) lineage.push(processorId);
  await db.execute({
    sql: `INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata, lineage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [newId, targetQueue, row.producer_id, row.data, row.size, row.content_type, row.metadata, JSON.stringify(lineage)],
  });
  return json({ ok: true, id: newId, queue: targetQueue });
}

// POST /api/pool/create
async function handlePoolCreate(req: Request): Promise<Response> {
  const b = await body(req);
  const { name, description, guidelines, maxMembers } = b;
  if (!name) return json({ ok: false, error: "Missing name" }, 400);
  const defaultGuidelines = "You are a collaborative agent in this Pool. Share progress transparently. Reference others' work. Do not command other agents.";
  const db = getDb();
  await db.execute({
    sql: "INSERT OR REPLACE INTO pools (name, description, guidelines, max_members) VALUES (?, ?, ?, ?)",
    args: [name, description || "", guidelines || defaultGuidelines, maxMembers || 20],
  });
  return json({ ok: true, name });
}

// POST /api/pool/join
async function handlePoolJoin(req: Request): Promise<Response> {
  const b = await body(req);
  const { pool, agentId } = b;
  if (!pool || !agentId) return json({ ok: false, error: "Missing pool or agentId" }, 400);
  const db = getDb();
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
  const db = getDb();
  await db.execute({ sql: "DELETE FROM pool_members WHERE pool = ? AND agent_id = ?", args: [pool, agentId] });
  return json({ ok: true });
}

// POST /api/pool/speak
async function handlePoolSpeak(req: Request): Promise<Response> {
  const b = await body(req);
  const { pool, agentId, content, replyTo, tags, metadata } = b;
  if (!pool || !agentId || !content) return json({ ok: false, error: "Missing required fields" }, 400);
  const id = crypto.randomUUID();
  const db = getDb();
  await db.execute({
    sql: "INSERT INTO pool_messages (id, pool, agent_id, content, reply_to, tags, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [id, pool, agentId, content, replyTo || null, JSON.stringify(tags || []), JSON.stringify(metadata || {})],
  });
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
  const db = getDb();
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
  const db = getDb();
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
      <div class="card"><h2>Agents</h2><div id="agents">Loading...</div></div>
      <div class="card"><h2>Queues</h2><div id="queues">Loading...</div></div>
      <div class="card"><h2>Pools</h2><div id="pools">Loading...</div></div>
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
        document.getElementById('agents').innerHTML = agents.agents?.map(a => '<div>' + a.name + ' (' + a.role + ')</div>').join('') || 'No agents';
        document.getElementById('queues').innerHTML = queues.queues?.map(q => '<div>' + q.name + '</div>').join('') || 'No queues';
        document.getElementById('pools').innerHTML = pools.pools?.map(p => '<div>' + p.name + ' (' + p.memberCount + '/' + p.maxMembers + ')</div>').join('') || 'No pools';
      } catch (e) { console.error(e); }
    }

    async function produce() {
      const queue = document.getElementById('testQueue').value;
      const data = document.getElementById('testData').value;
      const res = await fetch('/api/agent/produce', {
        method: 'POST', headers: headers(),
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
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

// MCP 工具定义
const MCP_TOOLS = [
  {
    name: "litehub_register",
    description: "注册一个新的 Agent 到 LiteHub",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent 的唯一标识符" },
        name: { type: "string", description: "Agent 的显示名称" },
        role: { type: "string", description: "Agent 的角色: producer, consumer, 或 both" },
        queues: { type: "array", items: { type: "string" }, description: "Agent 关联的队列列表" },
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
        producerId: { type: "string", description: "生产者 ID" },
        data: { description: "要生产的数据，可以是字符串或对象" },
        contentType: { type: "string", description: "内容类型，默认 text/plain" },
        metadata: { type: "object", description: "元数据，可选" },
        lineage: { type: "array", items: { type: "string" }, description: "溯源信息，可选" }
      },
      required: ["queue", "producerId", "data"]
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
        processorId: { type: "string", description: "处理器 ID，可选" }
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
        description: { type: "string", description: "Pool 描述，可选" },
        guidelines: { type: "string", description: "Pool 指导原则，可选" },
        maxMembers: { type: "number", description: "最大成员数，默认 20" }
      },
      required: ["name"]
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

async function executeMcpTool(req: Request, toolName: string, args: any): Promise<any> {
  const baseUrl = new URL(req.url).origin;

  switch (toolName) {
    case "litehub_register": {
      const mockReq = new Request(`${baseUrl}/api/agent/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      return await handleAgentRegister(mockReq);
    }

    case "litehub_produce": {
      const mockReq = new Request(`${baseUrl}/api/agent/produce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      return await handleProduce(mockReq);
    }

    case "litehub_consume": {
      const mockReq = new Request(`${baseUrl}/api/agent/consume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      return await handleConsume(mockReq);
    }

    case "litehub_peek": {
      const mockReq = new Request(`${baseUrl}/api/peek?queue=${args.queue}&limit=${args.limit || 10}`);
      return await handlePeek(mockReq);
    }

    case "litehub_pipe": {
      const mockReq = new Request(`${baseUrl}/api/agent/pipe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      return await handlePipe(mockReq);
    }

    case "litehub_pool_create": {
      const mockReq = new Request(`${baseUrl}/api/pool/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      return await handlePoolCreate(mockReq);
    }

    case "litehub_pool_join": {
      const mockReq = new Request(`${baseUrl}/api/pool/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      return await handlePoolJoin(mockReq);
    }

    case "litehub_pool_leave": {
      const mockReq = new Request(`${baseUrl}/api/pool/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      return await handlePoolLeave(mockReq);
    }

    case "litehub_pool_speak": {
      const mockReq = new Request(`${baseUrl}/api/pool/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      return await handlePoolSpeak(mockReq);
    }

    case "litehub_pool_messages": {
      const mockReq = new Request(`${baseUrl}/api/pool/messages?pool=${args.pool}&limit=${args.limit || 50}${args.since ? `&since=${args.since}` : ""}${args.tag ? `&tag=${args.tag}` : ""}`);
      return await handlePoolMessages(mockReq);
    }

    case "litehub_agents": {
      const mockReq = new Request(`${baseUrl}/api/agents`);
      return await handleAgents(mockReq);
    }

    case "litehub_queues": {
      const mockReq = new Request(`${baseUrl}/api/queues`);
      return await handleQueues(mockReq);
    }

    case "litehub_pools": {
      const mockReq = new Request(`${baseUrl}/api/pools`);
      return await handlePools(mockReq);
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
  
  // 更加鲁棒的路径提取：移除 /api 前缀，保留核心路径
  let path = url.pathname.replace(/^\/api/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  
  // 确保空路径能正确匹配
  if (!path) path = "";

  // Find handler — public routes first
  let handler = PUBLIC_ROUTES[path];
  let needAuth = false;

  if (!handler && AUTH_ROUTES[path]) {
    handler = AUTH_ROUTES[path];
    needAuth = true;
  }

  if (!handler) {
    // 尝试匹配根路径
    handler = PUBLIC_ROUTES[""];
    if (!handler) {
      return json({ ok: false, error: "Not Found", path }, 404);
    }
  }

  // Auth check for protected routes
  if (needAuth && !validateAuth(req)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  try {
    return await handler(req);
  } catch (err) {
    console.error(`Handler error for ${path}:`, err);
    return json({
      ok: false, error: "Internal Server Error",
      message: err instanceof Error ? err.message : "Unknown error",
    }, 500);
  }
}