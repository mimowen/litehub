// api/pool-members.ts — POST /api/pool/join + POST /api/pool/leave + GET /api/pool/members
import { getClient, validateAuth, jsonResponse, parseBody, corsResponse } from "./_lib/db.js";

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return corsResponse();
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/api/pool/join" && req.method === "POST") {
    const body = await parseBody(req);
    const { pool, agentId } = body;
    if (!pool || !agentId) return jsonResponse({ ok: false, error: "Missing pool or agentId" }, 400);
    const db = getClient();
    const poolRs = await db.execute({ sql: `SELECT max_members FROM pools WHERE name = ?`, args: [pool] });
    if (poolRs.rows.length === 0) return jsonResponse({ ok: false, error: "Pool not found" }, 404);
    const maxMembers = (poolRs.rows[0] as any).max_members;
    const countRs = await db.execute({ sql: `SELECT COUNT(*) as count FROM pool_members WHERE pool = ?`, args: [pool] });
    const count = (countRs.rows[0] as any).count;
    if (count >= maxMembers) return jsonResponse({ ok: false, error: "Pool is full" }, 403);
    await db.execute({
      sql: `INSERT OR IGNORE INTO pool_members (pool, agent_id) VALUES (?, ?)`,
      args: [pool, agentId]
    });
    return jsonResponse({ ok: true });
  }

  if (path === "/api/pool/leave" && req.method === "POST") {
    const body = await parseBody(req);
    const { pool, agentId } = body;
    if (!pool || !agentId) return jsonResponse({ ok: false, error: "Missing pool or agentId" }, 400);
    const db = getClient();
    await db.execute({ sql: `DELETE FROM pool_members WHERE pool = ? AND agent_id = ?`, args: [pool, agentId] });
    return jsonResponse({ ok: true });
  }

  if (path === "/api/pool/members" && req.method === "GET") {
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

  return jsonResponse({ ok: false, error: "Not found" }, 404);
}
