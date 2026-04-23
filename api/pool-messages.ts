// api/pool-messages.ts — POST /api/pool/speak + GET /api/pool/messages
import { getClient, validateAuth, jsonResponse, parseBody, corsResponse } from "./_lib/db.js";

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return corsResponse();
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/api/pool/speak" && req.method === "POST") {
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

  if (path === "/api/pool/messages" && req.method === "GET") {
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
    const poolRs = await db.execute({ sql: `SELECT guidelines FROM pools WHERE name = ?`, args: [pool] });
    const guidelines = poolRs.rows.length > 0 ? (poolRs.rows[0] as any).guidelines : "";
    return jsonResponse({ ok: true, pool, guidelines, messages });
  }

  return jsonResponse({ ok: false, error: "Not found" }, 404);
}
