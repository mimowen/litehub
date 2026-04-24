// handlers/pool-messages.ts — GET /api/pool/messages
import { getClient, validateAuth, jsonResponse } from "../../api/_lib/db";

export async function handlePoolMessages(req: Request): Promise<Response> {
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

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

  // 包含 pool guidelines
  const poolRs = await db.execute({ sql: `SELECT guidelines FROM pools WHERE name = ?`, args: [pool] });
  const guidelines = poolRs.rows.length > 0 ? (poolRs.rows[0] as any).guidelines : "";

  return jsonResponse({ ok: true, pool, guidelines, messages });
}