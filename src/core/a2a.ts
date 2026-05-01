// src/core/a2a.ts — A2A 协议适配（Task → Queue 映射）
// Google Agent-to-Agent 协议：Tasks 映射到 LiteHub Queues
// 使用 Web Crypto API 替代 uuid 包，兼容 Edge Runtime
import type { DbClient } from "../adapters/db/interface.js";
import { getOne } from "../adapters/db/interface.js";
import { ensureAgent, produce } from "./queue.js";
import { notifySubscribers, setPushSubscription, getPushSubscriptions } from "./webhook.js";

// ─── Types ────────────────────────────────────────────────────────────────

export interface A2ATask {
  taskId: string;
  name: string;
  description?: string;
  status: string;
  queueName: string;
  agentId: string;
  createdAt: string;
  updatedAt: string;
  messages?: Array<{ data: unknown; createdAt: string }>;
}

export interface CreateTaskParams {
  agentId: string;
  targetAgentId?: string;
  taskId?: string;
  name?: string;
  input?: unknown;
  messageId?: string;
  metadata?: Record<string, unknown>;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────

export async function createTask(
  db: DbClient,
  params: CreateTaskParams,
): Promise<{ ok: boolean; taskId?: string; error?: string; id?: string; queue?: string }> {
  const { agentId, targetAgentId, taskId, name, input, messageId, metadata } = params;

  const agentExists = await ensureAgent(db, agentId);
  if (!agentExists) {
    return { ok: false, error: "Agent not registered. Call register first." };
  }

  const realTaskId = taskId || crypto.randomUUID();
  const queueName = `a2a:${targetAgentId || agentId}:${realTaskId}`;

  // Insert into a2a_tasks for protocol tracking
  await db.execute(
    "INSERT OR IGNORE INTO a2a_tasks (id, name, description, status, queue, agent_id) VALUES (?, ?, ?, 'pending', ?, ?)",
    [realTaskId, name ?? "", JSON.stringify(input ?? {}), queueName, agentId],
  );

  // Produce the task message into the queue
  const pointer = await produce(db, queueName, JSON.stringify({ taskId: realTaskId, name, input, messageId, metadata }), agentId);

  return { ok: true, taskId: realTaskId, id: pointer?.id, queue: queueName };
}

export async function getTask(
  db: DbClient,
  taskId: string,
): Promise<A2ATask | null> {
  const row = getOne(
    await db.execute(
      "SELECT id, name, description, status, queue, agent_id, created_at, updated_at FROM a2a_tasks WHERE id = ?",
      [taskId],
    ),
  );
  if (!row) return null;

  // Get all messages in this queue
  const msgResult = await db.execute(
    "SELECT data, created_at FROM pointers WHERE queue = ? ORDER BY created_at",
    [row.queue as string],
  );

  const messages = msgResult.rows.map((r) => {
    let d: unknown = r.data;
    try { d = JSON.parse(r.data as string); } catch { /* keep raw */ }
    return { data: d, createdAt: r.created_at as string };
  });

  return {
    taskId: row.id as string,
    name: row.name as string,
    description: row.description as string,
    status: row.status as string,
    queueName: row.queue as string,
    agentId: row.agent_id as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    messages,
  };
}

export async function listTasks(
  db: DbClient,
  options?: { agentId?: string; status?: string; limit?: number },
): Promise<A2ATask[]> {
  const limit = options?.limit || 20;
  let sql = "SELECT id, name, description, status, queue, agent_id, created_at, updated_at FROM a2a_tasks WHERE 1=1";
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
    taskId: r.id as string,
    name: r.name as string,
    description: r.description as string,
    status: r.status as string,
    queueName: r.queue as string,
    agentId: r.agent_id as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

export async function updateTask(
  db: DbClient,
  taskId: string,
  agentId: string,
  status: string,
): Promise<{ ok: boolean; updated: number; error?: string }> {
  const validStatuses = ["running", "completed", "failed", "cancelled"];
  if (!validStatuses.includes(status)) {
    return { ok: false, updated: 0, error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` };
  }
  const result = await db.execute(
    "UPDATE a2a_tasks SET status = ?, updated_at = datetime('now') WHERE id = ? AND agent_id = ? AND status NOT IN ('cancelled', 'completed', 'failed')",
    [status, taskId, agentId],
  );
  return { ok: true, updated: result.rowsAffected };
}

export async function cancelTask(
  db: DbClient,
  taskId: string,
  agentId: string,
): Promise<{ ok: boolean; cancelled: number }> {
  const result = await db.execute(
    "UPDATE a2a_tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND agent_id = ? AND status = 'pending'",
    [taskId, agentId],
  );
  return { ok: true, cancelled: result.rowsAffected };
}

// ─── Push Notification (A2A specific) ─────────────────────────────────────

export async function setPushNotification(
  db: DbClient,
  params: {
    agentId: string;
    taskId?: string;
    webhookUrl: string;
    secret?: string;
  },
) {
  return setPushSubscription(db, { ...params, scope: "a2a" });
}

export async function getPushNotification(
  db: DbClient,
  agentId: string,
) {
  return getPushSubscriptions(db, agentId, "a2a");
}
