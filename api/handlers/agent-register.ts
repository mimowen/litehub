// handlers/agent-register.ts — POST /api/agent/register
import { getClient, validateAuth, jsonResponse, parseBody } from "../_lib/db";

export async function handleAgentRegister(req: Request): Promise<Response> {
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

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
