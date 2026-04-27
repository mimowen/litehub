// src/lib/queue.ts — 队列核心操作
import { v4 as uuid } from "uuid";
import { getDb } from "./db.js";
import { ensureAgent, queueExists } from "./auth.js";
import { createPoolWithCreator } from "./pool.js";
import type { AgentInfo, PointerRecord } from "./types.js";

// ─── Agent ────────────────────────────────────────────────────────────────

export { ensureAgent, queueExists } from "./auth.js";

export interface QueueDescriptor {
  name: string;
  description?: string;
}

export interface PoolDescriptor {
  name: string;
  description?: string;
  maxMembers?: number;
}

export function registerAgent(
  info: Omit<AgentInfo, "registeredAt">,
  queues?: QueueDescriptor[],
  pools?: PoolDescriptor[],
): { agent: AgentInfo; createdQueues: string[]; createdPools: string[] } {
  const db = getDb();
  const now = new Date().toISOString();

  // Normalize queue names: all items in info.queues are strings (registered via agent/register)
  const queueNames: string[] = [];
  const queueDescs: { name: string; description?: string }[] = [];
  for (const q of info.queues) {
    queueNames.push(q);
    queueDescs.push({ name: q });
  }

  // Also add queues from the dedicated parameter
  if (queues) {
    for (const q of queues) {
      if (!queueNames.includes(q.name)) {
        queueNames.push(q.name);
        queueDescs.push(q);
      }
    }
  }

  db.prepare(`
    INSERT OR REPLACE INTO agents (agent_id, name, role, queues, poll_interval, registered_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(info.agentId, info.name, info.role, JSON.stringify(queueNames), info.pollInterval || 0, now);

  // Create queues with description + creator_id
  const createdQueues: string[] = [];
  for (const qd of queueDescs) {
    ensureQueue(qd.name, qd.description, info.agentId);
    createdQueues.push(qd.name);
  }

  // Create pools if provided
  const createdPools: string[] = [];
  if (pools) {
    for (const pd of pools) {
      try {
        createPoolWithCreator(pd.name, pd.description, undefined, pd.maxMembers, info.agentId);
        createdPools.push(pd.name);
      } catch {
        // Pool already exists, skip
      }
    }
  }

  return { agent: { ...info, queues: queueNames, registeredAt: now }, createdQueues, createdPools };
}

export function getAgent(agentId: string): AgentInfo | null {
  const row = getDb().prepare("SELECT * FROM agents WHERE agent_id = ?").get(agentId) as any;
  return row ? rowToAgent(row) : null;
}

export function listAgents(): AgentInfo[] {
  const rows = getDb().prepare("SELECT * FROM agents ORDER BY registered_at").all() as any[];
  return rows.map(rowToAgent);
}

function rowToAgent(row: any): AgentInfo {
  return {
    agentId: row.agent_id,
    name: row.name,
    role: row.role,
    queues: JSON.parse(row.queues || "[]"),
    pollInterval: row.poll_interval,
    registeredAt: row.registered_at,
  };
}

// ─── Queue ────────────────────────────────────────────────────────────────

export function ensureQueue(name: string, description?: string, creatorId?: string) {
  const db = getDb();
  const existing = db.prepare("SELECT 1 FROM queues WHERE name = ?").get(name);
  if (!existing) {
    db.prepare("INSERT INTO queues (name, description, creator_id) VALUES (?, ?, ?)").run(name, description || "", creatorId || "");
  }
  return getQueueStatus(name);
}

export function getQueueStatus(name: string) {
  const db = getDb();
  const q = db.prepare("SELECT * FROM queues WHERE name = ?").get(name) as any;
  if (!q) return null;
  const pending = (db.prepare("SELECT COUNT(*) as c FROM pointers WHERE queue = ? AND status = 'pending'").get(name) as any).c;
  const consumed = (db.prepare("SELECT COUNT(*) as c FROM pointers WHERE queue = ? AND status = 'consumed'").get(name) as any).c;
  return { name: q.name, description: q.description, pending, consumed, createdAt: q.created_at };
}

export function listQueues() {
  const rows = getDb().prepare("SELECT * FROM queues ORDER BY created_at").all() as any[];
  return rows.map(r => {
    const status = getQueueStatus(r.name);
    if (!status) return null;
    return { ...status, creatorId: r.creator_id };
  }).filter(Boolean);
}

// ─── Produce ──────────────────────────────────────────────────────────────

export function produce(
  queueName: string,
  data: string | Buffer,
  producerId: string,
  options?: { contentType?: string; metadata?: Record<string, string>; lineage?: string[] }
) {
  // Queue must exist
  if (!queueExists(queueName)) return null;
  const id = uuid();
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;

  // Build lineage: inherit from source + append current producer
  let lineage = options?.lineage || [];
  if (lineage.length === 0) {
    lineage = [producerId];
  } else if (lineage[lineage.length - 1] !== producerId) {
    lineage = [...lineage, producerId];
  }

  const db = getDb();
  db.prepare(`
    INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata, lineage, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(id, queueName, producerId, buf, buf.length, options?.contentType || "text/plain", JSON.stringify(options?.metadata || {}), JSON.stringify(lineage));

  return { id, queue: queueName, size: buf.length, producerId, lineage, createdAt: new Date().toISOString() };
}

// ─── Consume ──────────────────────────────────────────────────────────────

export function consume(queueName: string, consumerId: string, maxItems = 1, options?: { loopDetection?: boolean }) {
  const db = getDb();
  const loopDetection = options?.loopDetection !== false; // default true

  const rows = db.prepare(`
    SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT ?
  `).all(queueName, maxItems * 3) as any[]; // fetch extra rows to skip looped ones

  if (rows.length === 0) return [];

  const stmt = db.prepare("UPDATE pointers SET status = 'consumed' WHERE id = ?");
  const results: any[] = [];

  for (const row of rows) {
    if (results.length >= maxItems) break;

    // Loop detection: skip if consumer is in the lineage
    if (loopDetection) {
      try {
        const lineage: string[] = JSON.parse(row.lineage || "[]");
        if (lineage.includes(consumerId)) {
          // Mark as looped to prevent re-processing
          stmt.run(row.id);
          db.prepare("UPDATE pointers SET status = 'looped' WHERE id = ?").run(row.id);
          continue; // skip this item
        }
      } catch {
        // invalid lineage JSON, skip check
      }
    }

    stmt.run(row.id);
    const buf = Buffer.from(row.data as any);
    const lineage = JSON.parse(row.lineage || "[]");
    results.push({
      pointer: {
        id: row.id,
        queue: row.queue,
        size: row.size,
        producerId: row.producer_id,
        contentType: row.content_type,
        metadata: JSON.parse(row.metadata || "{}"),
        lineage,
        createdAt: row.created_at,
      },
      data: buf.toString("base64"),
      text: buf.toString("utf-8"),
    });
  }

  return results;
}

// ─── Peek ─────────────────────────────────────────────────────────────────

export function peek(queueName: string) {
  const row = getDb().prepare(`
    SELECT id, queue, size, producer_id, content_type, metadata, created_at
    FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT 1
  `).get(queueName) as any;
  if (!row) return null;
  return {
    id: row.id,
    queue: row.queue,
    size: row.size,
    producerId: row.producer_id,
    contentType: row.content_type,
    metadata: JSON.parse(row.metadata || "{}"),
    createdAt: row.created_at,
  };
}

// ─── Pipe (consume + produce) ─────────────────────────────────────────────

export function pipe(
  sourceQueue: string,
  targetQueue: string,
  consumerId: string,
  outputData: string | Buffer,
  options?: { contentType?: string; metadata?: Record<string, string> }
) {
  const items = consume(sourceQueue, consumerId, 1);
  if (items.length === 0) return null;

  const inputPointer = items[0].pointer;
  const outputPointer = produce(targetQueue, outputData, consumerId, {
    ...options,
    metadata: {
      ...options?.metadata,
      sourcePointerId: inputPointer.id,
      sourceQueue,
    },
    lineage: inputPointer.lineage as string[],
  });

  return { input: inputPointer, output: outputPointer };
}
