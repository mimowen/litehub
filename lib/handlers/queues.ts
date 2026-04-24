// handlers/queues.ts — GET /api/queues
import { getClient, validateAuth, jsonResponse } from "../../api/_lib/db";

export async function handleQueues(req: Request): Promise<Response> {
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  const db = getClient();
  const rs = await db.execute(`
    SELECT queue, COUNT(*) as pending
    FROM pointers
    WHERE status = 'pending'
    GROUP BY queue
    ORDER BY queue
  `);
  const queues = rs.rows.map((r: any) => ({
    name: r.queue,
    pending: r.pending
  }));
  return jsonResponse({ ok: true, queues });
}
