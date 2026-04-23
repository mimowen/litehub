// api/consume.ts — POST /api/agent/consume + POST /api/agent/pipe
import { getClient, validateAuth, jsonResponse, parseBody, corsResponse } from "./_lib/db.js";

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return corsResponse();
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/api/agent/consume" && req.method === "POST") {
    const body = await parseBody(req);
    const { queue, agentId } = body;
    if (!queue || !agentId) return jsonResponse({ ok: false, error: "Missing queue or agentId" }, 400);
    const db = getClient();
    const rs = await db.execute({
      sql: `SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 10`,
      args: [queue]
    });
    for (const row of rs.rows as any[]) {
      const lineage = JSON.parse(row.lineage || "[]");
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

  if (path === "/api/agent/pipe" && req.method === "POST") {
    const body = await parseBody(req);
    const { pointerId, targetQueue, processorId } = body;
    if (!pointerId || !targetQueue) return jsonResponse({ ok: false, error: "Missing pointerId or targetQueue" }, 400);
    const db = getClient();
    const rs = await db.execute({ sql: `SELECT * FROM pointers WHERE id = ?`, args: [pointerId] });
    if (rs.rows.length === 0) return jsonResponse({ ok: false, error: "Pointer not found" }, 404);
    const row = rs.rows[0] as any;
    const newId = crypto.randomUUID();
    const lineage = JSON.parse(row.lineage || "[]");
    if (processorId && !lineage.includes(processorId)) lineage.push(processorId);
    await db.execute({
      sql: `INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata, lineage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [newId, targetQueue, row.producer_id, row.data, row.size, row.content_type, row.metadata, JSON.stringify(lineage)]
    });
    return jsonResponse({ ok: true, id: newId, queue: targetQueue });
  }

  return jsonResponse({ ok: false, error: "Not found" }, 404);
}
