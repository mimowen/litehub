// handlers/agents.ts — GET /api/agents
import { getClient, validateAuth, jsonResponse } from "../_lib/db";

export async function handleAgents(req: Request): Promise<Response> {
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

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
