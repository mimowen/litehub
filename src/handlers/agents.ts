// src/handlers/agents.ts — Agent registration and query handlers
import type { DbClient } from "../adapters/db/interface.js";
import { registerAgent, getAgent, listAgents } from "../core/queue.js";
import { ok, fail } from "../utils/response.js";

export async function handleRegister(db: DbClient, body: any) {
  const { agentId, name, role, queues, pools, pollInterval } = body;
  if (!agentId || !name || !role) return fail("缺少必填字段: agentId, name, role");
  const queueInput: string[] = queues || [];
  const poolInput = pools || [];
  const result = await registerAgent(
    db,
    { agentId, name, role, queues: queueInput, pollInterval },
    Object.fromEntries(
      queueInput.map((q: any) => [typeof q === "string" ? q : q.name, typeof q === "string" ? "" : q.description || ""]),
    ),
    Object.fromEntries(
      poolInput.map((p: any) => [typeof p === "string" ? p : p.name, { description: typeof p === "string" ? "" : p.description || "", maxMembers: typeof p === "string" ? undefined : p.maxMembers }]),
    ),
  );
  return ok({ agent: result.agent });
}

export async function handleListAgents(db: DbClient) {
  return ok({ agents: await listAgents(db) });
}

export async function handleGetAgent(db: DbClient, agentId: string) {
  const agent = await getAgent(db, agentId);
  if (!agent) return fail("Agent 不存在");
  return ok({ agent });
}
