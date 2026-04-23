// api/queues.ts — GET /api/queues
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

    await initDb();
    const db = getClient();
    const result = await db.execute("SELECT * FROM queues ORDER BY created_at");
    const queues = [];
    for (const q of result.rows) {
      const p = await db.execute({
        sql: "SELECT COUNT(*) as c FROM pointers WHERE queue = ? AND status = 'pending'",
        args: [q.name],
      });
      const d = await db.execute({
        sql: "SELECT COUNT(*) as c FROM pointers WHERE queue = ? AND status = 'consumed'",
        args: [q.name],
      });
      queues.push({
        name: q.name,
        description: q.description,
        pending: (p.rows[0] as any).c,
        consumed: (d.rows[0] as any).c,
        createdAt: q.created_at,
      });
    }
    return jsonResponse({ ok: true, queues });
  },
};
