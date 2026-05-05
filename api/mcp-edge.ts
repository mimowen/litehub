// api/mcp-edge.ts - MCP 端点 (Edge Runtime) - 轻量实现
export const config = { runtime: 'edge' };

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handle } from 'hono/vercel';
import { getDbClient } from '../src/adapters/db/turso.js';
import * as queue from '../src/core/queue.js';
import * as pool from '../src/core/pool.js';
import * as a2a from '../src/core/a2a.js';
import * as acp from '../src/core/acp.js';
import { MCP_TOOLS } from '../src/mcp/tools.js';

const app = new Hono();
app.use('*', cors({ origin: process.env.LITEHUB_CORS_ORIGIN || '*' }));

// 工具处理函数映射
async function handleTool(name: string, args: any, db: any) {
  try {
    switch (name) {
      case 'litehub_register': {
        const result = await queue.registerAgent(db, args);
        return { content: [{ type: 'text', text: `Agent registered: ${result.agent.agentId}` }] };
      }
      case 'litehub_produce': {
        if (!(await queue.ensureAgent(db, args.agentId))) {
          return { content: [{ type: 'text', text: `Agent '${args.agentId}' not registered.` }], isError: true };
        }
        // 确保 queue 存在（自动创建）
        await queue.ensureQueue(db, args.queue);
        // data 必须是字符串，非字符串则 JSON.stringify
        const dataStr = typeof args.data === 'string' ? args.data : JSON.stringify(args.data);
        const result = await queue.produce(db, args.queue, dataStr, args.agentId, {
          contentType: args.contentType,
          metadata: args.metadata,
        });
        if (!result) return { content: [{ type: 'text', text: `Failed to produce to '${args.queue}'.` }], isError: true };
        return { content: [{ type: 'text', text: `Produced to '${args.queue}'\nPointer ID: ${result.id}\nQueue: ${result.queue}\nCreated: ${result.createdAt}` }] };
      }
      case 'litehub_consume': {
        if (!(await queue.ensureAgent(db, args.agentId))) {
          return { content: [{ type: 'text', text: `Agent '${args.agentId}' not registered.` }], isError: true };
        }
        const result = await queue.consume(db, args.queue, args.agentId, args.maxItems, {
          loopDetection: args.loopDetection,
        });
        if (!result || result.length === 0) return { content: [{ type: 'text', text: 'No messages available.' }] };
        return { content: result.map((m: any) => ({ type: 'text', text: JSON.stringify(m) })) };
      }
      case 'litehub_peek': {
        const msg = await queue.peek(db, args.queue);
        if (!msg) return { content: [{ type: 'text', text: 'Queue is empty.' }] };
        return { content: [{ type: 'text', text: JSON.stringify(msg) }] };
      }
      case 'litehub_pipe': {
        if (!(await queue.ensureAgent(db, args.agentId))) {
          return { content: [{ type: 'text', text: `Agent '${args.agentId}' not registered.` }], isError: true };
        }
        const result = await queue.pipe(db, args.sourcePointerId, args.targetQueue, args.agentId);
        if (!result) return { content: [{ type: 'text', text: `Pointer '${args.sourcePointerId}' not found.` }], isError: true };
        return { content: [{ type: 'text', text: `Piped to '${args.targetQueue}'` }] };
      }
      case 'litehub_pool_create': {
        const result = await pool.createPool(db, args.name, args.description, args.guidelines, args.maxMembers, args.agentId);
        return { content: [{ type: 'text', text: `Pool created: ${result.name}` }] };
      }
      case 'litehub_pool_join': {
        // 验证 pool 是否存在
        const poolInfo = await pool.getPool(db, args.pool);
        if (!poolInfo) return { content: [{ type: 'text', text: `Pool '${args.pool}' does not exist.` }], isError: true };
        const result = await pool.joinPool(db, args.pool, args.agentId);
        if (!result) return { content: [{ type: 'text', text: `Failed to join pool (already member or pool full)` }], isError: true };
        return { content: [{ type: 'text', text: `Joined pool '${args.pool}'` }] };
      }
      case 'litehub_pool_leave': {
        const result = await pool.leavePool(db, args.pool, args.agentId);
        if (!result) return { content: [{ type: 'text', text: `Not a member of pool '${args.pool}'` }], isError: true };
        return { content: [{ type: 'text', text: `Left pool '${args.pool}'` }] };
      }
      case 'litehub_pool_speak': {
        if (!(await queue.ensureAgent(db, args.agentId))) {
          return { content: [{ type: 'text', text: `Agent '${args.agentId}' not registered.` }], isError: true };
        }
        const result = await pool.speak(db, args.pool, args.agentId, args.content, {
          replyTo: args.replyTo,
          tags: args.tags,
          metadata: args.metadata,
        });
        if ('error' in result) return { content: [{ type: 'text', text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: 'text', text: `Message sent: ${result.id}` }] };
      }
      case 'litehub_pool_read': {
        const result = await pool.getMessages(db, args.pool, args.agentId, {
          since: args.since,
          tag: args.tag,
          limit: args.limit,
        });
        if ('error' in result) return { content: [{ type: 'text', text: `Failed: ${result.error}` }], isError: true };
        if (!result.messages || result.messages.length === 0) return { content: [{ type: 'text', text: `No messages in pool '${args.pool}'.` }] };
        return { content: result.messages.map((m: any) => ({ type: 'text', text: `[${m.agentId}] ${m.content}` })) };
      }
      case 'litehub_agents': {
        const agents = await queue.listAgents(db);
        return { content: [{ type: 'text', text: `Agents (${agents.length}):\n\n${agents.map((a: any) => `- ${a.name} (${a.role})`).join('\n')}` }] };
      }
      case 'litehub_queues': {
        const queues = await queue.listQueues(db);
        return { content: [{ type: 'text', text: `Queues (${queues.length}):\n\n${queues.map((q: any) => `- ${q.name}\n  Pending: ${q.pending}\n  Consumed: ${q.consumed}`).join('\n')}` }] };
      }
      case 'litehub_pools': {
        const pools = await pool.listPools(db);
        return { content: [{ type: 'text', text: `Pools (${pools.length}):\n\n${pools.map((p: any) => `- ${p.name}\n  Members: ${p.memberCount}/${p.maxMembers}`).join('\n')}` }] };
      }
      case 'litehub_my_resources': {
        const queues = await queue.listQueues(db);
        const pools = await pool.listPools(db);
        return { content: [{ type: 'text', text: `Resources for '${args.agentId}':\n\nQueues: ${queues.filter((q: any) => q.creatorId === args.agentId).length}\nPools: ${pools.filter((p: any) => p.creatorId === args.agentId).length}` }] };
      }
      case 'a2a_create_task': {
        // 把 description 映射到 name（如果调用方传的是 description）
        const createParams = {
          agentId: args.agentId,
          targetAgentId: args.targetAgentId,
          taskId: args.taskId,
          name: args.name || args.description || '',
          input: args.input,
          messageId: args.messageId,
          metadata: args.metadata,
        };
        const result = await a2a.createTask(db, createParams);
        if (!result.ok) return { content: [{ type: 'text', text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: 'text', text: `Task created: ${result.taskId}` }] };
      }
      case 'a2a_get_task': {
        const task = await a2a.getTask(db, args.taskId);
        if (!task) return { content: [{ type: 'text', text: `Task '${args.taskId}' not found.` }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
      }
      case 'a2a_list_tasks': {
        const tasks = await a2a.listTasks(db, { agentId: args.agentId, status: args.status });
        return { content: [{ type: 'text', text: `Tasks (${tasks.length}):\n\n${tasks.map((t: any) => `- ${t.taskId}: ${t.name || 'N/A'} [${t.status || 'active'}]`).join('\n') || 'No tasks'}` }] };
      }
      case 'a2a_cancel_task': {
        const result = await a2a.cancelTask(db, args.taskId, args.agentId);
        return { content: [{ type: 'text', text: `Task cancelled: ${result.cancelled} task(s) affected` }] };
      }
      case 'a2a_update_task': {
        const result = await a2a.updateTask(db, args.taskId, args.agentId, args.status);
        if (!result.ok) return { content: [{ type: 'text', text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: 'text', text: `Task updated: ${result.updated} task(s) affected` }] };
      }
      case 'a2a_set_push_notification': {
        const result = await a2a.setPushNotification(db, args);
        return { content: [{ type: 'text', text: result.message }] };
      }
      case 'a2a_get_push_notification': {
        const subs = await a2a.getPushNotification(db, args.agentId);
        return { content: [{ type: 'text', text: `Subscriptions:\n\n${JSON.stringify(subs, null, 2)}` }] };
      }
      case 'a2a_send_message': {
        const result = await a2a.sendToTask(db, {
          taskId: args.taskId,
          agentId: args.agentId,
          message: args.message,
          messageId: args.messageId,
          metadata: args.metadata,
        });
        if (!result.ok) return { content: [{ type: 'text', text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: 'text', text: `Message sent: ${result.pointerId}` }] };
      }
      case 'a2a_subscribe_task': {
        return { content: [{ type: 'text', text: `Subscribe URL: /api/a2a/tasks/${args.taskId}/subscribe` }] };
      }
      case 'acp_create_run': {
        // 如果没传 name 但传了 description，用 description 作为 name
        const createParams = {
          agentId: args.agentId,
          runId: args.runId,
          name: args.name || args.description || '',
          guidelines: args.guidelines,
          maxMembers: args.maxMembers,
        };
        const result = await acp.createRun(db, createParams);
        if (!result.ok) return { content: [{ type: 'text', text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: 'text', text: `Run created: ${result.runId}` }] };
      }
      case 'acp_get_run': {
        const run = await acp.getRun(db, args.runId);
        if (!run) return { content: [{ type: 'text', text: `Run '${args.runId}' not found.` }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify(run, null, 2) }] };
      }
      case 'acp_list_runs': {
        const runs = await acp.listRuns(db, { agentId: args.agentId });
        return { content: [{ type: 'text', text: `Runs (${runs.length}):\n\n${runs.map((r: any) => `- ${r.runId}: ${r.description || ''} [${r.status || 'active'}]`).join('\n') || 'No runs'}` }] };
      }
      case 'acp_cancel_run': {
        const result = await acp.cancelRun(db, args.runId, args.agentId);
        return { content: [{ type: 'text', text: `Run cancelled: ${result.cancelled} run(s) affected` }] };
      }
      case 'acp_create_context': {
        const createParams = {
          agentId: args.agentId,
          contextId: args.contextId,
          name: args.name || args.description || '',
          guidelines: args.guidelines,
        };
        const result = await acp.createContext(db, createParams);
        if (!result.ok) return { content: [{ type: 'text', text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: 'text', text: `Context created: ${result.contextId}` }] };
      }
      case 'acp_get_context': {
        const ctx = await acp.getContext(db, args.contextId);
        if (!ctx) return { content: [{ type: 'text', text: `Context '${args.contextId}' not found.` }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify(ctx, null, 2) }] };
      }
      case 'acp_join_context': {
        const result = await acp.joinContext(db, args.contextId, args.agentId);
        if (!result.ok) return { content: [{ type: 'text', text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: 'text', text: `Joined context '${args.contextId}'` }] };
      }
      case 'acp_leave_context': {
        const result = await acp.leaveContext(db, args.contextId, args.agentId);
        if (!result.ok) return { content: [{ type: 'text', text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: 'text', text: `Left context '${args.contextId}'` }] };
      }
      case 'acp_speak_context': {
        if (!(await queue.ensureAgent(db, args.agentId))) {
          return { content: [{ type: 'text', text: `Agent '${args.agentId}' not registered.` }], isError: true };
        }
        const result = await acp.speakContext(db, args.contextId, args.agentId, args.content, {
          replyTo: args.replyTo,
          tags: args.tags,
        });
        if (!result.ok) return { content: [{ type: 'text', text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: 'text', text: `Message sent: ${result.id}` }] };
      }
      case 'acp_list_contexts': {
        const contexts = await acp.listContexts(db, { limit: args.limit });
        return { content: [{ type: 'text', text: `Contexts (${contexts.length}):\n\n${contexts.map((c: any) => `- ${c.contextId}: ${c.name || 'N/A'} [Members: ${c.members?.length || 0}]`).join('\n') || 'No contexts'}` }] };
      }
      case 'acp_get_context_messages': {
        const result = await acp.getContextMessages(db, args.contextId, { limit: args.limit });
        if ('error' in result) return { content: [{ type: 'text', text: `Failed: ${result.error}` }], isError: true };
        if (!result.messages || result.messages.length === 0) return { content: [{ type: 'text', text: `No messages in context '${args.contextId}'.` }] };
        return { content: [{ type: 'text', text: `Retrieved ${result.messages.length} messages:\n\n${result.messages.map((m: any) => `[${m.agentId}] ${m.content.substring(0, 100)}`).join('\n')}` }] };
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error: any) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
  }
}

// MCP JSON-RPC 处理
app.post('/mcp', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any;
  const { method, params, id } = body;

  if (method === 'initialize') {
    return c.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'LiteHub', version: '0.2.0' },
      },
    });
  }

  if (method === 'tools/list') {
    return c.json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: MCP_TOOLS.map((t: any) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
    });
  }

  if (method === 'tools/call') {
    const db = await getDbClient();
    const result = await handleTool(params?.name, params?.arguments || {}, db);
    return c.json({ jsonrpc: '2.0', id, result });
  }

  if (method === 'ping') {
    return c.json({ jsonrpc: '2.0', id, result: {} });
  }

  return c.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method '${method}' not found` } });
});

// GET 请求返回简单信息
app.get('/mcp', (c) => c.json({ message: 'Use POST to send JSON-RPC requests' }));

export default handle(app);
