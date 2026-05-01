// src/core/acp.ts — ACP 协议适配（Run/Context → Pool 映射）
// Agent Communication Protocol：Runs 映射到 Pools (acp:{runId})，Contexts 映射到 Pools (无前缀)
// 使用 Web Crypto API 替代 uuid 包，兼容 Edge Runtime
import type { DbClient } from "../adapters/db/interface.js";
import { getOne } from "../adapters/db/interface.js";
import { ensureAgent } from "./queue.js";
import { createPool, joinPool, leavePool, speak, getMessages, listMembers, getPool } from "./pool.js";
import { notifySubscribers } from "./webhook.js";

// ─── Types ────────────────────────────────────────────────────────────────

export interface ACPRun {
  runId: string;
  name?: string;
  description?: string;
  guidelines?: string;
  creatorId?: string;
  status?: string;
  createdAt?: string;
  members?: Array<{ agentId: string; joinedAt: string }>;
}

export interface ACPContext {
  contextId: string;
  name?: string;
  description?: string;
  guidelines?: string;
  maxMembers?: number;
  creatorId?: string;
  createdAt?: string;
  members?: Array<{ agentId: string; joinedAt: string }>;
}

// ─── Runs ─────────────────────────────────────────────────────────────────

export async function createRun(
  db: DbClient,
  params: {
    agentId: string;
    runId?: string;
    name?: string;
    guidelines?: string;
    maxMembers?: number;
  },
): Promise<{ ok: boolean; runId: string; error?: string }> {
  const { agentId, runId, name, guidelines, maxMembers } = params;

  if (!(await ensureAgent(db, agentId))) {
    return { ok: false, runId: "", error: "Agent not registered. Call register first." };
  }

  const id = runId || crypto.randomUUID();
  const poolName = `acp:${id}`;

  await createPool(db, poolName, name || id, guidelines || "", maxMembers || 10, agentId);

  // Record in acp_runs table for protocol tracking
  await db.execute(
    "INSERT OR IGNORE INTO acp_runs (id, context_id, pool, agent_id, role, guidelines, status) VALUES (?, ?, ?, ?, 'creator', ?, 'active')",
    [id, id, poolName, agentId, guidelines || ""],
  );

  notifySubscribers(db, "acp", poolName, "run_created", { runId: id, creatorId: agentId }).catch(() => {});

  return { ok: true, runId: id };
}

export async function getRun(
  db: DbClient,
  runId: string,
): Promise<ACPRun | null> {
  const row = getOne(
    await db.execute(
      "SELECT id, context_id, pool, agent_id, role, guidelines, status, created_at, ended_at FROM acp_runs WHERE id = ?",
      [runId],
    ),
  );
  if (!row) return null;

  const poolName = row.pool as string;
  const members = await listMembers(db, poolName);

  return {
    runId,
    name: (row.context_id as string) || runId,
    description: "",
    guidelines: row.guidelines as string,
    creatorId: row.agent_id as string,
    status: row.status as string,
    createdAt: row.created_at as string,
    members: members.map((m) => ({ agentId: m.agentId, joinedAt: m.joinedAt })),
  };
}

export async function listRuns(
  db: DbClient,
  options?: { agentId?: string; status?: string; limit?: number },
): Promise<ACPRun[]> {
  const limit = options?.limit || 20;
  let sql = "SELECT id, context_id, pool, agent_id, guidelines, status, created_at FROM acp_runs WHERE 1=1";
  const args: unknown[] = [];

  if (options?.agentId) {
    sql += " AND agent_id = ?";
    args.push(options.agentId);
  }
  if (options?.status) {
    sql += " AND status = ?";
    args.push(options.status);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  args.push(limit);

  const result = await db.execute(sql, args);
  return result.rows.map((r) => ({
    runId: r.id as string,
    name: (r.context_id as string) || (r.id as string),
    guidelines: r.guidelines as string,
    creatorId: r.agent_id as string,
    status: r.status as string,
    createdAt: r.created_at as string,
  }));
}

export async function cancelRun(
  db: DbClient,
  runId: string,
  agentId: string,
): Promise<{ ok: boolean; cancelled: number }> {
  if (!(await ensureAgent(db, agentId))) {
    return { ok: false, cancelled: 0 };
  }
  const result = await db.execute(
    "UPDATE acp_runs SET status = 'cancelled', ended_at = datetime('now') WHERE id = ? AND agent_id = ? AND status = 'active'",
    [runId, agentId],
  );
  return { ok: true, cancelled: result.rowsAffected };
}

// ─── Contexts ─────────────────────────────────────────────────────────────

export async function createContext(
  db: DbClient,
  params: {
    agentId: string;
    contextId?: string;
    name?: string;
    guidelines?: string;
  },
): Promise<{ ok: boolean; contextId: string; error?: string }> {
  const { agentId, contextId, name, guidelines } = params;

  if (!(await ensureAgent(db, agentId))) {
    return { ok: false, contextId: "", error: "Agent not registered. Call register first." };
  }

  const id = contextId || crypto.randomUUID();
  await createPool(db, id, name || id, guidelines || "", undefined, agentId);

  return { ok: true, contextId: id };
}

export async function getContext(
  db: DbClient,
  contextId: string,
): Promise<ACPContext | null> {
  const pool = await getPool(db, contextId);
  if (!pool) return null;

  const members = await listMembers(db, contextId);

  return {
    contextId,
    name: pool.description || pool.name,
    description: pool.description,
    guidelines: pool.guidelines,
    maxMembers: pool.maxMembers,
    creatorId: pool.creatorId,
    createdAt: pool.createdAt,
    members: members.map((m) => ({ agentId: m.agentId, joinedAt: m.joinedAt })),
  };
}

export async function listContexts(
  db: DbClient,
  options?: { limit?: number },
): Promise<ACPContext[]> {
  const limit = options?.limit || 50;
  const result = await db.execute(
    "SELECT name, description, guidelines, max_members, creator_id, created_at FROM pools WHERE name NOT LIKE 'acp:%' ORDER BY created_at DESC LIMIT ?",
    [limit],
  );
  return result.rows.map((r) => ({
    contextId: r.name as string,
    name: r.description as string,
    guidelines: r.guidelines as string,
    maxMembers: r.max_members as number,
    creatorId: r.creator_id as string,
    createdAt: r.created_at as string,
  }));
}

export async function joinContext(
  db: DbClient,
  contextId: string,
  agentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await joinPool(db, contextId, agentId);
  if (result.ok) {
    notifySubscribers(db, "pool", contextId, "agent_joined", { contextId, agentId }).catch(() => {});
  }
  return result;
}

export async function leaveContext(
  db: DbClient,
  contextId: string,
  agentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await leavePool(db, contextId, agentId);
  if (result.ok) {
    notifySubscribers(db, "pool", contextId, "agent_left", { contextId, agentId }).catch(() => {});
  }
  return result;
}

export async function speakContext(
  db: DbClient,
  contextId: string,
  agentId: string,
  content: string,
  options?: { replyTo?: string; tags?: string[]; metadata?: Record<string, string> },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const result = await speak(db, contextId, agentId, content, options);
  if ("error" in result) {
    return { ok: false, error: result.error };
  }
  notifySubscribers(db, "pool", contextId, "message_sent", {
    contextId,
    messageId: result.id,
    senderId: agentId,
  }).catch(() => {});
  return { ok: true, id: result.id };
}

export async function getContextMessages(
  db: DbClient,
  contextId: string,
  options?: { limit?: number },
) {
  return getMessages(db, contextId, options);
}

// ─── Agent Discovery ──────────────────────────────────────────────────────

export async function getACPAgent(
  db: DbClient,
  agentId: string,
): Promise<{
  agentId: string;
  name: string;
  role: string;
  queues: string[];
  pollInterval: number;
  registeredAt: string;
  pools: string[];
} | null> {
  const row = getOne(
    await db.execute(
      "SELECT agent_id, name, role, queues, poll_interval, registered_at FROM agents WHERE agent_id = ?",
      [agentId],
    ),
  );
  if (!row) return null;

  const poolResult = await db.execute(
    "SELECT pool FROM pool_members WHERE agent_id = ?",
    [agentId],
  );

  return {
    agentId: row.agent_id as string,
    name: row.name as string,
    role: row.role as string,
    queues: JSON.parse((row.queues as string) || "[]"),
    pollInterval: (row.poll_interval as number) || 0,
    registeredAt: row.registered_at as string,
    pools: poolResult.rows.map((r) => r.pool as string),
  };
}

