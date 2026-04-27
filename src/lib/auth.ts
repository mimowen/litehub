// src/lib/auth.ts — 身份校验（独立文件，避免 queue.ts ↔ pool.ts 循环依赖）
import { getDb } from "./db.js";

/** Verify that an agent is registered. Returns true/false. */
export function ensureAgent(agentId: string): boolean {
  const row = getDb().prepare("SELECT 1 FROM agents WHERE agent_id = ?").get(agentId);
  return !!row;
}

/** Verify that a queue exists. Returns true/false. */
export function queueExists(queueName: string): boolean {
  const row = getDb().prepare("SELECT 1 FROM queues WHERE name = ?").get(queueName);
  return !!row;
}
