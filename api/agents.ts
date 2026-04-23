// api/agents.ts — GET /api/agents + POST /api/agent/register
import { getClient, validateAuth, jsonResponse, parseBody, corsResponse } from "./_lib/db.js";

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return corsResponse();
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/api/agents" && req.method === "GET") {
    const db = getClient();
    const rs = await db.execute("SELECT * FROM agents ORDER BY registered_at DESC");
    const agents = rs.rows.map((r: any) => ({
      agentId: r.agent_id,
      name: r.name,
      role: r.role,
      queues: JSON.parse(r.queues || "[]"),
      pollInterval: r.poll_interval,
      registeredAt: r.registered_at
    }));
    return jsonResponse({ ok: true, agents });
  }

  if (path === "/api/agent/register" && req.method === "POST") {
    const body = await parseBody(req);
    const { agentId, name, role, queues, pollInterval } = body;
    if (!agentId || !name || !role) {
      return jsonResponse({ ok: false, error: "Missing required fields" }, 400);
    }
    const db = getClient();
    await db.execute({
      sql: `INSERT OR REPLACE INTO agents (agent_id, name, role, queues, poll_interval) VALUES (?, ?, ?, ?, ?)`,
      args: [agentId, name, role, JSON.stringify(queues || []), pollInterval || 0]
    });
    return jsonResponse({ ok: true, agentId });
  }

  return jsonResponse({ ok: false, error: "Not found" }, 404);
}
