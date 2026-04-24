// handlers/produce.ts — POST /api/agent/produce
import { getClient, validateAuth, jsonResponse, parseBody } from "../../api/_lib/db";

export async function handleProduce(req: Request): Promise<Response> {
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const body = await parseBody(req);
  const { queue, producerId, data, contentType, metadata, lineage } = body;
  if (!queue || !producerId || !data) {
    return jsonResponse({ ok: false, error: "Missing required fields" }, 400);
  }

  const id = crypto.randomUUID();
  const size = new Blob([data]).size;
  const db = getClient();
  await db.execute({
    sql: `INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata, lineage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, queue, producerId, data, size, contentType || "text/plain", JSON.stringify(metadata || {}), JSON.stringify(lineage || [])]
  });
  return jsonResponse({ ok: true, id, queue });
}
