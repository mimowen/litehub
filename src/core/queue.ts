// src/core/queue.ts — 队列核心操作（平台无关）
// 依赖 DbClient 抽象接口，不依赖任何具体 DB 驱动
// 使用 Web Crypto API (crypto.randomUUID) 替代 uuid 包，兼容 Edge Runtime
import type { DbClient, DbRow } from "../adapters/db/interface.js";
import { getOne, getValue } from "../adapters/db/interface.js";

// ─── Agent ────────────────────────────────────────────────────────────────

export interface AgentInfo {
  agentId: string;
  name: string;
  role: string;
  queues: string[];
  pools?: string[];
  pollInterval: number;
  registeredAt: string;
}

export async function ensureAgent(db: DbClient, agentId: string): Promise<boolean> {
  const result = await db.execute("SELECT 1 FROM agents WHERE agent_id = ?", [agentId]);
  return result.rows.length > 0;
}

export async function registerAgent(
  db: DbClient,
  info: { agentId: string; name: string; role: string; queues: string[]; pollInterval?: number },
  queueDescriptions?: Record<string, string>,
  poolDescriptions?: Record<string, { description?: string; maxMembers?: number }>,
): Promise<{ agent: AgentInfo; createdQueues: string[]; createdPools: string[] }> {
  const now = new Date().toISOString();
  const queueNames = info.queues || [];

  await db.execute(
    `INSERT OR REPLACE INTO agents (agent_id, name, role, queues, poll_interval, registered_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [info.agentId, info.name, info.role, JSON.stringify(queueNames), info.pollInterval || 0, now],
  );

  const createdQueues: string[] = [];
  for (const qName of queueNames) {
    await ensureQueue(db, qName, queueDescriptions?.[qName], info.agentId);
    createdQueues.push(qName);
  }

  // Pools created via pool module — caller should handle separately
  const createdPools: string[] = [];

  return {
    agent: {
      agentId: info.agentId,
      name: info.name,
      role: info.role,
      queues: queueNames,
      pollInterval: info.pollInterval || 0,
      registeredAt: now,
    },
    createdQueues,
    createdPools,
  };
}

export async function getAgent(db: DbClient, agentId: string): Promise<AgentInfo | null> {
  const row = getOne(await db.execute("SELECT * FROM agents WHERE agent_id = ?", [agentId]));
  if (!row) return null;
  return rowToAgent(row);
}

export async function listAgents(db: DbClient): Promise<AgentInfo[]> {
  const result = await db.execute("SELECT * FROM agents ORDER BY registered_at");
  const agents = result.rows.map(rowToAgent);

  // 获取每个 Agent 所属的 Pool
  for (const agent of agents) {
    const poolResult = await db.execute(
      "SELECT pool FROM pool_members WHERE agent_id = ?",
      [agent.agentId],
    );
    agent.pools = poolResult.rows.map((r) => r.pool as string);
  }

  return agents;
}

export async function deleteAgent(db: DbClient, agentId: string): Promise<{ success: boolean; message: string }> {
  const agent = await getAgent(db, agentId);
  if (!agent) {
    return { success: false, message: "Agent not found" };
  }
  
  await db.execute("DELETE FROM agents WHERE agent_id = ?", [agentId]);
  
  return { 
    success: true, 
    message: `Agent '${agentId}' has been unregistered. They need to register again to consume messages.` 
  };
}

function rowToAgent(row: DbRow): AgentInfo {
  return {
    agentId: row.agent_id as string,
    name: row.name as string,
    role: row.role as string,
    queues: JSON.parse((row.queues as string) || "[]"),
    pollInterval: (row.poll_interval as number) || 0,
    registeredAt: row.registered_at as string,
  };
}

// ─── Queue ────────────────────────────────────────────────────────────────

export async function queueExists(db: DbClient, name: string): Promise<boolean> {
  const result = await db.execute("SELECT 1 FROM queues WHERE name = ?", [name]);
  return result.rows.length > 0;
}

export async function ensureQueue(
  db: DbClient,
  name: string,
  description?: string,
  creatorId?: string,
  type?: string,
): Promise<QueueStatus | null> {
  const existing = getOne(await db.execute("SELECT 1 FROM queues WHERE name = ?", [name]));
  if (!existing) {
    await db.execute(
      "INSERT INTO queues (name, description, creator_id, type) VALUES (?, ?, ?, ?)",
      [name, description || "", creatorId || "", type || "user"],
    );
  }
  return getQueueStatus(db, name);
}

export interface QueueStatus {
  name: string;
  description: string;
  pending: number;
  consumed: number;
  creatorId?: string;
  type?: string;
  blocked?: boolean;
  createdAt: string;
}

export async function getQueueStatus(db: DbClient, name: string): Promise<QueueStatus | null> {
  const q = getOne(await db.execute("SELECT * FROM queues WHERE name = ?", [name]));
  if (!q) return null;
  const pending = getValue<number>(await db.execute("SELECT COUNT(*) as c FROM pointers WHERE queue = ? AND status = 'pending'", [name]), "c") || 0;
  const consumed = getValue<number>(await db.execute("SELECT COUNT(*) as c FROM pointers WHERE queue = ? AND status = 'consumed'", [name]), "c") || 0;
  return {
    name: q.name as string,
    description: q.description as string,
    pending,
    consumed,
    creatorId: q.creator_id as string,
    type: q.type as string,
    blocked: (q.blocked as number) === 1,
    createdAt: q.created_at as string,
  };
}

export async function listQueues(db: DbClient, options?: { includeInternal?: boolean }): Promise<QueueStatus[]> {
  const includeInternal = options?.includeInternal || false;
  const sql = includeInternal
    ? "SELECT * FROM queues ORDER BY created_at"
    : "SELECT * FROM queues WHERE type = 'user' OR type IS NULL ORDER BY created_at";
  const result = await db.execute(sql);
  const queues: QueueStatus[] = [];
  for (const r of result.rows) {
    const status = await getQueueStatus(db, r.name as string);
    if (status) queues.push(status);
  }
  return queues;
}

export async function blockQueue(db: DbClient, name: string): Promise<{ success: boolean; message: string }> {
  const queue = await getQueueStatus(db, name);
  if (!queue) {
    return { success: false, message: "Queue not found" };
  }
  
  await db.execute("UPDATE queues SET blocked = 1 WHERE name = ?", [name]);
  
  return { 
    success: true, 
    message: `Queue '${name}' has been blocked. Consumers will not receive messages from this queue.` 
  };
}

export async function unblockQueue(db: DbClient, name: string): Promise<{ success: boolean; message: string }> {
  const queue = await getQueueStatus(db, name);
  if (!queue) {
    return { success: false, message: "Queue not found" };
  }
  
  await db.execute("UPDATE queues SET blocked = 0 WHERE name = ?", [name]);
  
  return { 
    success: true, 
    message: `Queue '${name}' has been unblocked. Consumers can now receive messages.` 
  };
}

// ─── Produce ──────────────────────────────────────────────────────────────

export interface ProduceOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  lineage?: string[];
}

export interface ProduceResult {
  id: string;
  queue: string;
  size: number;
  producerId: string;
  lineage: string[];
  createdAt: string;
}

export async function produce(
  db: DbClient,
  queueName: string,
  data: string,
  producerId: string,
  options?: ProduceOptions,
): Promise<ProduceResult | null> {
  // Queue must exist
  if (!(await queueExists(db, queueName))) return null;

  const id = crypto.randomUUID();
  const size = new TextEncoder().encode(data).length;

  // Build lineage
  let lineage = options?.lineage || [];
  if (lineage.length === 0) {
    lineage = [producerId];
  } else if (lineage[lineage.length - 1] !== producerId) {
    lineage = [...lineage, producerId];
  }

  await db.execute(
    `INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata, lineage, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [id, queueName, producerId, data, size, options?.contentType || "text/plain", JSON.stringify(options?.metadata || {}), JSON.stringify(lineage)],
  );

  return { id, queue: queueName, size, producerId, lineage, createdAt: new Date().toISOString() };
}

// ─── Consume ──────────────────────────────────────────────────────────────

export interface ConsumeOptions {
  loopDetection?: boolean;
}

export interface ConsumeResult {
  pointer: {
    id: string;
    queue: string;
    size: number;
    producerId: string;
    contentType: string;
    metadata: Record<string, string>;
    lineage: string[];
    createdAt: string;
  };
  data: string; // base64
  text: string; // utf-8
}

export async function consume(
  db: DbClient,
  queueName: string,
  consumerId: string,
  maxItems = 1,
  options?: ConsumeOptions,
): Promise<ConsumeResult[]> {
  // Check if agent is registered
  const agentExists = await ensureAgent(db, consumerId);
  if (!agentExists) {
    throw new Error(`Agent '${consumerId}' is not registered. Please register first using /api/agent/register`);
  }
  
  // Check if queue is blocked
  const queueStatus = await getQueueStatus(db, queueName);
  if (!queueStatus) {
    throw new Error(`Queue '${queueName}' does not exist`);
  }
  if (queueStatus.blocked) {
    return [];
  }
  
  const loopDetection = options?.loopDetection !== false;

  const result = await db.execute(
    "SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT ?",
    [queueName, maxItems * 3],
  );
  if (result.rows.length === 0) return [];

  const results: ConsumeResult[] = [];

  for (const row of result.rows) {
    if (results.length >= maxItems) break;

    // Loop detection
    if (loopDetection) {
      try {
        const lineage: string[] = JSON.parse((row.lineage as string) || "[]");
        if (lineage.includes(consumerId)) {
          await db.execute("UPDATE pointers SET status = 'looped' WHERE id = ?", [row.id]);
          continue;
        }
      } catch {
        // invalid lineage JSON, skip check
      }
    }

    await db.execute("UPDATE pointers SET status = 'consumed' WHERE id = ?", [row.id]);

    const lineage = JSON.parse((row.lineage as string) || "[]");
    results.push({
      pointer: {
        id: row.id as string,
        queue: row.queue as string,
        size: row.size as number,
        producerId: row.producer_id as string,
        contentType: (row.content_type as string) || "text/plain",
        metadata: JSON.parse((row.metadata as string) || "{}"),
        lineage,
        createdAt: row.created_at as string,
      },
      data: row.data as string,
      text: row.data as string,
    });
  }

  return results;
}

// ─── Peek ─────────────────────────────────────────────────────────────────

export async function peek(db: DbClient, queueName: string) {
  const row = getOne(await db.execute(
    "SELECT id, queue, size, producer_id, content_type, metadata, created_at FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT 1",
    [queueName],
  ));
  if (!row) return null;
  return {
    id: row.id,
    queue: row.queue,
    size: row.size,
    producerId: row.producer_id,
    contentType: row.content_type,
    metadata: JSON.parse((row.metadata as string) || "{}"),
    createdAt: row.created_at,
  };
}

// ─── Pipe (copy pointer to another queue, no consume) ─────────────────────

export interface PipeResult {
  id: string;
  queue: string;
}

export async function pipe(
  db: DbClient,
  pointerId: string,
  targetQueue: string,
  agentId?: string,
): Promise<PipeResult | null> {
  // Fetch source pointer
  const row = getOne(await db.execute("SELECT * FROM pointers WHERE id = ?", [pointerId]));
  if (!row) return null;

  const newId = crypto.randomUUID();
  const lineage: string[] = JSON.parse((row.lineage as string) || "[]");
  if (agentId && !lineage.includes(agentId)) lineage.push(agentId);

  await db.execute(
    `INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata, lineage, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [newId, targetQueue, row.producer_id, row.data, row.size, row.content_type, row.metadata, JSON.stringify(lineage)],
  );

  return { id: newId, queue: targetQueue };
}

// ─── Update Queue Description ─────────────────────────────────────────────

export async function updateQueueDescription(
  db: DbClient,
  name: string,
  description: string,
): Promise<QueueStatus | null> {
  const exists = await queueExists(db, name);
  if (!exists) return null;
  await db.execute("UPDATE queues SET description = ? WHERE name = ?", [description, name]);
  return getQueueStatus(db, name);
}

// ─── Queue History (all statuses) ─────────────────────────────────────────

export interface HistoryPointer {
  id: string;
  queue: string;
  status: 'pending' | 'consumed' | 'looped';
  size: number;
  producerId: string;
  contentType: string;
  metadata: Record<string, string>;
  lineage: string[];
  createdAt: string;
  consumedAt?: string;
}

export interface QueueHistoryOptions {
  status?: string;
  afterId?: string;
  limit?: number;
}

export async function getQueueHistory(
  db: DbClient,
  queueName: string,
  options?: QueueHistoryOptions,
): Promise<{ pointers: HistoryPointer[]; hasMore: boolean }> {
  const limit = options?.limit || 50;
  const limitPlusOne = limit + 1;
  let sql = "SELECT * FROM pointers WHERE queue = ?";
  const args: unknown[] = [queueName];

  if (options?.status) {
    sql += " AND status = ?";
    args.push(options.status);
  }
  if (options?.afterId) {
    sql += " AND created_at > (SELECT created_at FROM pointers WHERE id = ?)";
    args.push(options.afterId);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  args.push(limitPlusOne);

  const result = await db.execute(sql, args);
  const hasMore = result.rows.length > limit;
  const pointers = result.rows.slice(0, limit).map((row) => ({
    id: row.id as string,
    queue: row.queue as string,
    status: row.status as 'pending' | 'consumed' | 'looped',
    size: row.size as number,
    producerId: row.producer_id as string,
    contentType: (row.content_type as string) || "text/plain",
    metadata: JSON.parse((row.metadata as string) || "{}"),
    lineage: JSON.parse((row.lineage as string) || "[]"),
    createdAt: row.created_at as string,
    consumedAt: row.consumed_at as string || undefined,
  })).reverse();

  return { pointers, hasMore };
}
