// api/agent/produce.ts — POST /api/agent/produce
import { initDb, getClient, jsonResponse, parseBody } from "../_lib/turso.js";

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
    const { agentId, queue, data, contentType, metadata } = body;
    if (!agentId || !queue || data === undefined) {
      return jsonResponse({ ok: false, error: "Missing required fields: agentId, queue, data" }, 400);
    }

    await initDb();
    const db = getClient();
    await db.execute({ sql: "INSERT OR IGNORE INTO queues (name) VALUES (?)", args: [queue] });

    const id = crypto.randomUUID();
    const text = String(data);
    await db.execute({
      sql: "INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [id, queue, agentId, text, text.length, contentType || "text/plain", JSON.stringify(metadata || {})],
    });

    return jsonResponse({
      ok: true,
      pointer: { id, queue, size: text.length, producerId: agentId, createdAt: new Date().toISOString() },
    });
  },
};
