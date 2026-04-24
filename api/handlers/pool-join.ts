// handlers/pool-join.ts — POST /api/pool/join
import { getClient, validateAuth, jsonResponse, parseBody } from "../_lib/db";

export async function handlePoolJoin(req: Request): Promise<Response> {
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

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