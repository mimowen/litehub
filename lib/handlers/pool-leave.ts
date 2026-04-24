// handlers/pool-leave.ts — POST /api/pool/leave
import { getClient, validateAuth, jsonResponse, parseBody } from "../../api/_lib/db";

export async function handlePoolLeave(req: Request): Promise<Response> {
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const body = await parseBody(req);
  const { pool, agentId } = body;
  if (!pool || !agentId) return jsonResponse({ ok: false, error: "Missing pool or agentId" }, 400);

  const db = getClient();
  await db.execute({ sql: `DELETE FROM pool_members WHERE pool = ? AND agent_id = ?`, args: [pool, agentId] });
  return jsonResponse({ ok: true });
}