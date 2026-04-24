// handlers/peek.ts — GET /api/peek?queue=name
import { getClient, validateAuth, jsonResponse } from "../_lib/db";

export async function handlePeek(req: Request): Promise<Response> {
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const queue = url.searchParams.get("queue");
  if (!queue) return jsonResponse({ ok: false, error: "Missing queue" }, 400);

  const limit = parseInt(url.searchParams.get("limit") || "10");
  const db = getClient();
  const rs = await db.execute({
    sql: `SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at ASC LIMIT ?`,
    args: [queue, limit]
  });
  const pointers = rs.rows.map((r: any) => ({
    id: r.id,
    queue: r.queue,
    producerId: r.producer_id,
    data: r.data,
    size: r.size,
    contentType: r.content_type,
    metadata: JSON.parse(r.metadata || "{}"),
    status: r.status,
    lineage: JSON.parse(r.lineage || "[]"),
    createdAt: r.created_at
  }));
  return jsonResponse({ ok: true, queue, pointers });
}
