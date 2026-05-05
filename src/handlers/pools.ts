// src/handlers/pools.ts — Pool create/join/leave/speak/block/unblock handlers
import type { DbClient } from "../adapters/db/interface.js";
import { createPool, getPool, listPools, joinPool, leavePool, listMembers, speak, getMessages, updatePool, blockPool, unblockPool } from "../core/pool.js";
import { ok, fail } from "../utils/response.js";

export async function handlePoolCreate(db: DbClient, body: any) {
  const poolName = body.pool || body.name;
  const { agentId, description, maxMembers, guidelines } = body;
  if (!poolName) return fail("缺少必填字段: pool");
  const result = await createPool(db, poolName, description, guidelines, maxMembers, agentId);
  return ok({ pool: result });
}

export async function handleListPools(db: DbClient) {
  return ok({ pools: await listPools(db) });
}

export async function handleGetPool(db: DbClient, name: string) {
  const pool = await getPool(db, name);
  if (!pool) return fail("Pool 不存在");
  return ok({ pool });
}

export async function handlePoolUpdate(db: DbClient, body: any) {
  const { pool, name, description, guidelines, maxMembers } = body;
  const poolName = pool || name;
  if (!poolName) return fail("缺少必填字段: pool/name");
  const result = await updatePool(db, poolName, { description, guidelines, maxMembers });
  if (!result) return fail("Pool 不存在");
  return ok({ pool: result });
}

export async function handlePoolJoin(db: DbClient, body: any) {
  const { pool, agentId } = body;
  if (!pool || !agentId) return fail("缺少必填字段: pool, agentId");
  const result = await joinPool(db, pool, agentId);
  if (!result.ok) return fail(result.error || "Failed to join pool");
  return ok({});
}

export async function handlePoolLeave(db: DbClient, body: any) {
  const { pool, agentId } = body;
  if (!pool || !agentId) return fail("缺少必填字段: pool, agentId");
  await leavePool(db, pool, agentId);
  return ok({});
}

export async function handlePoolSpeak(db: DbClient, body: any) {
  const { pool, agentId, content, replyTo, tags, metadata } = body;
  if (!pool || !agentId || !content) return fail("缺少必填字段: pool, agentId, content");
  const msg = await speak(db, pool, agentId, content, { replyTo, tags, metadata });
  if ("error" in msg) return fail(msg.error as string);
  return ok({ message: msg });
}

export async function handlePoolMembers(db: DbClient, pool: string) {
  if (!pool) return fail("缺少 query: pool");
  return ok({ members: await listMembers(db, pool) });
}

export async function handlePoolMessages(db: DbClient, pool: string, agentId?: string, opts?: { since?: string; tag?: string; limit?: number; afterId?: string }) {
  if (!pool) return fail("缺少 query: pool");
  const result = await getMessages(db, pool, agentId, opts);
  if ('error' in result) return fail(result.error as string);
  return ok({ messages: result.messages, guidelines: result.guidelines, hasMore: result.hasMore });
}

export async function handlePoolBlock(db: DbClient, body: any) {
  const poolName = body.pool || body.name;
  if (!poolName) return fail("缺少必填字段: pool");
  const result = await blockPool(db, poolName);
  if (!result.success) return fail(result.message);
  return ok({ message: result.message });
}

export async function handlePoolUnblock(db: DbClient, body: any) {
  const poolName = body.pool || body.name;
  if (!poolName) return fail("缺少必填字段: pool");
  const result = await unblockPool(db, poolName);
  if (!result.success) return fail(result.message);
  return ok({ message: result.message });
}
