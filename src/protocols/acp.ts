// src/protocols/acp.ts — ACP Protocol REST API Adapter
// IBM Agent Communication Protocol: https://agentcommunicationprotocol.dev/
// Fully compliant with ACP specification - transparent to other agents

import type { DbClient } from "../adapters/db/interface.js";
import { registerAgent, ensureAgent, listAgents } from "../core/queue.js";
import {
  createRun,
  getRun,
  listRuns,
  cancelRun,
  createContext,
  getContext,
  listContexts,
  joinContext,
  leaveContext,
  speakContext,
  getContextMessages,
} from "../core/acp.js";

// ─── ACP Protocol Types ───────────────────────────────────────────────────

interface ACPAgent {
  id: string;
  name: string;
  description?: string;
  capabilities?: string[];
  status: "active" | "inactive";
  createdAt: string;
}

interface ACPRun {
  id: string;
  agentId: string;
  contextId: string;
  status: "active" | "completed" | "failed" | "cancelled";
  createdAt: string;
  endedAt?: string;
  metadata?: Record<string, unknown>;
}

interface ACPContext {
  id: string;
  name: string;
  description?: string;
  guidelines?: string;
  status: "active" | "archived";
  createdAt: string;
  memberCount: number;
}

interface ACPMessage {
  id: string;
  contextId: string;
  agentId: string;
  content: string;
  createdAt: string;
  replyTo?: string;
  tags?: string[];
}

interface ACPPaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

// ─── Helper Functions ─────────────────────────────────────────────────────

function formatAgent(agent: any): ACPAgent {
  return {
    id: agent.agentId || agent.id,
    name: agent.name,
    description: agent.role,
    capabilities: agent.queues || [],
    status: "active",
    createdAt: agent.registeredAt || agent.created_at,
  };
}

function formatRun(run: any): ACPRun {
  return {
    id: run.id || run.runId,
    agentId: run.agentId,
    contextId: run.contextId,
    status: run.status || "active",
    createdAt: run.createdAt || run.created_at,
    endedAt: run.endedAt || run.ended_at,
  };
}

function formatContext(context: any): ACPContext {
  return {
    id: context.id || context.contextId,
    name: context.name,
    description: context.description,
    guidelines: context.guidelines,
    status: "active",
    createdAt: context.createdAt || context.created_at,
    memberCount: context.memberCount || 0,
  };
}

function formatMessage(msg: any): ACPMessage {
  return {
    id: msg.id || msg.messageId,
    contextId: msg.pool || msg.contextId,
    agentId: msg.agentId || msg.agent_id,
    content: msg.content,
    createdAt: msg.createdAt || msg.created_at,
    replyTo: msg.replyTo || msg.reply_to,
    tags: msg.tags ? JSON.parse(msg.tags) : [],
  };
}

// ─── ACP Agent Handlers ───────────────────────────────────────────────────

export async function acpListAgents(
  db: DbClient,
  options?: { limit?: number; offset?: number },
): Promise<ACPPaginatedResponse<ACPAgent>> {
  const limit = options?.limit || 20;
  const agents = await listAgents(db);
  return {
    data: agents.map(formatAgent).slice(0, limit),
    pagination: { total: agents.length, limit, offset: options?.offset || 0 },
  };
}

export async function acpGetAgent(db: DbClient, agentId: string): Promise<ACPAgent | null> {
  const agents = await listAgents(db);
  const agent = agents.find((a: any) => a.agentId === agentId);
  return agent ? formatAgent(agent) : null;
}

// ─── ACP Run Handlers ─────────────────────────────────────────────────────

export async function acpListRuns(
  db: DbClient,
  options?: { agentId?: string; limit?: number },
): Promise<ACPPaginatedResponse<ACPRun>> {
  const limit = options?.limit || 20;
  const runs = await listRuns(db, { agentId: options?.agentId, limit });
  return {
    data: runs.map(formatRun),
    pagination: { total: runs.length, limit, offset: 0 },
  };
}

export async function acpCreateRun(
  db: DbClient,
  params: { agentId: string; name?: string; guidelines?: string },
): Promise<{ run: ACPRun }> {
  const result = await createRun(db, {
    agentId: params.agentId,
    name: params.name,
    guidelines: params.guidelines,
  });

  if (!result.ok) {
    throw new Error(result.error || "Failed to create run");
  }

  const run = await getRun(db, result.runId!);
  return { run: formatRun(run) };
}

export async function acpGetRun(db: DbClient, runId: string): Promise<{ run: ACPRun | null }> {
  const run = await getRun(db, runId);
  return { run: run ? formatRun(run) : null };
}

export async function acpCancelRun(
  db: DbClient,
  runId: string,
  agentId: string,
): Promise<{ run: ACPRun }> {
  await cancelRun(db, runId, agentId);
  const run = await getRun(db, runId);
  return { run: formatRun(run) };
}

// ─── ACP Context Handlers ─────────────────────────────────────────────────

export async function acpListContexts(
  db: DbClient,
  options?: { limit?: number },
): Promise<ACPPaginatedResponse<ACPContext>> {
  const limit = options?.limit || 20;
  const contexts = await listContexts(db, { limit });
  return {
    data: contexts.map(formatContext),
    pagination: { total: contexts.length, limit, offset: 0 },
  };
}

export async function acpCreateContext(
  db: DbClient,
  params: { agentId: string; name?: string; guidelines?: string },
): Promise<{ context: ACPContext }> {
  const result = await createContext(db, {
    agentId: params.agentId,
    name: params.name,
    guidelines: params.guidelines,
  });

  if (!result.ok) {
    throw new Error(result.error || "Failed to create context");
  }

  const context = await getContext(db, result.contextId!);
  return { context: formatContext(context) };
}

export async function acpGetContext(
  db: DbClient,
  contextId: string,
): Promise<{ context: ACPContext | null }> {
  const context = await getContext(db, contextId);
  return { context: context ? formatContext(context) : null };
}

export async function acpJoinContext(
  db: DbClient,
  contextId: string,
  agentId: string,
): Promise<{ success: boolean }> {
  const result = await joinContext(db, contextId, agentId);
  return { success: result.ok };
}

export async function acpLeaveContext(
  db: DbClient,
  contextId: string,
  agentId: string,
): Promise<{ success: boolean }> {
  const result = await leaveContext(db, contextId, agentId);
  return { success: result.ok };
}

export async function acpSpeakContext(
  db: DbClient,
  contextId: string,
  agentId: string,
  content: string,
  replyTo?: string,
  tags?: string[],
): Promise<{ message: ACPMessage }> {
  const result = await speakContext(db, contextId, agentId, content, { replyTo, tags });
  if (!result.ok) {
    throw new Error(result.error || "Failed to speak in context");
  }
  return {
    message: {
      id: result.id || crypto.randomUUID(),
      contextId,
      agentId,
      content,
      createdAt: new Date().toISOString(),
      replyTo,
      tags,
    },
  };
}

export async function acpGetContextMessages(
  db: DbClient,
  contextId: string,
  options?: { limit?: number; since?: string },
): Promise<ACPPaginatedResponse<ACPMessage>> {
  const limit = options?.limit || 50;
  const result = await getContextMessages(db, contextId, { limit });
  const messages = result.messages || [];
  return {
    data: messages.map(formatMessage),
    pagination: { total: messages.length, limit, offset: 0 },
  };
}
