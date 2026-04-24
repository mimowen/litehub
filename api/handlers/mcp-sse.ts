// handlers/mcp-sse.ts — MCP Server over SSE (HTTP)
import { Client } from "@libsql/client";

// MCP Types
interface MCPRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

// Helper functions
function jsonError(code: number, message: string): { code: number; message: string } {
  return { code, message };
}

function getTursoClient(): Client {
  const { createClient } = require("@libsql/client");
  const url = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL || "";
  if (!url) throw new Error("Missing TURSO_URL");
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || "" });
}

function validateToken(authHeader: string | null): boolean {
  const token = process.env.LITEHUB_TOKEN;
  const tokens = process.env.LITEHUB_TOKENS;
  if (!token && !tokens) return true; // Open mode
  
  const bearerToken = (authHeader || "").replace(/^Bearer\s+/i, "");
  if (token && bearerToken === token) return true;
  if (tokens) {
    const allowed = tokens.split(",").map(t => t.trim());
    if (allowed.includes(bearerToken)) return true;
  }
  return false;
}

// MCP Tool handlers
async function handleToolCall(name: string, args: any, db: Client): Promise<any> {
  switch (name) {
    case "litehub-register": {
      const { agentId, name: agentName, role, queues } = args;
      if (!agentId || !agentName || !role) throw new Error("Missing required fields");
      await db.execute({
        sql: `INSERT OR REPLACE INTO agents (agent_id, name, role, queues) VALUES (?, ?, ?, ?)`,
        args: [agentId, agentName, role, JSON.stringify(queues || [])]
      });
      return { success: true, agentId };
    }
    
    case "litehub-produce": {
      const { queue, producerId, data, lineage } = args;
      if (!queue || !producerId || !data) throw new Error("Missing required fields");
      const id = crypto.randomUUID();
      await db.execute({
        sql: `INSERT INTO pointers (id, queue, producer_id, data, lineage) VALUES (?, ?, ?, ?, ?)`,
        args: [id, queue, producerId, data, JSON.stringify(lineage || [])]
      });
      return { success: true, id, queue };
    }
    
    case "litehub-consume": {
      const { queue, agentId } = args;
      if (!queue || !agentId) throw new Error("Missing queue or agentId");
      const rs = await db.execute({
        sql: `SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 10`,
        args: [queue]
      });
      for (const row of rs.rows as any[]) {
        const lineage = JSON.parse(row.lineage || "[]");
        if (lineage.includes(agentId)) {
          await db.execute({ sql: `UPDATE pointers SET status = 'looped' WHERE id = ?`, args: [row.id] });
          continue;
        }
        await db.execute({ sql: `UPDATE pointers SET status = 'consumed' WHERE id = ?`, args: [row.id] });
        return {
          success: true,
          pointer: {
            id: row.id,
            queue: row.queue,
            producerId: row.producer_id,
            data: row.data,
            lineage
          }
        };
      }
      return { success: true, pointer: null };
    }
    
    case "litehub-peek": {
      const { queue, limit = 10 } = args;
      if (!queue) throw new Error("Missing queue");
      const rs = await db.execute({
        sql: `SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at ASC LIMIT ?`,
        args: [queue, limit]
      });
      const pointers = rs.rows.map((r: any) => ({
        id: r.id,
        queue: r.queue,
        producerId: r.producer_id,
        data: r.data,
        lineage: JSON.parse(r.lineage || "[]")
      }));
      return { success: true, pointers };
    }
    
    case "litehub-pipe": {
      const { pointerId, targetQueue, processorId } = args;
      if (!pointerId || !targetQueue) throw new Error("Missing pointerId or targetQueue");
      const rs = await db.execute({ sql: `SELECT * FROM pointers WHERE id = ?`, args: [pointerId] });
      if (rs.rows.length === 0) throw new Error("Pointer not found");
      const row = rs.rows[0] as any;
      const newId = crypto.randomUUID();
      const lineage = JSON.parse(row.lineage || "[]");
      if (processorId && !lineage.includes(processorId)) lineage.push(processorId);
      await db.execute({
        sql: `INSERT INTO pointers (id, queue, producer_id, data, lineage) VALUES (?, ?, ?, ?, ?)`,
        args: [newId, targetQueue, row.producer_id, row.data, JSON.stringify(lineage)]
      });
      return { success: true, id: newId, queue: targetQueue };
    }
    
    case "litehub-pool-create": {
      const { name, description, guidelines, maxMembers } = args;
      if (!name) throw new Error("Missing name");
      await db.execute({
        sql: `INSERT OR REPLACE INTO pools (name, description, guidelines, max_members) VALUES (?, ?, ?, ?)`,
        args: [name, description || "", guidelines || "", maxMembers || 20]
      });
      return { success: true, name };
    }
    
    case "litehub-pool-join": {
      const { pool, agentId } = args;
      if (!pool || !agentId) throw new Error("Missing pool or agentId");
      const poolRs = await db.execute({ sql: `SELECT max_members FROM pools WHERE name = ?`, args: [pool] });
      if (poolRs.rows.length === 0) throw new Error("Pool not found");
      const maxMembers = (poolRs.rows[0] as any).max_members;
      const countRs = await db.execute({ sql: `SELECT COUNT(*) as count FROM pool_members WHERE pool = ?`, args: [pool] });
      if ((countRs.rows[0] as any).count >= maxMembers) throw new Error("Pool is full");
      await db.execute({ sql: `INSERT OR IGNORE INTO pool_members (pool, agent_id) VALUES (?, ?)`, args: [pool, agentId] });
      return { success: true };
    }
    
    case "litehub-pool-speak": {
      const { pool, agentId, content, replyTo, tags } = args;
      if (!pool || !agentId || !content) throw new Error("Missing required fields");
      const id = crypto.randomUUID();
      await db.execute({
        sql: `INSERT INTO pool_messages (id, pool, agent_id, content, reply_to, tags) VALUES (?, ?, ?, ?, ?)`,
        args: [id, pool, agentId, content, replyTo || null, JSON.stringify(tags || [])]
      });
      return { success: true, id };
    }
    
    case "litehub-pool-read": {
      const { pool, limit = 50, since } = args;
      if (!pool) throw new Error("Missing pool");
      let sql = `SELECT * FROM pool_messages WHERE pool = ?`;
      const sqlArgs: any[] = [pool];
      if (since) { sql += ` AND created_at > ?`; sqlArgs.push(since); }
      sql += ` ORDER BY created_at DESC LIMIT ?`;
      sqlArgs.push(limit);
      const rs = await db.execute({ sql, args: sqlArgs });
      const messages = rs.rows.map((r: any) => ({
        id: r.id,
        pool: r.pool,
        agentId: r.agent_id,
        content: r.content,
        replyTo: r.reply_to,
        tags: JSON.parse(r.tags || "[]"),
        createdAt: r.created_at
      }));
      const poolRs = await db.execute({ sql: `SELECT guidelines FROM pools WHERE name = ?`, args: [pool] });
      const guidelines = poolRs.rows.length > 0 ? (poolRs.rows[0] as any).guidelines : "";
      return { success: true, pool, guidelines, messages };
    }
    
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// MCP Protocol handlers
function handleInitialize(params: any): any {
  return {
    protocolVersion: "2024-11-05",
    capabilities: {
      tools: { listChanged: false },
      resources: {}
    },
    serverInfo: {
      name: "litehub",
      version: "2.0.0"
    }
  };
}

function handleToolsList(): any {
  return {
    tools: [
      { name: "litehub-register", description: "注册 Agent", inputSchema: { type: "object", properties: { agentId: { type: "string" }, name: { type: "string" }, role: { type: "string" }, queues: { type: "array", items: { type: "string" } } }, required: ["agentId", "name", "role"] } },
      { name: "litehub-produce", description: "生产数据到队列", inputSchema: { type: "object", properties: { queue: { type: "string" }, producerId: { type: "string" }, data: { type: "string" }, lineage: { type: "array", items: { type: "string" } } }, required: ["queue", "producerId", "data"] } },
      { name: "litehub-consume", description: "从队列消费", inputSchema: { type: "object", properties: { queue: { type: "string" }, agentId: { type: "string" } }, required: ["queue", "agentId"] } },
      { name: "litehub-peek", description: "预览队列", inputSchema: { type: "object", properties: { queue: { type: "string" }, limit: { type: "number" } }, required: ["queue"] } },
      { name: "litehub-pipe", description: "管道传输", inputSchema: { type: "object", properties: { pointerId: { type: "string" }, targetQueue: { type: "string" }, processorId: { type: "string" } }, required: ["pointerId", "targetQueue"] } },
      { name: "litehub-pool-create", description: "创建 Pool", inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, guidelines: { type: "string" }, maxMembers: { type: "number" } }, required: ["name"] } },
      { name: "litehub-pool-join", description: "加入 Pool", inputSchema: { type: "object", properties: { pool: { type: "string" }, agentId: { type: "string" } }, required: ["pool", "agentId"] } },
      { name: "litehub-pool-speak", description: "Pool 发言", inputSchema: { type: "object", properties: { pool: { type: "string" }, agentId: { type: "string" }, content: { type: "string" }, replyTo: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["pool", "agentId", "content"] } },
      { name: "litehub-pool-read", description: "读取 Pool 消息", inputSchema: { type: "object", properties: { pool: { type: "string" }, limit: { type: "number" }, since: { type: "string" } }, required: ["pool"] } },
    ]
  };
}

// SSE handler
export async function handleMcpSse(req: Request): Promise<Response> {
  // Validate auth
  const authHeader = req.headers.get("Authorization");
  if (!validateToken(authHeader)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const encoder = new TextEncoder();
  let db: Client;
  
  try {
    db = getTursoClient();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Database not configured" }), { status: 500 });
  }

  // For POST requests (MCP over SSE)
  if (req.method === "POST") {
    const body = await req.json() as MCPRequest;
    
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          let result: any;
          
          switch (body.method) {
            case "initialize":
              result = handleInitialize(body.params);
              break;
            case "tools/list":
              result = handleToolsList();
              break;
            case "tools/call":
              result = await handleToolCall(body.params?.name, body.params?.arguments || {}, db);
              break;
            case "ping":
              result = {};
              break;
            default:
              throw new Error(`Unknown method: ${body.method}`);
          }
          
          send({ jsonrpc: "2.0", id: body.id, result });
        } catch (err) {
          send({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32603, message: err instanceof Error ? err.message : "Internal error" }
          });
        }
        
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // For GET requests (SSE endpoint info)
  return new Response(JSON.stringify({
    message: "LiteHub MCP Server",
    transport: "sse",
    endpoints: {
      initialize: "POST with { method: 'initialize' }",
      toolsList: "POST with { method: 'tools/list' }",
      toolsCall: "POST with { method: 'tools/call', params: { name: '...', arguments: {...} } }"
    }
  }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}