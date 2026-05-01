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
  return result.rows.map(rowToAgent);
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
): Promise<QueueStatus | null> {
  const existing = getOne(await db.execute("SELECT 1 FROM queues WHERE name = ?", [name]));
  if (!existing) {
    await db.execute(
      "INSERT INTO queues (name, description, creator_id) VALUES (?, ?, ?)",
      [name, description || "", creatorId || ""],
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
    createdAt: q.created_at as string,
  };
}

export async function listQueues(db: DbClient): Promise<QueueStatus[]> {
  const result = await db.execute("SELECT * FROM queues ORDER BY created_at");
  const queues: QueueStatus[] = [];
  for (const r of result.rows) {
    const status = await getQueueStatus(db, r.name as string);
    if (status) queues.push(status);
  }
  return queues;
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
