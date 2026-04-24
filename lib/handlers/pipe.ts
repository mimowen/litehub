// handlers/pipe.ts — POST /api/agent/pipe
import { getClient, validateAuth, jsonResponse, parseBody } from "../../api/_lib/db";

export async function handlePipe(req: Request): Promise<Response> {
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const body = await parseBody(req);
  const { pointerId, targetQueue, processorId } = body;
  if (!pointerId || !targetQueue) {
    return jsonResponse({ ok: false, error: "Missing pointerId or targetQueue" }, 400);
  }

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
