// api/agent/pipe.ts — POST /api/agent/pipe
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
    const { agentId, sourceQueue, targetQueue, data, contentType, metadata } = body;
    if (!agentId || !sourceQueue || !targetQueue || data === undefined) {
      return jsonResponse({ ok: false, error: "Missing required fields: agentId, sourceQueue, targetQueue, data" }, 400);
    }

    await initDb();
    const db = getClient();
    const srcResult = await db.execute({
      sql: "SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT 1",
      args: [sourceQueue],
    });

    if (srcResult.rows.length === 0) {
      return jsonResponse({ ok: false, error: "Source queue is empty" }, 404);
    }

    const srcRow = srcResult.rows[0];
    await db.execute({ sql: "UPDATE pointers SET status = 'consumed' WHERE id = ?", args: [srcRow.id] });

    const id = crypto.randomUUID();
    const text = String(data);
    await db.execute({ sql: "INSERT OR IGNORE INTO queues (name) VALUES (?)", args: [targetQueue] });
    await db.execute({
      sql: "INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [id, targetQueue, agentId, text, text.length, contentType || "text/plain",
        JSON.stringify({ ...metadata, sourcePointerId: srcRow.id, sourceQueue })],
    });

    return jsonResponse({ ok: true, input: { id: srcRow.id }, output: { id, queue: targetQueue } });
  },
};
