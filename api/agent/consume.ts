// api/agent/consume.ts — POST /api/agent/consume
import { initDb, getClient, jsonResponse, parseBody } from "../_lib/turso";

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }
    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    }

    const body = await parseBody(request);
    const { agentId, queue, maxItems } = body;
    if (!agentId || !queue) {
      return jsonResponse({ ok: false, error: "Missing required fields: agentId, queue" }, 400);
    }

    await initDb();
    const db = getClient();
    const result = await db.execute({
      sql: "SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT ?",
      args: [queue, maxItems || 1],
    });

    const items = [];
    for (const row of result.rows) {
      await db.execute({
        sql: "UPDATE pointers SET status = 'consumed' WHERE id = ?",
        args: [row.id],
      });
      const buf = Buffer.from(row.data as string, "utf-8");
      items.push({
        pointer: {
          id: row.id,
          queue: row.queue,
          size: row.size,
          producerId: row.producer_id,
          contentType: row.content_type,
          metadata: JSON.parse((row.metadata as string) || "{}"),
          createdAt: row.created_at,
        },
        data: buf.toString("base64"),
        text: buf.toString("utf-8"),
      });
    }

    return jsonResponse({ ok: true, items });
  },
};
