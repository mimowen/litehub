// src/lib/pool.ts — Pool (群聊协作空间) 核心操作
import { v4 as uuid } from "uuid";
import { getDb } from "./db.js";
import { ensureAgent } from "./auth.js";
import type { PoolInfo, PoolMessage, PoolMember } from "./types.js";

// ─── Pool CRUD ─────────────────────────────────────────────────────────────

export function createPool(name: string, description?: string, guidelines?: string, maxMembers?: number): PoolInfo {
  return createPoolWithCreator(name, description, guidelines, maxMembers, "");
}

export function createPoolWithCreator(name: string, description?: string, guidelines?: string, maxMembers?: number, creatorId?: string): PoolInfo {
  const db = getDb();
  const defaultGuidelines = "You are a collaborative agent in this Pool. Share progress transparently. Reference others' work. Do not command other agents.";
  db.prepare(`
    INSERT INTO pools (name, description, guidelines, max_members, creator_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, description || "", guidelines || defaultGuidelines, maxMembers || 20, creatorId || "");
  return getPool(name)!;
}

export function getPool(name: string): PoolInfo | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM pools WHERE name = ?").get(name) as any;
  if (!row) return null;
  const memberCount = (db.prepare("SELECT COUNT(*) as c FROM pool_members WHERE pool = ?").get(name) as any).c;
  return {
    name: row.name,
    description: row.description,
    guidelines: row.guidelines,
    maxMembers: row.max_members,
    memberCount,
    creatorId: row.creator_id,
    createdAt: row.created_at,
  };
}

export function listPools(): PoolInfo[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM pools ORDER BY created_at").all() as any[];
  return rows.map((r) => {
    const memberCount = (db.prepare("SELECT COUNT(*) as c FROM pool_members WHERE pool = ?").get(r.name) as any).c;
    return {
      name: r.name,
      description: r.description,
      guidelines: r.guidelines,
      maxMembers: r.max_members,
      memberCount,
      creatorId: r.creator_id,
      createdAt: r.created_at,
    };
  });
}

// ─── Members ───────────────────────────────────────────────────────────────

export function joinPool(pool: string, agentId: string): { ok: boolean; error?: string } {
  // Agent must be registered
  if (!ensureAgent(agentId)) return { ok: false, error: "Agent not registered. Call register first." };
  const db = getDb();
  const poolInfo = getPool(pool);
  if (!poolInfo) return { ok: false, error: `Pool '${pool}' not found` };
  if (poolInfo.memberCount >= poolInfo.maxMembers) {
    return { ok: false, error: `Pool '${pool}' is full (${poolInfo.maxMembers}/${poolInfo.maxMembers})` };
  }
  const existing = db.prepare("SELECT 1 FROM pool_members WHERE pool = ? AND agent_id = ?").get(pool, agentId);
  if (existing) return { ok: true }; // already a member
  db.prepare("INSERT INTO pool_members (pool, agent_id) VALUES (?, ?)").run(pool, agentId);
  return { ok: true };
}

export function leavePool(pool: string, agentId: string) {
  // Agent must be registered
  if (!ensureAgent(agentId)) return { ok: false, error: "Agent not registered." };
  const db = getDb();
  db.prepare("DELETE FROM pool_members WHERE pool = ? AND agent_id = ?").run(pool, agentId);
  return { ok: true };
}

export function listMembers(pool: string): PoolMember[] {
  const db = getDb();
  return db.prepare("SELECT pool, agent_id as agentId, joined_at as joinedAt FROM pool_members WHERE pool = ? ORDER BY joined_at")
    .all(pool) as PoolMember[];
}

// ─── Messages ──────────────────────────────────────────────────────────────

export function speak(
  pool: string,
  agentId: string,
  content: string,
  options?: { replyTo?: string; tags?: string[]; metadata?: Record<string, string> }
): PoolMessage | { error: string } {
  // Agent must be registered
  if (!ensureAgent(agentId)) return { error: "Agent not registered. Call register first." };
  const db = getDb();
  const id = uuid();
  const tags = options?.tags || [];
  db.prepare(`
    INSERT INTO pool_messages (id, pool, agent_id, content, reply_to, tags, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, pool, agentId, content, options?.replyTo || null, JSON.stringify(tags), JSON.stringify(options?.metadata || {}));
  return { id, pool, agentId, content, replyTo: options?.replyTo, tags, metadata: options?.metadata, createdAt: new Date().toISOString() };
}

export function getMessages(
  pool: string,
  options?: { since?: string; tag?: string; limit?: number }
): { messages: PoolMessage[]; guidelines: string } {
  const db = getDb();
  const limit = options?.limit || 50;

  let sql = "SELECT * FROM pool_messages WHERE pool = ?";
  const args: any[] = [pool];

  if (options?.since) {
    sql += " AND created_at > ?";
    args.push(options.since);
  }
  if (options?.tag) {
    sql += " AND tags LIKE ?";
    args.push(`%"${options.tag}"%`);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  args.push(limit);

  const rows = db.prepare(sql).all(...args) as any[];
  const messages: PoolMessage[] = rows.map((r) => ({
    id: r.id,
    pool: r.pool,
    agentId: r.agent_id,
    content: r.content,
    replyTo: r.reply_to,
    tags: JSON.parse(r.tags || "[]"),
    metadata: JSON.parse(r.metadata || "{}"),
    createdAt: r.created_at,
  })).reverse(); // newest first → chronological

  const poolInfo = getPool(pool);
  return {
    messages,
    guidelines: poolInfo?.guidelines || "",
  };
}
