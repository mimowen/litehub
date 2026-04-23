// api/pool/join.ts — 加入 Pool
import { getClient, validateAuth } from "../_lib/turso.js";

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const authErr = validateAuth(req);
  if (authErr) return authErr;

  try {
    const body = (await req.json()) as { pool?: string; agentId?: string };
    const { pool, agentId } = body;
    if (!pool || !agentId) return json({ ok: false, error: "缺少必填字段: pool, agentId" }, 400);

    const db = getClient();

    // Check pool exists and capacity
    const poolRs = await db.execute({ sql: "SELECT * FROM pools WHERE name = ?", args: [pool] });
    if (poolRs.rows.length === 0) return json({ ok: false, error: `Pool '${pool}' not found` }, 400);

    const maxMembers = Number(poolRs.rows[0].max_members);
    const mcRs = await db.execute({ sql: "SELECT COUNT(*) as c FROM pool_members WHERE pool = ?", args: [pool] });
    const memberCount = Number(mcRs.rows[0].c);

    if (memberCount >= maxMembers) {
      return json({ ok: false, error: `Pool '${pool}' is full (${maxMembers}/${maxMembers})` }, 400);
    }

    // Already a member?
    const existing = await db.execute({ sql: "SELECT 1 FROM pool_members WHERE pool = ? AND agent_id = ?", args: [pool, agentId] });
    if (existing.rows.length > 0) return json({ ok: true });

    await db.execute({ sql: "INSERT INTO pool_members (pool, agent_id) VALUES (?, ?)", args: [pool, agentId] });
    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: e.message }, 500);
  }
}

function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
}
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}
