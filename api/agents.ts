// api/agents.ts — GET /api/agents
import { initDb, getClient, jsonResponse } from "./_lib/turso";

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }
    if (request.method !== "GET") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    }

    await initDb();
    const db = getClient();
    const result = await db.execute("SELECT * FROM agents ORDER BY registered_at");
    const agents = result.rows.map((r: any) => ({
      agentId: r.agent_id,
      name: r.name,
      role: r.role,
      queues: JSON.parse(r.queues || "[]"),
      pollInterval: r.poll_interval,
      registeredAt: r.registered_at,
    }));
    return jsonResponse({ ok: true, agents });
  },
};
