// api/agent/register.ts — POST /api/agent/register
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
    const { agentId, name, role, queues, pollInterval } = body;
    if (!agentId || !name || !role || !queues?.length) {
      return jsonResponse({ ok: false, error: "Missing required fields: agentId, name, role, queues" }, 400);
    }

    await initDb();
    const db = getClient();
    await db.execute({
      sql: "INSERT OR REPLACE INTO agents (agent_id, name, role, queues, poll_interval, registered_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
      args: [agentId, name, role, JSON.stringify(queues), pollInterval || 0],
    });

    for (const q of queues) {
      await db.execute({ sql: "INSERT OR IGNORE INTO queues (name) VALUES (?)", args: [q] });
    }

    return jsonResponse({
      ok: true,
      agent: { agentId, name, role, queues, pollInterval, registeredAt: new Date().toISOString() },
    });
  },
};
