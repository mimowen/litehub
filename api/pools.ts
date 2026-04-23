// api/pools.ts — 列出所有 Pools
import { getClient, validateAuth } from "./_lib/turso.js";

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
  const authErr = validateAuth(req);
  if (authErr) return authErr;

  try {
    const db = getClient();
    const rs = await db.execute({ sql: "SELECT * FROM pools ORDER BY created_at", args: [] });

    const pools = await Promise.all(rs.rows.map(async (r: any) => {
      const mcRs = await db.execute({ sql: "SELECT COUNT(*) as c FROM pool_members WHERE pool = ?", args: [r.name] });
      return {
        name: r.name,
        description: r.description,
        guidelines: r.guidelines,
        maxMembers: r.max_members,
        memberCount: Number(mcRs.rows[0].c),
        createdAt: r.created_at,
      };
    }));

    return json({ ok: true, pools });
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