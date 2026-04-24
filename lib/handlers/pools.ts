// handlers/pools.ts — GET /api/pools
import { getClient, validateAuth, jsonResponse } from "../../api/_lib/db";

export async function handlePools(req: Request): Promise<Response> {
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

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