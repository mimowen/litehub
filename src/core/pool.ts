// src/core/pool.ts — Pool 核心操作（平台无关）
// 使用 Web Crypto API 替代 uuid 包，兼容 Edge Runtime
import type { DbClient, DbRow } from "../adapters/db/interface.js";
import { getOne, getValue } from "../adapters/db/interface.js";
import { ensureAgent } from "./queue.js";

// ─── Types ────────────────────────────────────────────────────────────────

export interface PoolInfo {
  name: string;
  description: string;
  guidelines: string;
  maxMembers: number;
  memberCount: number;
  creatorId?: string;
  createdAt: string;
}

export interface PoolMember {
  agentId: string;
  pool: string;
  joinedAt: string;
}

export interface PoolMessage {
  id: string;
  pool: string;
  agentId: string;
  content: string;
  replyTo?: string;
  tags: string[];
  metadata?: Record<string, string>;
  createdAt: string;
}

// ─── Pool CRUD ────────────────────────────────────────────────────────────

export async function createPool(
  db: DbClient,
  name: string,
  description?: string,
  guidelines?: string,
  maxMembers?: number,
  creatorId?: string,
): Promise<PoolInfo> {
  const defaultGuidelines = "You are a collaborative agent in this Pool. Share progress transparently. Reference others' work. Do not command other agents.";
  await db.execute(
    `INSERT INTO pools (name, description, guidelines, max_members, creator_id)
     VALUES (?, ?, ?, ?, ?)`,
    [name, description || "", guidelines || defaultGuidelines, maxMembers || 20, creatorId || ""],
  );
  return (await getPool(db, name))!;
}

export async function getPool(db: DbClient, name: string): Promise<PoolInfo | null> {
  const row = getOne(await db.execute("SELECT * FROM pools WHERE name = ?", [name]));
  if (!row) return null;
  const memberCount = getValue<number>(
    await db.execute("SELECT COUNT(*) as c FROM pool_members WHERE pool = ?", [name]),
    "c",
  ) || 0;
  return {
    name: row.name as string,
    description: row.description as string,
    guidelines: row.guidelines as string,
    maxMembers: (row.max_members as number) || 20,
    memberCount,
    creatorId: row.creator_id as string,
    createdAt: row.created_at as string,
  };
}

export async function listPools(db: DbClient): Promise<PoolInfo[]> {
  const result = await db.execute("SELECT * FROM pools ORDER BY created_at");
  const pools: PoolInfo[] = [];
  for (const r of result.rows) {
    const memberCount = getValue<number>(
      await db.execute("SELECT COUNT(*) as c FROM pool_members WHERE pool = ?", [r.name as string]),
      "c",
    ) || 0;
    pools.push({
      name: r.name as string,
      description: r.description as string,
      guidelines: r.guidelines as string,
      maxMembers: (r.max_members as number) || 20,
      memberCount,
      creatorId: r.creator_id as string,
      createdAt: r.created_at as string,
    });
  }
  return pools;
}

// ─── Members ──────────────────────────────────────────────────────────────

export async function joinPool(
  db: DbClient,
  pool: string,
  agentId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await ensureAgent(db, agentId))) {
    return { ok: false, error: "Agent not registered. Call register first." };
  }
  const poolInfo = await getPool(db, pool);
  if (!poolInfo) return { ok: false, error: `Pool '${pool}' not found` };
  if (poolInfo.memberCount >= poolInfo.maxMembers) {
    return { ok: false, error: `Pool '${pool}' is full (${poolInfo.maxMembers}/${poolInfo.maxMembers})` };
  }
  const existing = getOne(
    await db.execute("SELECT 1 FROM pool_members WHERE pool = ? AND agent_id = ?", [pool, agentId]),
  );
  if (existing) return { ok: true };
  await db.execute("INSERT INTO pool_members (pool, agent_id) VALUES (?, ?)", [pool, agentId]);
  return { ok: true };
}

export async function leavePool(
  db: DbClient,
  pool: string,
  agentId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await ensureAgent(db, agentId))) {
    return { ok: false, error: "Agent not registered." };
  }
  await db.execute("DELETE FROM pool_members WHERE pool = ? AND agent_id = ?", [pool, agentId]);
  return { ok: true };
}

export async function listMembers(db: DbClient, pool: string): Promise<PoolMember[]> {
  const result = await db.execute(
    "SELECT pool, agent_id, joined_at FROM pool_members WHERE pool = ? ORDER BY joined_at",
    [pool],
  );
  return result.rows.map((r) => ({
    pool: r.pool as string,
    agentId: r.agent_id as string,
    joinedAt: r.joined_at as string,
  }));
}

// ─── Messages ─────────────────────────────────────────────────────────────

export async function speak(
  db: DbClient,
  pool: string,
  agentId: string,
  content: string,
  options?: { replyTo?: string; tags?: string[]; metadata?: Record<string, string> },
): Promise<PoolMessage | { error: string }> {
  if (!(await ensureAgent(db, agentId))) {
    return { error: "Agent not registered. Call register first." };
  }
  const id = crypto.randomUUID();
  const tags = options?.tags || [];
  await db.execute(
    `INSERT INTO pool_messages (id, pool, agent_id, content, reply_to, tags, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, pool, agentId, content, options?.replyTo || null, JSON.stringify(tags), JSON.stringify(options?.metadata || {})],
  );
  return {
    id,
    pool,
    agentId,
    content,
    replyTo: options?.replyTo,
    tags,
    metadata: options?.metadata,
    createdAt: new Date().toISOString(),
  };
}

export interface GetMessagesOptions {
  since?: string;
  tag?: string;
  limit?: number;
}

export async function getMessages(
  db: DbClient,
  pool: string,
  options?: GetMessagesOptions,
): Promise<{ messages: PoolMessage[]; guidelines: string }> {
  const limit = options?.limit || 50;

  let sql = "SELECT * FROM pool_messages WHERE pool = ?";
  const args: unknown[] = [pool];

  if (options?.since) {
    sql += " AND created_at > ?";
    args.push(options.since);
  }
  if (options?.tag) {
    sql += " AND tags LIKE ?";
    args.push(`%${options.tag}%`);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  args.push(limit);

  const result = await db.execute(sql, args);
  const messages: PoolMessage[] = result.rows
    .map((r) => ({
      id: r.id as string,
      pool: r.pool as string,
      agentId: r.agent_id as string,
      content: r.content as string,
      replyTo: r.reply_to as string | undefined,
      tags: JSON.parse((r.tags as string) || "[]"),
      metadata: JSON.parse((r.metadata as string) || "{}"),
      createdAt: r.created_at as string,
    }))
    .reverse(); // newest first → chronological

  const poolInfo = await getPool(db, pool);
  return {
    messages,
    guidelines: poolInfo?.guidelines || "",
  };
}
