// src/handlers/acp.ts — ACP protocol route handlers
import type { DbClient } from "../adapters/db/interface.js";
import {
  createRun, getRun, listRuns, cancelRun,
  createContext, getContext, listContexts,
  joinContext, leaveContext, speakContext,
  getContextMessages, getACPAgent,
} from "../core/acp.js";
import { listAgents } from "../core/queue.js";
import { getMessages } from "../core/pool.js";
import { ok, fail, sseHeaders } from "../utils/response.js";

export async function handleACPListRuns(db: DbClient) {
  return ok({ runs: await listRuns(db) });
}

export async function handleACPCreateRun(db: DbClient, body: any) {
  const { agentId, runId, name } = body;
  if (!agentId) return fail("Missing agentId");
  const result = await createRun(db, { agentId, runId, name });
  if (!result.ok) return fail(result.error || "Failed to create run");
  return ok(result);
}

export async function handleACPGetRun(db: DbClient, runId: string) {
  const run = await getRun(db, runId);
  if (!run) return fail("Run not found");
  return ok({ runId, run });
}

export async function handleACPCancelRun(db: DbClient, body: any) {
  if (!body.agentId || !body.runId) return fail("Missing agentId or runId");
  const result = await cancelRun(db, body.runId, body.agentId);
  return ok(result);
}

export async function handleACPListContexts(db: DbClient) {
  return ok({ contexts: await listContexts(db) });
}

export async function handleACPCreateContext(db: DbClient, body: any) {
  const { agentId, contextId, name, guidelines } = body;
  if (!agentId) return fail("Missing agentId");
  const result = await createContext(db, { agentId, contextId, name, guidelines });
  if (!result.ok) return fail(result.error || "Failed to create context");
  return ok(result);
}

export async function handleACPGetContext(db: DbClient, contextId: string) {
  const context = await getContext(db, contextId);
  if (!context) return fail("Context not found");
  return ok({ contextId, context });
}

export async function handleACPContextMessages(db: DbClient, contextId: string) {
  const result = await getContextMessages(db, contextId);
  if ('error' in result) return fail(result.error as string);
  return ok({ contextId, messages: result.messages });
}

export async function handleACPJoinContext(db: DbClient, contextId: string, body: any) {
  const { agentId } = body;
  if (!agentId) return fail("Missing agentId");
  const result = await joinContext(db, contextId, agentId);
  if (!result.ok) return fail(result.error || "Failed to join context");
  return ok({ contextId, agentId });
}

export async function handleACPLeaveContext(db: DbClient, contextId: string, body: any) {
  const { agentId } = body;
  if (!agentId) return fail("Missing agentId");
  const result = await leaveContext(db, contextId, agentId);
  if (!result.ok) return fail(result.error || "Failed to leave context");
  return ok({ contextId, agentId });
}

export async function handleACPSpeakContext(db: DbClient, contextId: string, body: any) {
  const { agentId, content, replyTo, tags, metadata } = body;
  if (!agentId || !content) return fail("Missing agentId or content");
  const result = await speakContext(db, contextId, agentId, content, { replyTo, tags, metadata });
  if (!result.ok) return fail(result.error || "Failed to speak");
  return ok({ contextId, id: result.id });
}

export async function handleACPListAgents(db: DbClient) {
  return ok({ agents: await listAgents(db) });
}

export async function handleACPGetAgent(db: DbClient, agentId: string) {
  const agent = await getACPAgent(db, agentId);
  if (!agent) return fail("Agent not found");
  return ok({ agent });
}

export async function handleACPRunStream(db: DbClient, runId: string, signal: AbortSignal) {
  const run = await getRun(db, runId);
  if (!run) return null;

  const poolName = `acp:${runId}`;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let lastCount = 0;
      let closed = false;

      (async () => {
        const result = await getMessages(db, poolName, undefined, { limit: 100 });
        if (!('error' in result)) {
          const msgs = result.messages;
          lastCount = msgs.length;
          controller.enqueue(encoder.encode(`event: init\ndata: ${JSON.stringify({ type: 'init', runId, messageCount: lastCount, messages: msgs })}\n\n`));
        }
      })();

      const interval = setInterval(async () => {
        if (closed) { clearInterval(interval); return; }
        try {
          const result = await getMessages(db, poolName, undefined, { limit: 100 });
          if (!('error' in result)) {
            const current = result.messages;
            if (current.length > lastCount) {
              const newMsgs = current.slice(lastCount);
              controller.enqueue(encoder.encode(`event: messages\ndata: ${JSON.stringify({ type: 'messages', runId, newMessages: newMsgs })}\n\n`));
              lastCount = current.length;
            }
          }
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch {}
      }, 2000);

      signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(interval);
        try { controller.close(); } catch {}
      });

      setTimeout(() => {
        closed = true;
        clearInterval(interval);
        try {
          controller.enqueue(encoder.encode(`event: close\ndata: {"type":"timeout"}\n\n`));
          controller.close();
        } catch {}
      }, 5 * 60 * 1000);
    },
  });

  return { stream, headers: sseHeaders() };
}
