// api/pool/leave.ts — 离开 Pool
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
    await db.execute({ sql: "DELETE FROM pool_members WHERE pool = ? AND agent_id = ?", args: [pool, agentId] });
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