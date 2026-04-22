// src/lib/queue.ts — 队列核心操作
import { v4 as uuid } from "uuid";
import { getDb } from "./db";
import type { AgentInfo, PointerRecord } from "./types";

// ─── Agent ────────────────────────────────────────────────────────────────

export function registerAgent(info: Omit<AgentInfo, "registeredAt">): AgentInfo {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO agents (agent_id, name, role, queues, poll_interval, registered_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(info.agentId, info.name, info.role, JSON.stringify(info.queues), info.pollInterval || 0, now);

  // 自动创建队列
  for (const q of info.queues) ensureQueue(q);

  return { ...info, registeredAt: now };
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

export function ensureQueue(name: string, description?: string) {
  const db = getDb();
  const existing = db.prepare("SELECT 1 FROM queues WHERE name = ?").get(name);
  if (!existing) {
    db.prepare("INSERT INTO queues (name, description) VALUES (?, ?)").run(name, description || "");
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
  return rows.map(r => getQueueStatus(r.name)!).filter(Boolean);
}

// ─── Produce ──────────────────────────────────────────────────────────────

export function produce(
  queueName: string,
  data: string | Buffer,
  producerId: string,
  options?: { contentType?: string; metadata?: Record<string, string> }
) {
  ensureQueue(queueName);
  const id = uuid();
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  const db = getDb();
  db.prepare(`
    INSERT INTO pointers (id, queue, producer_id, data, size, content_type, metadata, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(id, queueName, producerId, buf, buf.length, options?.contentType || "text/plain", JSON.stringify(options?.metadata || {}));

  return { id, queue: queueName, size: buf.length, producerId, createdAt: new Date().toISOString() };
}

// ─── Consume ──────────────────────────────────────────────────────────────

export function consume(queueName: string, consumerId: string, maxItems = 1) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM pointers WHERE queue = ? AND status = 'pending' ORDER BY created_at LIMIT ?
  `).all(queueName, maxItems) as any[];

  if (rows.length === 0) return [];

  const stmt = db.prepare("UPDATE pointers SET status = 'consumed' WHERE id = ?");
  const results = rows.map(row => {
    stmt.run(row.id);
    const buf = Buffer.from(row.data as any);
    return {
      pointer: {
        id: row.id,
        queue: row.queue,
        size: row.size,
        producerId: row.producer_id,
        contentType: row.content_type,
        metadata: JSON.parse(row.metadata || "{}"),
        createdAt: row.created_at,
      },
      data: buf.toString("base64"),
      text: buf.toString("utf-8"),
    };
  });

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
  });

  return { input: inputPointer, output: outputPointer };
}
