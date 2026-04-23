// api/pool/members.ts — 获取 Pool 成员
import { getClient, validateAuth } from "../_lib/turso.js";

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
  const authErr = validateAuth(req);
  if (authErr) return authErr;

  try {
    const url = new URL(req.url);
    const pool = url.searchParams.get("pool");
    if (!pool) return json({ ok: false, error: "缺少 query: pool" }, 400);

    const db = getClient();
    const rs = await db.execute({ sql: "SELECT pool, agent_id, joined_at FROM pool_members WHERE pool = ? ORDER BY joined_at", args: [pool] });
    const members = rs.rows.map((r: any) => ({ pool: r.pool, agentId: r.agent_id, joinedAt: r.joined_at }));
    return json({ ok: true, members });
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