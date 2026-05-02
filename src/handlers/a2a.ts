// src/handlers/a2a.ts — A2A protocol route handlers
import type { DbClient } from "../adapters/db/interface.js";
import {
  createTask, getTask, listTasks, cancelTask, updateTask,
  setPushNotification, getPushNotification,
  sendToTask, createTaskSubscription,
} from "../core/a2a.js";
import { ok, fail, sseHeaders } from "../utils/response.js";

export async function handleA2ACreateTask(db: DbClient, body: any) {
  const { agentId, targetAgentId, name, input, taskId } = body;
  if (!agentId) return fail("Missing agentId");
  const result = await createTask(db, { agentId, targetAgentId, name, input, taskId });
  if (!result.ok) return fail(result.error || "Failed to create task");
  return ok(result);
}

export async function handleA2AListTasks(db: DbClient) {
  return ok({ tasks: await listTasks(db) });
}

export async function handleA2AGetTask(db: DbClient, id: string) {
  const task = await getTask(db, id);
  if (!task) return fail("Task not found");
  return ok({ task });
}

export async function handleA2ACancelTask(db: DbClient, body: any) {
  if (!body.agentId || !body.taskId) return fail("Missing agentId or taskId");
  const result = await cancelTask(db, body.taskId, body.agentId);
  return ok(result);
}

export async function handleA2AUpdateTask(db: DbClient, body: any) {
  if (!body.taskId || !body.agentId || !body.status) return fail("Missing taskId, agentId, or status");
  const result = await updateTask(db, body.taskId, body.agentId, body.status);
  if (!result.ok) return fail(result.error || "Failed to update task");
  return ok(result);
}

export async function handleA2ASendToTask(db: DbClient, taskId: string, body: any) {
  const { agentId, message, messageId, metadata } = body;
  if (!agentId) return fail("Missing agentId");
  const result = await sendToTask(db, { taskId, agentId, message, messageId, metadata });
  if (!result.ok) return fail(result.error || "Failed to send message");
  return ok(result);
}

export async function handleA2ASubscribe(db: DbClient, taskId: string) {
  const { stream, close } = createTaskSubscription(db, taskId);
  return { stream, close, headers: sseHeaders() };
}

export async function handleA2ASetPushNotification(db: DbClient, body: any) {
  if (!body.agentId || !body.webhookUrl) return fail("Missing agentId or webhookUrl");
  const result = await setPushNotification(db, { agentId: body.agentId, webhookUrl: body.webhookUrl, taskId: body.taskId, secret: body.secret });
  return ok(result);
}

export async function handleA2AGetPushNotification(db: DbClient, agentId: string) {
  if (!agentId) return fail("Missing agentId");
  const result = await getPushNotification(db, agentId);
  return ok({ subscriptions: result });
}
