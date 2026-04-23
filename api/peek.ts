// api/peek.ts — GET /api/peek?queue=name
import { initDb, getClient, jsonResponse, validateAuth } from "./_lib/turso.js";

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }
    if (request.method !== "GET") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    }

    const authErr = validateAuth(request);
    if (authErr) return authErr;

    const url = new URL(request.url);
    const queue = url.searchParams.get("queue");
    if (!queue) return jsonResponse({ ok: false, error: "Missing query: queue" }, 400);

    await initDb();
    const db = getClient();
    const result = await db.execute({
      sql: "SELECT id, queue, size, producer_id, content_type, metadata, created_at FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT 1",
      args: [queue],
    });

    if (result.rows.length === 0) {
      return jsonResponse({ ok: false, error: "Queue is empty" }, 404);
    }

    const r = result.rows[0] as any;
    return jsonResponse({
      ok: true,
      pointer: {
        id: r.id,
        queue: r.queue,
        size: r.size,
        producerId: r.producer_id,
        contentType: r.content_type,
        metadata: JSON.parse(r.metadata || "{}"),
        createdAt: r.created_at,
      },
    });
  },
};
