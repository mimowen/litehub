// src/handlers/queues.ts — Queue produce/consume/pipe/peek handlers
import type { DbClient } from "../adapters/db/interface.js";
import { ensureAgent, ensureQueue, getQueueStatus, listQueues, produce, consume, peek, getAgent, updateQueueDescription, getQueueHistory, deleteAgent, blockQueue, unblockQueue } from "../core/queue.js";
import { ok, fail } from "../utils/response.js";

export async function handleProduce(db: DbClient, body: any) {
  const { queue, producerId, agentId, data, contentType, metadata, lineage } = body;
  const aid = producerId || agentId;
  if (!queue || !aid) return fail("缺少必填字段: queue, agentId/producerId");
  if (data === undefined || data === null) return fail("缺少必填字段: data");

  const agentExists = await getAgent(db, aid);
  if (!agentExists) return fail("Agent not registered", 403);

  await ensureQueue(db, queue);
  const result = await produce(db, queue, String(data), aid, { contentType, metadata, lineage });
  if (!result) return fail("Queue 不存在");
  return ok({ pointer: result });
}

export async function handleConsume(db: DbClient, body: any) {
  const { queue, agentId } = body;
  if (!queue || !agentId) return fail("缺少必填字段: queue, agentId");
  await ensureAgent(db, agentId);
  const results = await consume(db, queue, agentId);
  if (!results || results.length === 0) return ok({ pointer: null });
  return ok({ pointer: results[0] });
}

export async function handlePipe(db: DbClient, body: any) {
  const { pointerId, targetQueue, processorId, data, contentType, metadata } = body;
  if (!pointerId || !targetQueue) return fail("缺少必填字段: pointerId, targetQueue");
  await ensureQueue(db, targetQueue);
  const result = await produce(db, targetQueue, String(data || ""), processorId || "pipe", {
    contentType,
    metadata: { ...metadata, sourcePointerId: pointerId },
    lineage: [pointerId],
  });
  if (!result) return fail("Queue 不存在");
  return ok({ id: result.id, queue: targetQueue });
}

export async function handlePeek(db: DbClient, queue: string) {
  if (!queue) return fail("缺少 query: queue");
  const result = await peek(db, queue);
  return ok({ pointer: result });
}

export async function handleListQueues(db: DbClient) {
  const queues = await listQueues(db);
  return ok({ queues });
}

export async function handleQueueStatus(db: DbClient, name: string) {
  const status = await getQueueStatus(db, name);
  if (!status) return fail("Queue 不存在");
  return ok({ queue: status });
}

export async function handleQueueUpdate(db: DbClient, body: any) {
  const { queue, name, description } = body;
  const queueName = queue || name;
  if (!queueName) return fail("缺少必填字段: queue/name");
  const result = await updateQueueDescription(db, queueName, description || "");
  if (!result) return fail("Queue 不存在");
  return ok({ queue: result });
}

export async function handleQueueHistory(db: DbClient, queue: string, opts?: { status?: string; afterId?: string; limit?: number }) {
  if (!queue) return fail("缺少 query: queue");
  const result = await getQueueHistory(db, queue, opts);
  return ok({ pointers: result.pointers, hasMore: result.hasMore });
}

export async function handleAgentDelete(db: DbClient, body: any) {
  const { agentId } = body;
  if (!agentId) return fail("缺少必填字段: agentId");
  const result = await deleteAgent(db, agentId);
  if (!result.success) return fail(result.message);
  return ok({ message: result.message });
}

export async function handleQueueBlock(db: DbClient, body: any) {
  const { queue, name } = body;
  const queueName = queue || name;
  if (!queueName) return fail("缺少必填字段: queue/name");
  const result = await blockQueue(db, queueName);
  if (!result.success) return fail(result.message);
  return ok({ message: result.message });
}

export async function handleQueueUnblock(db: DbClient, body: any) {
  const { queue, name } = body;
  const queueName = queue || name;
  if (!queueName) return fail("缺少必填字段: queue/name");
  const result = await unblockQueue(db, queueName);
  if (!result.success) return fail(result.message);
  return ok({ message: result.message });
}
