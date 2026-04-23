// api/pool/messages.ts — 获取 Pool 消息（含 guidelines）
import { getClient, validateAuth } from "../_lib/turso.js";

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
  const authErr = validateAuth(req);
  if (authErr) return authErr;

  try {
    const url = new URL(req.url);
    const pool = url.searchParams.get("pool");
    const since = url.searchParams.get("since");
    const tag = url.searchParams.get("tag");
    const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : 50;

    if (!pool) return json({ ok: false, error: "缺少 query: pool" }, 400);

    const db = getClient();
    let sql = "SELECT * FROM pool_messages WHERE pool = ?";
    const args: any[] = [pool];

    if (since) { sql += " AND created_at > ?"; args.push(since); }
    if (tag) { sql += " AND tags LIKE ?"; args.push(`%"${tag}"%`); }
    sql += " ORDER BY created_at DESC LIMIT ?";
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
      createdAt: r.created_at,
    })).reverse();

    // Get pool guidelines
    const poolRs = await db.execute({ sql: "SELECT * FROM pools WHERE name = ?", args: [pool] });
    const guidelines = poolRs.rows.length > 0 ? String(poolRs.rows[0].guidelines) : "";

    return json({ ok: true, messages, guidelines });
  } catch (e: any) {
    return json({ ok: false, error: e.message }, 500);
  }
}

function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
}
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}