// api/agent/produce.ts — POST /api/agent/produce
import { initDb, getClient, jsonResponse, parseBody, validateAuth } from "../_lib/turso.js";

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }
    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    }

    const authErr = validateAuth(request);
    if (authErr) return authErr;

    const body = await parseBody(request);
    const { agentId, queue, data, contentType, metadata, sourcePointerId } = body;
    if (!agentId || !queue || data === undefined) {
      return jsonResponse({ ok: false, error: "Missing required fields: agentId, queue, data" }, 400);
    }

    await initDb();
    const db = getClient();
    await db.execute({ sql: "INSERT OR IGNORE INTO queues (name) VALUES (?)", args: [queue] });

    // Build lineage
    let lineage: string[] = [];
    if (sourcePointerId) {
      const srcResult = await db.execute({ sql: "SELECT lineage FROM pointers WHERE id = ?", args: [sourcePointerId] });
      if (srcResult.rows.length > 0) {
        try { lineage = JSON.parse((srcResult.rows[0].lineage as string) || "[]"); } catch { lineage = []; }
      }
    }
    if (lineage.length === 0) lineage = [agentId];
    else if (lineage[lineage.length - 1] !== agentId) lineage = [...lineage, agentId];

    const id = crypto.randomUUID();
    const text = String(data);
    await db.execute({
      sql: "INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata, lineage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      args: [id, queue, agentId, text, text.length, contentType || "text/plain", JSON.stringify(metadata || {}), JSON.stringify(lineage)],
    });

    return jsonResponse({
      ok: true,
      pointer: { id, queue, size: text.length, producerId: agentId, lineage, createdAt: new Date().toISOString() },
    });
  },
};
