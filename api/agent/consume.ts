// api/agent/consume.ts — POST /api/agent/consume
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
    const { agentId, queue, maxItems, loopDetection } = body;
    if (!agentId || !queue) {
      return jsonResponse({ ok: false, error: "Missing required fields: agentId, queue" }, 400);
    }

    await initDb();
    const db = getClient();
    const detectLoop = loopDetection !== false; // default true
    const limit = maxItems || 1;

    // Fetch extra rows to account for skipped looped items
    const result = await db.execute({
      sql: "SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT ?",
      args: [queue, limit * 3],
    });

    const items = [];
    for (const row of result.rows) {
      if (items.length >= limit) break;

      // Loop detection
      if (detectLoop) {
        try {
          const lineage: string[] = JSON.parse((row.lineage as string) || "[]");
          if (lineage.includes(agentId)) {
            await db.execute({ sql: "UPDATE pointers SET status = 'looped' WHERE id = ?", args: [row.id] });
            continue; // skip looped item
          }
        } catch { /* invalid lineage, skip check */ }
      }

      await db.execute({
        sql: "UPDATE pointers SET status = 'consumed' WHERE id = ?",
        args: [row.id],
      });
      const buf = Buffer.from(row.data as string, "utf-8");
      const lineage = JSON.parse((row.lineage as string) || "[]");
      items.push({
        pointer: {
          id: row.id,
          queue: row.queue,
          size: row.size,
          producerId: row.producer_id,
          contentType: row.content_type,
          metadata: JSON.parse((row.metadata as string) || "{}"),
          lineage,
          createdAt: row.created_at,
        },
        data: buf.toString("base64"),
        text: buf.toString("utf-8"),
      });
    }

    return jsonResponse({ ok: true, items });
  },
};
