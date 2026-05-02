// src/protocols/a2a.ts — A2A Protocol JSON-RPC 2.0 Adapter
// Google Agent-to-Agent Protocol: https://a2a-protocol.org/
// Fully compliant with A2A specification - transparent to other agents

import type { DbClient } from "../adapters/db/interface.js";
import { registerAgent, ensureAgent } from "../core/queue.js";
import {
  createTask,
  getTask,
  listTasks,
  cancelTask,
  updateTask,
  setPushNotification,
  getPushNotification,
  sendToTask,
  createTaskSubscription,
} from "../core/a2a.js";

// ─── JSON-RPC 2.0 Types ───────────────────────────────────────────────────

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

// Standard JSON-RPC error codes
const JSONRPC_ERRORS = {
  PARSE_ERROR: { code: -32700, message: "Parse error" },
  INVALID_REQUEST: { code: -32600, message: "Invalid Request" },
  METHOD_NOT_FOUND: { code: -32601, message: "Method not found" },
  INVALID_PARAMS: { code: -32602, message: "Invalid params" },
  INTERNAL_ERROR: { code: -32603, message: "Internal error" },
  SERVER_ERROR: { code: -32000, message: "Server error" },
};

// ─── A2A Protocol Types ───────────────────────────────────────────────────

interface A2AMessage {
  role: "user" | "agent";
  parts: A2APart[];
  messageId: string;
}

interface A2APart {
  type: "text" | "file" | "data";
  text?: string;
  file?: { bytes?: string; uri?: string; mimeType?: string };
  data?: Record<string, unknown>;
}

interface A2ATask {
  id: string;
  sessionId?: string;
  status: {
    state: "submitted" | "working" | "input_required" | "completed" | "failed" | "cancelled";
    message?: A2AMessage;
    timestamp?: string;
  };
  artifacts?: unknown[];
  history?: A2AMessage[];
  metadata?: Record<string, unknown>;
}

// ─── Helper Functions ─────────────────────────────────────────────────────

function success(id: string | number | undefined, result: unknown): JSONRPCResponse {
  return { jsonrpc: "2.0", id, result };
}

function error(id: string | number | undefined, err: JSONRPCError): JSONRPCResponse {
  return { jsonrpc: "2.0", id, error: err };
}

function mapState(status: string): A2ATask["status"]["state"] {
  const stateMap: Record<string, A2ATask["status"]["state"]> = {
    pending: "submitted",
    running: "working",
    completed: "completed",
    failed: "failed",
    cancelled: "cancelled",
  };
  return stateMap[status] || "working";
}

function formatTask(task: any): A2ATask {
  return {
    id: task.taskId,
    status: {
      state: mapState(task.status),
      timestamp: task.updatedAt,
    },
    history: task.messages?.map((m: any) => ({
      role: "agent" as const,
      parts: [{ type: "text" as const, text: JSON.stringify(m.data) }],
      messageId: m.pointerId || crypto.randomUUID(),
    })),
  };
}

// ─── A2A Method Handlers ──────────────────────────────────────────────────

async function handleMessageSend(
  db: DbClient,
  params: Record<string, unknown>,
  agentId: string,
): Promise<{ task: A2ATask }> {
  const message = params.message as A2AMessage | undefined;
  const sessionId = params.sessionId as string | undefined;
  const taskId = params.id as string | undefined;

  if (!message) {
    throw { ...JSONRPC_ERRORS.INVALID_PARAMS, message: "Missing message in params" };
  }

  const textPart = message.parts?.find((p) => p.type === "text");
  const content = textPart?.text || "";

  if (taskId) {
    const existingTask = await getTask(db, taskId);
    if (existingTask) {
      const result = await sendToTask(db, {
        taskId,
        agentId,
        message: { role: message.role, content, parts: message.parts },
        messageId: message.messageId,
      });
      if (!result.ok) {
        throw { ...JSONRPC_ERRORS.SERVER_ERROR, message: result.error || "Failed to send message" };
      }
      const updatedTask = await getTask(db, taskId);
      return { task: formatTask(updatedTask) };
    }
  }

  const result = await createTask(db, {
    agentId,
    taskId: taskId || crypto.randomUUID(),
    name: content.slice(0, 100),
    input: { role: message.role, content, parts: message.parts, sessionId },
  });

  if (!result.ok) {
    throw { ...JSONRPC_ERRORS.SERVER_ERROR, message: result.error || "Failed to create task" };
  }

  const task = await getTask(db, result.taskId!);
  return { task: formatTask(task) };
}

async function handleMessageStream(
  db: DbClient,
  params: Record<string, unknown>,
  agentId: string,
): Promise<{ taskId: string; streamUrl: string }> {
  const message = params.message as A2AMessage | undefined;
  const taskId = params.id as string || crypto.randomUUID();

  if (!message) {
    throw { ...JSONRPC_ERRORS.INVALID_PARAMS, message: "Missing message in params" };
  }

  const textPart = message.parts?.find((p) => p.type === "text");
  const content = textPart?.text || "";

  const existingTask = await getTask(db, taskId);
  if (!existingTask) {
    const result = await createTask(db, {
      agentId,
      taskId,
      name: content.slice(0, 100),
      input: { role: message.role, content, parts: message.parts },
    });
    if (!result.ok) {
      throw { ...JSONRPC_ERRORS.SERVER_ERROR, message: result.error || "Failed to create task" };
    }
  } else {
    await sendToTask(db, {
      taskId,
      agentId,
      message: { role: message.role, content, parts: message.parts },
      messageId: message.messageId,
    });
  }

  return {
    taskId,
    streamUrl: `/a2a/stream?taskId=${taskId}`,
  };
}

async function handleTasksGet(
  db: DbClient,
  params: Record<string, unknown>,
): Promise<{ task: A2ATask | null }> {
  const taskId = params.id as string;
  if (!taskId) {
    throw { ...JSONRPC_ERRORS.INVALID_PARAMS, message: "Missing task id" };
  }
  const task = await getTask(db, taskId);
  return { task: task ? formatTask(task) : null };
}

async function handleTasksList(
  db: DbClient,
  params: Record<string, unknown>,
): Promise<{ tasks: A2ATask[] }> {
  const agentId = params.agentId as string | undefined;
  const status = params.status as string | undefined;
  const limit = (params.limit as number) || 20;
  const tasks = await listTasks(db, { agentId, status, limit });
  return { tasks: tasks.map(formatTask) };
}

async function handleTasksCancel(
  db: DbClient,
  params: Record<string, unknown>,
  agentId: string,
): Promise<{ task: A2ATask }> {
  const taskId = params.id as string;
  if (!taskId) {
    throw { ...JSONRPC_ERRORS.INVALID_PARAMS, message: "Missing task id" };
  }
  const result = await cancelTask(db, taskId, agentId);
  if (!result.cancelled) {
    throw { ...JSONRPC_ERRORS.SERVER_ERROR, message: "Failed to cancel task" };
  }
  const task = await getTask(db, taskId);
  return { task: formatTask(task) };
}

async function handleTasksPushNotificationSet(
  db: DbClient,
  params: Record<string, unknown>,
  agentId: string,
): Promise<{ pushNotificationConfig: { webhookUrl: string; taskId?: string } }> {
  const pushConfig = params.pushNotificationConfig as {
    url: string;
    taskId?: string;
    authentication?: { schemes: string[] };
  };

  if (!pushConfig?.url) {
    throw { ...JSONRPC_ERRORS.INVALID_PARAMS, message: "Missing pushNotificationConfig.url" };
  }

  await setPushNotification(db, {
    agentId,
    webhookUrl: pushConfig.url,
    taskId: pushConfig.taskId,
  });

  return {
    pushNotificationConfig: {
      webhookUrl: pushConfig.url,
      taskId: pushConfig.taskId,
    },
  };
}

async function handleTasksPushNotificationGet(
  db: DbClient,
  params: Record<string, unknown>,
  agentId: string,
): Promise<{ pushNotificationConfigs: Array<{ webhookUrl: string; taskId?: string }> }> {
  const taskId = params.id as string | undefined;
  const subs = await getPushNotification(db, agentId);

  const configs = subs
    .filter((s: any) => !taskId || s.scopeName === taskId)
    .map((s: any) => ({
      webhookUrl: s.targetUrl,
      taskId: s.scopeName,
    }));

  return { pushNotificationConfigs: configs };
}

async function handleAgentAuthenticatedExtendedCard(
  db: DbClient,
  agentId: string,
  baseUrl: string,
): Promise<unknown> {
  return {
    name: "LiteHub A2A Agent",
    description: "LiteHub - Lightweight Agent Collaboration Pipeline",
    url: baseUrl,
    version: "2.0.0",
    capabilities: {
      streaming: true,
      pushNotifications: true,
    },
    authentication: {
      schemes: ["bearer"],
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "agent-collaboration",
        name: "Agent Collaboration",
        description: "Collaborate with other agents through A2A protocol",
        tags: ["collaboration", "messaging", "tasks"],
      },
    ],
  };
}

// ─── Main Handler ─────────────────────────────────────────────────────────

export async function handleA2ARequest(
  db: DbClient,
  body: unknown,
  agentId: string,
  baseUrl: string,
): Promise<JSONRPCResponse> {
  let request: JSONRPCRequest;

  try {
    request = typeof body === "string" ? JSON.parse(body) : (body as JSONRPCRequest);
  } catch {
    return error(undefined, JSONRPC_ERRORS.PARSE_ERROR);
  }

  if (request.jsonrpc !== "2.0") {
    return error(request.id, JSONRPC_ERRORS.INVALID_REQUEST);
  }

  const { id, method, params = {} } = request;

  try {
    await ensureAgent(db, agentId);

    let result: unknown;

    switch (method) {
      case "message/send":
        result = await handleMessageSend(db, params, agentId);
        break;

      case "message/stream":
        result = await handleMessageStream(db, params, agentId);
        break;

      case "tasks/get":
        result = await handleTasksGet(db, params);
        break;

      case "tasks/list":
        result = await handleTasksList(db, params);
        break;

      case "tasks/cancel":
        result = await handleTasksCancel(db, params, agentId);
        break;

      case "tasks/pushNotificationConfig/set":
        result = await handleTasksPushNotificationSet(db, params, agentId);
        break;

      case "tasks/pushNotificationConfig/get":
        result = await handleTasksPushNotificationGet(db, params, agentId);
        break;

      case "agent/authenticatedExtendedCard":
        result = await handleAgentAuthenticatedExtendedCard(db, agentId, baseUrl);
        break;

      default:
        return error(id, JSONRPC_ERRORS.METHOD_NOT_FOUND);
    }

    return success(id, result);
  } catch (err: any) {
    if (err.code && err.message) {
      return error(id, err as JSONRPCError);
    }
    return error(id, { ...JSONRPC_ERRORS.INTERNAL_ERROR, message: err.message || "Internal error" });
  }
}

// ─── SSE Stream Handler ───────────────────────────────────────────────────

export function handleA2AStream(db: DbClient, taskId: string): ReadableStream<Uint8Array> | null {
  const { stream } = createTaskSubscription(db, taskId);
  return stream;
}
