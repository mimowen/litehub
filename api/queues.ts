// api/queues.ts — GET /api/queues + GET /api/peek
import { getClient, validateAuth, jsonResponse, corsResponse } from "./_lib/db.js";

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return corsResponse();
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/api/queues" && req.method === "GET") {
    const db = getClient();
    const rs = await db.execute("SELECT * FROM queues ORDER BY created_at DESC");
    const queues = rs.rows.map((r: any) => ({
      name: r.name,
      description: r.description,
      createdAt: r.created_at
    }));
    return jsonResponse({ ok: true, queues });
  }

  if (path === "/api/peek" && req.method === "GET") {
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

  return jsonResponse({ ok: false, error: "Not found" }, 404);
}
