// handlers/consume.ts — POST /api/agent/consume
import { getClient, validateAuth, jsonResponse, parseBody } from "../../api/_lib/db";

export async function handleConsume(req: Request): Promise<Response> {
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const body = await parseBody(req);
  const { queue, agentId } = body;
  if (!queue || !agentId) {
    return jsonResponse({ ok: false, error: "Missing queue or agentId" }, 400);
  }

  const db = getClient();
  const rs = await db.execute({
    sql: `SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 10`,
    args: [queue]
  });

  for (const row of rs.rows as any[]) {
    const lineage = JSON.parse(row.lineage || "[]");
    // 死循环检测
    if (lineage.includes(agentId)) {
      await db.execute({ sql: `UPDATE pointers SET status = 'looped' WHERE id = ?`, args: [row.id] });
      continue;
    }
    await db.execute({ sql: `UPDATE pointers SET status = 'consumed' WHERE id = ?`, args: [row.id] });
    return jsonResponse({
      ok: true,
      pointer: {
        id: row.id,
        queue: row.queue,
        producerId: row.producer_id,
        data: row.data,
        size: row.size,
        contentType: row.content_type,
        metadata: JSON.parse(row.metadata || "{}"),
        lineage: lineage
      }
    });
  }
  return jsonResponse({ ok: true, pointer: null });
}
