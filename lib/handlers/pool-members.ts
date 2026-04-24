// handlers/pool-members.ts — GET /api/pool/members
import { getClient, validateAuth, jsonResponse } from "../../api/_lib/db";

export async function handlePoolMembers(req: Request): Promise<Response> {
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const pool = url.searchParams.get("pool");
  if (!pool) return jsonResponse({ ok: false, error: "Missing pool" }, 400);

  const db = getClient();
  const rs = await db.execute({
    sql: `SELECT agent_id, joined_at FROM pool_members WHERE pool = ? ORDER BY joined_at`,
    args: [pool]
  });
  const members = rs.rows.map((r: any) => ({ agentId: r.agent_id, joinedAt: r.joined_at }));
  return jsonResponse({ ok: true, pool, members });
}