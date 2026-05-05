// src/mcp-handler.ts — MCP SDK 集成（异步 core / 函数）
// 使用官方 @modelcontextprotocol/sdk，所有 tool callback 通过闭包获取 DbClient
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Context } from "hono";
import type { DbClient } from "./adapters/db/interface.js";
import * as queue from "./core/queue.js";
import * as pool from "./core/pool.js";
import * as a2a from "./core/a2a.js";
import * as acp from "./core/acp.js";

// Session management maps
const streamableTransports = new Map<string, WebStandardStreamableHTTPServerTransport>();
const sessionServers = new Map<string, McpServer>();

export function createMcpServer(getDb: () => Promise<DbClient>): McpServer {
  const server = new McpServer(
    { name: "LiteHub", version: "2.0.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  // ─── Agent Tools ────────────────────────────────────────────────────

  server.tool(
    "litehub_register",
    "Register an AI agent to the LiteHub collaboration system with specified role and queue subscriptions",
    {
      agentId: z.string().describe("Unique identifier for the agent"),
      name: z.string().describe("Human-readable name of the agent"),
      role: z.enum(["producer", "consumer", "both"]).describe("Agent role: producer, consumer, or both"),
      queues: z.array(z.string()).describe("List of queue names this agent subscribes to"),
      pollInterval: z.number().optional().describe("Polling interval in milliseconds (default: 5000)"),
    },
    async ({ agentId, name, role, queues, pollInterval }) => {
      try {
        const db = await getDb();
        const result = await queue.registerAgent(db, { agentId, name, role, queues, pollInterval });
        return { content: [{ type: "text", text: `Agent registered successfully:\n${JSON.stringify(result, null, 2)}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to register agent: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "litehub_produce",
    "Produce data to a named queue in LiteHub. Other agents can consume this data.",
    {
      agentId: z.string().describe("ID of the producing agent"),
      queue: z.string().describe("Target queue name"),
      data: z.string().describe("Data to produce (string content)"),
      contentType: z.string().optional().describe("Content type (e.g., 'text/plain', 'application/json')"),
      metadata: z.record(z.string(), z.any()).optional().describe("Optional metadata attached to the message"),
    },
    async ({ agentId, queue: queueName, data, contentType, metadata }) => {
      try {
        const db = await getDb();
        const pointer = await queue.produce(db, queueName, String(data), agentId, { contentType, metadata });
        if (!pointer) {
          return { content: [{ type: "text", text: `Queue '${queueName}' does not exist. Register first or use a queue created by another agent.` }], isError: true };
        }
        return { content: [{ type: "text", text: `Data produced to queue '${queueName}':\nPointer ID: ${pointer.id}\nQueue: ${pointer.queue}\nCreated: ${pointer.createdAt}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to produce data: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "litehub_consume",
    "Consume data from a queue (FIFO). Returns the next available item(s).",
    {
      agentId: z.string().describe("ID of the consuming agent"),
      queue: z.string().describe("Source queue name"),
      maxItems: z.number().optional().describe("Maximum number of items to consume (default: 1)"),
      loopDetection: z.boolean().optional().describe("Enable loop detection to prevent infinite cycles (default: true)"),
    },
    async ({ agentId, queue: queueName, maxItems, loopDetection }) => {
      try {
        const db = await getDb();
        const items = await queue.consume(db, queueName, agentId, maxItems || 1, { loopDetection: loopDetection !== false });
        if (!items || items.length === 0) {
          return { content: [{ type: "text", text: `Queue '${queueName}' is empty. No data to consume.` }] };
        }
        return {
          content: [{
            type: "text",
            text: `Consumed ${items.length} item(s) from queue '${queueName}':\n\n${items.map((item, idx) =>
              `--- Item ${idx + 1} ---\nData: ${item.data}\nProducer: ${item.pointer.producerId}\nCreated: ${item.pointer.createdAt}\nPointer ID: ${item.pointer.id}`,
            ).join("\n\n")}`,
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to consume data: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "litehub_peek",
    "Preview the next item in a queue without consuming it.",
    { queue: z.string().describe("Queue name to peek") },
    async ({ queue: queueName }) => {
      try {
        const db = await getDb();
        const pointer = await queue.peek(db, queueName);
        if (!pointer) {
          return { content: [{ type: "text", text: `Queue '${queueName}' is empty or does not exist.` }] };
        }
        return { content: [{ type: "text", text: `Peek at queue '${queueName}':\nPointer ID: ${pointer.id}\nProducer: ${pointer.producerId}\nCreated: ${pointer.createdAt}\nSize: ${pointer.size} bytes` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to peek queue: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "litehub_pipe",
    "Consume from source queue and produce to target queue. Automatically carries source lineage in metadata.",
    {
      agentId: z.string().describe("ID of the processing agent"),
      sourceQueue: z.string().describe("Source queue to consume from"),
      targetQueue: z.string().describe("Target queue to produce to"),
      data: z.string().describe("Transformed data to produce to target queue"),
      contentType: z.string().optional().describe("Content type of the output data"),
      metadata: z.record(z.string(), z.any()).optional().describe("Additional metadata for the output"),
    },
    async ({ agentId, sourceQueue, targetQueue, data, contentType, metadata }) => {
      try {
        const db = await getDb();
        // consume + produce (API-compatible pipe)
        const consumed = await queue.consume(db, sourceQueue, agentId, 1);
        if (!consumed || consumed.length === 0) {
          return { content: [{ type: "text", text: `Source queue '${sourceQueue}' is empty.` }], isError: true };
        }
        await queue.ensureQueue(db, targetQueue, undefined, agentId);
        const output = await queue.produce(db, targetQueue, String(data), agentId, {
          contentType,
          metadata,
          lineage: consumed[0].pointer.lineage,
        });
        return {
          content: [{
            type: "text",
            text: `Piped data from '${sourceQueue}' to '${targetQueue}':\n\nInput Pointer: ${consumed[0].pointer.id}\nOutput Pointer: ${output?.id}\nLineage: sourceQueue=${sourceQueue}, sourcePointer=${consumed[0].pointer.id}`,
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to pipe data: ${error.message}` }], isError: true };
      }
    },
  );

  // ─── Pool Tools ─────────────────────────────────────────────────────

  server.tool(
    "litehub_pool_create",
    "Create a new collaboration pool (group chat space) for multiple agents to interact",
    {
      name: z.string().describe("Unique pool name"),
      description: z.string().optional().describe("Pool description"),
      guidelines: z.string().optional().describe("Collaboration guidelines for pool members"),
      maxMembers: z.number().optional().describe("Maximum number of members (default: 50)"),
    },
    async ({ name, description, guidelines, maxMembers }) => {
      try {
        const db = await getDb();
        const p = await pool.createPool(db, name, description, guidelines, maxMembers);
        return { content: [{ type: "text", text: `Pool created successfully:\nName: ${p.name}\nDescription: ${p.description || "N/A"}\nMax Members: ${p.maxMembers}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to create pool: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "litehub_pool_join",
    "Join an existing collaboration pool as an agent member",
    {
      pool: z.string().describe("Pool name to join"),
      agentId: z.string().describe("Agent ID joining the pool"),
    },
    async ({ pool: poolName, agentId }) => {
      try {
        const db = await getDb();
        const result = await pool.joinPool(db, poolName, agentId);
        if (!result.ok) {
          return { content: [{ type: "text", text: `Failed to join pool: ${result.error}` }], isError: true };
        }
        const poolInfo = await pool.getPool(db, poolName);
        const memberCount = poolInfo?.memberCount || 0;
        const maxMembers = poolInfo?.maxMembers || 0;
        return { content: [{ type: "text", text: `Agent '${agentId}' joined pool '${poolName}'\nCurrent members: ${memberCount}/${maxMembers}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to join pool: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "litehub_pool_leave",
    "Leave a collaboration pool",
    {
      pool: z.string().describe("Pool name to leave"),
      agentId: z.string().describe("Agent ID leaving the pool"),
    },
    async ({ pool: poolName, agentId }) => {
      try {
        const db = await getDb();
        await pool.leavePool(db, poolName, agentId);
        return { content: [{ type: "text", text: `Agent '${agentId}' left pool '${poolName}'` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to leave pool: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "litehub_pool_speak",
    "Send a message to a collaboration pool. Supports threading via replyTo and tagging via tags.",
    {
      pool: z.string().describe("Pool name to send message to"),
      agentId: z.string().describe("Agent ID sending the message"),
      content: z.string().describe("Message content"),
      replyTo: z.string().optional().describe("Message ID to reply to (for threading)"),
      tags: z.array(z.string()).optional().describe("Tags for categorizing the message"),
      metadata: z.record(z.string(), z.any()).optional().describe("Additional metadata"),
    },
    async ({ pool: poolName, agentId, content, replyTo, tags, metadata }) => {
      try {
        const db = await getDb();
        const msg = await pool.speak(db, poolName, agentId, content, { replyTo, tags, metadata });
        if ("error" in msg) {
          return { content: [{ type: "text", text: `${msg.error}` }], isError: true };
        }
        return { content: [{ type: "text", text: `Message sent to pool '${poolName}':\nMessage ID: ${msg.id}\nFrom: ${msg.agentId}\nCreated: ${msg.createdAt}\nContent: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? "..." : ""}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to send message: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "litehub_pool_read",
    "Read messages from a collaboration pool. Supports filtering by time, tags, and limit.",
    {
      pool: z.string().describe("Pool name to read messages from"),
      since: z.string().optional().describe("ISO timestamp to filter messages after this time"),
      tag: z.string().optional().describe("Filter messages by tag"),
      limit: z.number().optional().describe("Maximum number of messages to retrieve (default: 50)"),
    },
    async ({ pool: poolName, since, tag, limit }) => {
      try {
        const db = await getDb();
        const result = await pool.getMessages(db, poolName, undefined, { since, tag, limit });
        if ("error" in result) {
          return { content: [{ type: "text", text: `Failed: ${result.error}` }], isError: true };
        }
        if (!result.messages || result.messages.length === 0) {
          return { content: [{ type: "text", text: `No messages found in pool '${poolName}'.` }] };
        }
        return {
          content: [{
            type: "text",
            text: `Retrieved ${result.messages.length} message(s) from pool '${poolName}':\n\n${result.messages.map((msg: any, idx: number) =>
              `--- Message ${idx + 1} ---\nID: ${msg.id}\nFrom: ${msg.agentId}\nTime: ${msg.createdAt}\nContent: ${msg.content.substring(0, 150)}${msg.content.length > 150 ? "..." : ""}`,
            ).join("\n\n")}${result.guidelines ? `\n\nPool Guidelines:\n${result.guidelines}` : ""}`,
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to read messages: ${error.message}` }], isError: true };
      }
    },
  );

  // ─── Query Tools ────────────────────────────────────────────────────

  server.tool("litehub_agents", "List all registered agents in the system", {}, async () => {
    try {
      const db = await getDb();
      const agents = await queue.listAgents(db);
      return {
        content: [{
          type: "text",
          text: `Registered Agents (${agents.length}):\n\n${agents.map(a => `- ${a.name} (${a.agentId})\n  Role: ${a.role}\n  Queues: ${a.queues.join(", ")}`).join("\n")}`,
        }],
      };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Failed to list agents: ${error.message}` }], isError: true };
    }
  });

  server.tool("litehub_queues", "List all queues with their statistics (pending/consumed counts)", {}, async () => {
    try {
      const db = await getDb();
      const queues = await queue.listQueues(db);
      return {
        content: [{
          type: "text",
          text: `Queues (${queues.length}):\n\n${queues.map(q => `- ${q.name}\n  Pending: ${q.pending}\n  Consumed: ${q.consumed}\n  Created: ${q.createdAt}`).join("\n")}`,
        }],
      };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Failed to list queues: ${error.message}` }], isError: true };
    }
  });

  server.tool("litehub_pools", "List all collaboration pools with member counts", {}, async () => {
    try {
      const db = await getDb();
      const pools = await pool.listPools(db);
      return {
        content: [{
          type: "text",
          text: `Collaboration Pools (${pools.length}):\n\n${pools.map(p => `- ${p.name}\n  Members: ${p.memberCount}/${p.maxMembers}\n  Description: ${p.description || "N/A"}`).join("\n")}`,
        }],
      };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Failed to list pools: ${error.message}` }], isError: true };
    }
  });

  server.tool(
    "litehub_my_resources",
    "List resources (queues, pools) created by a specific agent",
    { agentId: z.string().describe("Agent ID to filter resources by") },
    async ({ agentId }) => {
      try {
        const db = await getDb();
        if (!(await queue.ensureAgent(db, agentId))) {
          return { content: [{ type: "text", text: `Agent '${agentId}' not registered.` }], isError: true };
        }
        const queues = await queue.listQueues(db);
        const pools = await pool.listPools(db);
        return {
          content: [{
            type: "text",
            text: `Resources for agent '${agentId}':\n\nQueues:\n${queues.filter(q => q.creatorId === agentId).map(q => `- ${q.name}`).join("\n") || "  None"}\n\nPools:\n${pools.filter(p => p.creatorId === agentId).map(p => `- ${p.name}`).join("\n") || "  None"}`,
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  // ─── A2A Tools ─────────────────────────────────────────────────────

  server.tool(
    "a2a_create_task",
    "Create an A2A (Agent-to-Agent) task mapped to a LiteHub queue",
    {
      agentId: z.string().describe("Agent creating the task"),
      targetAgentId: z.string().optional().describe("Target agent ID"),
      name: z.string().optional().describe("Task name"),
      input: z.any().optional().describe("Task input data"),
    },
    async ({ agentId, targetAgentId, name, input }) => {
      try {
        const db = await getDb();
        const result = await a2a.createTask(db, { agentId, targetAgentId, name, input });
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: "text", text: `A2A Task created:\nTask ID: ${result.taskId}\nQueue: ${result.queue}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "a2a_get_task",
    "Get details of an A2A task",
    { taskId: z.string().describe("Task ID") },
    async ({ taskId }) => {
      try {
        const db = await getDb();
        const task = await a2a.getTask(db, taskId);
        if (!task) return { content: [{ type: "text", text: `Task '${taskId}' not found.` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "a2a_list_tasks",
    "List A2A tasks, optionally filtered by agent or status",
    {
      agentId: z.string().optional().describe("Filter by agent ID"),
      status: z.string().optional().describe("Filter by status"),
    },
    async ({ agentId, status }) => {
      try {
        const db = await getDb();
        const tasks = await a2a.listTasks(db, { agentId, status });
        return { content: [{ type: "text", text: `A2A Tasks (${tasks.length}):\n\n${tasks.map(t => `- ${t.taskId}: ${t.name} [${t.status}]`).join("\n") || "No tasks"}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "a2a_cancel_task",
    "Cancel an A2A task",
    {
      taskId: z.string().describe("Task ID to cancel"),
      agentId: z.string().describe("Agent requesting cancellation"),
    },
    async ({ taskId, agentId }) => {
      try {
        const db = await getDb();
        const result = await a2a.cancelTask(db, taskId, agentId);
        return { content: [{ type: "text", text: `Task cancelled: ${result.cancelled} task(s) affected` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "a2a_update_task",
    "Update an A2A task status (running/completed/failed)",
    {
      taskId: z.string().describe("Task ID to update"),
      agentId: z.string().describe("Agent requesting the update"),
      status: z.enum(["running", "completed", "failed"]).describe("New status"),
    },
    async ({ taskId, agentId, status }) => {
      try {
        const db = await getDb();
        const result = await a2a.updateTask(db, taskId, agentId, status);
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: "text", text: `Task updated: ${result.updated} task(s) affected` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "a2a_set_push_notification",
    "Configure push notification (webhook) for an A2A task",
    {
      agentId: z.string().describe("Agent ID"),
      webhookUrl: z.string().describe("Webhook URL for notifications"),
      taskId: z.string().optional().describe("Task ID to subscribe to"),
      secret: z.string().optional().describe("Secret for webhook verification"),
    },
    async ({ agentId, webhookUrl, taskId, secret }) => {
      try {
        const db = await getDb();
        const result = await a2a.setPushNotification(db, { agentId, webhookUrl, taskId, secret });
        return { content: [{ type: "text", text: result.message }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "a2a_get_push_notification",
    "Get push notification subscriptions for an agent",
    { agentId: z.string().describe("Agent ID") },
    async ({ agentId }) => {
      try {
        const db = await getDb();
        const subs = await a2a.getPushNotification(db, agentId);
        return { content: [{ type: "text", text: `Push subscriptions for '${agentId}':\n${JSON.stringify(subs, null, 2)}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "a2a_send_message",
    "Send a message to an existing A2A task. This is the core messaging function for agent-to-agent communication.",
    {
      taskId: z.string().describe("Task ID to send message to"),
      agentId: z.string().describe("Sender agent ID"),
      message: z.any().describe("Message content to send (any JSON-serializable data)"),
      messageId: z.string().optional().describe("Optional message ID for idempotency"),
      metadata: z.record(z.string(), z.any()).optional().describe("Optional metadata attached to the message"),
    },
    async ({ taskId, agentId, message, messageId, metadata }) => {
      try {
        const db = await getDb();
        const result = await a2a.sendToTask(db, { taskId, agentId, message, messageId, metadata });
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: "text", text: `Message sent to task '${taskId}'. Pointer ID: ${result.pointerId}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "a2a_subscribe_task",
    "Get the SSE subscription URL for real-time task updates. Returns the URL to connect to for receiving messages and status changes.",
    { taskId: z.string().describe("Task ID to subscribe to") },
    async ({ taskId }) => {
      try {
        const db = await getDb();
        const task = await a2a.getTask(db, taskId);
        if (!task) return { content: [{ type: "text", text: `Task '${taskId}' not found` }], isError: true };
        return {
          content: [{
            type: "text",
            text: `SSE Subscription URL for task '${taskId}':\n\nGET /api/a2a/tasks/${taskId}/subscribe\n\nStatus: ${task.status}\nQueue: ${task.queueName}\n\nConnect to this endpoint via SSE to receive real-time updates.`
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  // ─── ACP Tools ─────────────────────────────────────────────────────

  server.tool(
    "acp_create_run",
    "Create an ACP (Agent Communication Protocol) run mapped to a LiteHub pool",
    {
      agentId: z.string().describe("Agent creating the run"),
      name: z.string().optional().describe("Run name"),
      guidelines: z.string().optional().describe("Collaboration guidelines"),
    },
    async ({ agentId, name, guidelines }) => {
      try {
        const db = await getDb();
        const result = await acp.createRun(db, { agentId, name, guidelines });
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: "text", text: `ACP Run created:\nRun ID: ${result.runId}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "acp_get_run",
    "Get details of an ACP run",
    { runId: z.string().describe("Run ID") },
    async ({ runId }) => {
      try {
        const db = await getDb();
        const run = await acp.getRun(db, runId);
        if (!run) return { content: [{ type: "text", text: `Run '${runId}' not found.` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(run, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "acp_list_runs",
    "List ACP runs, optionally filtered by agent",
    { agentId: z.string().optional().describe("Filter by agent ID") },
    async ({ agentId }) => {
      try {
        const db = await getDb();
        const runs = await acp.listRuns(db, { agentId });
        return { content: [{ type: "text", text: `ACP Runs (${runs.length}):\n\n${runs.map(r => `- ${r.runId}: ${r.description || ""} [${r.status || "active"}]`).join("\n") || "No runs"}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "acp_cancel_run",
    "Cancel an ACP run",
    {
      runId: z.string().describe("Run ID to cancel"),
      agentId: z.string().describe("Agent requesting cancellation"),
    },
    async ({ runId, agentId }) => {
      try {
        const db = await getDb();
        const result = await acp.cancelRun(db, runId, agentId);
        return { content: [{ type: "text", text: `Run cancelled: ${result.cancelled} run(s) affected` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "acp_create_context",
    "Create an ACP context (collaboration space) mapped to a LiteHub pool",
    {
      agentId: z.string().describe("Agent creating the context"),
      name: z.string().optional().describe("Context name"),
      guidelines: z.string().optional().describe("Collaboration guidelines"),
    },
    async ({ agentId, name, guidelines }) => {
      try {
        const db = await getDb();
        const result = await acp.createContext(db, { agentId, name, guidelines });
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: "text", text: `ACP Context created:\nContext ID: ${result.contextId}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "acp_get_context",
    "Get details of an ACP context",
    { contextId: z.string().describe("Context ID") },
    async ({ contextId }) => {
      try {
        const db = await getDb();
        const ctx = await acp.getContext(db, contextId);
        if (!ctx) return { content: [{ type: "text", text: `Context '${contextId}' not found.` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(ctx, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "acp_join_context",
    "Join an ACP context",
    {
      contextId: z.string().describe("Context ID to join"),
      agentId: z.string().describe("Agent ID joining"),
    },
    async ({ contextId, agentId }) => {
      try {
        const db = await getDb();
        const result = await acp.joinContext(db, contextId, agentId);
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: "text", text: `Agent '${agentId}' joined context '${contextId}'` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "acp_leave_context",
    "Leave an ACP context",
    {
      contextId: z.string().describe("Context ID to leave"),
      agentId: z.string().describe("Agent ID leaving"),
    },
    async ({ contextId, agentId }) => {
      try {
        const db = await getDb();
        const result = await acp.leaveContext(db, contextId, agentId);
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: "text", text: `Agent '${agentId}' left context '${contextId}'` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "acp_speak_context",
    "Send a message in an ACP context",
    {
      contextId: z.string().describe("Context ID"),
      agentId: z.string().describe("Agent ID sending the message"),
      content: z.string().describe("Message content"),
      replyTo: z.string().optional().describe("Message ID to reply to"),
      tags: z.array(z.string()).optional().describe("Tags for the message"),
    },
    async ({ contextId, agentId, content, replyTo, tags }) => {
      try {
        const db = await getDb();
        const result = await acp.speakContext(db, contextId, agentId, content, { replyTo, tags });
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.error}` }], isError: true };
        return { content: [{ type: "text", text: `Message sent in context '${contextId}':\nMessage ID: ${result.id}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "acp_list_contexts",
    "List ACP contexts (collaboration spaces)",
    {
      limit: z.number().optional().describe("Maximum number of contexts to return"),
    },
    async ({ limit }) => {
      try {
        const db = await getDb();
        const contexts = await acp.listContexts(db, { limit });
        return { content: [{ type: "text", text: `ACP Contexts (${contexts.length}):\n\n${contexts.map(c => `- ${c.contextId}: ${c.name || "N/A"} [Members: ${c.members?.length || 0}]`).join("\n") || "No contexts"}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  server.tool(
    "acp_get_context_messages",
    "Read messages from an ACP context",
    {
      contextId: z.string().describe("Context ID to read messages from"),
      limit: z.number().optional().describe("Maximum number of messages to retrieve"),
    },
    async ({ contextId, limit }) => {
      try {
        const db = await getDb();
        const result = await acp.getContextMessages(db, contextId, { limit });
        if ("error" in result) {
          return { content: [{ type: "text", text: `Failed: ${result.error}` }], isError: true };
        }
        if (!result.messages || result.messages.length === 0) {
          return { content: [{ type: "text", text: `No messages found in context '${contextId}'.` }] };
        }
        return {
          content: [{
            type: "text",
            text: `Retrieved ${result.messages.length} message(s) from context '${contextId}':\n\n${result.messages.map((msg: any, idx: number) =>
              `--- Message ${idx + 1} ---\nID: ${msg.id}\nFrom: ${msg.agentId}\nTime: ${msg.createdAt}\nContent: ${msg.content.substring(0, 150)}${msg.content.length > 150 ? "..." : ""}`,
            ).join("\n\n")}`,
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed: ${error.message}` }], isError: true };
      }
    },
  );

  return server;
}

// ─── Transport Handlers ─────────────────────────────────────────────────

export async function handleStreamableHTTP(c: Context) {
  // Get the lazy getDb function from locals (or fall back to c.get for compatibility)
  const getDb: (() => Promise<DbClient>) = (c as any).locals?.getDb || (async () => (c as any).get("db") as DbClient);
  
  const req = c.req.raw;
  const sessionId = req.headers.get("mcp-session-id");

  let transport: WebStandardStreamableHTTPServerTransport;
  let server: McpServer;

  if (sessionId && streamableTransports.has(sessionId)) {
    transport = streamableTransports.get(sessionId)!;
    server = sessionServers.get(sessionId)!;
  } else if (!sessionId && req.method === "POST") {
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => {
        streamableTransports.set(sid, transport);
        sessionServers.set(sid, server);
      },
      onsessionclosed: (sid) => {
        streamableTransports.delete(sid);
        sessionServers.delete(sid);
      },
    });
    server = createMcpServer(getDb);
    await server.connect(transport);
  } else {
    return c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request" }, id: null }, 400);
  }

  const response = await transport.handleRequest(req);
  return new Response(response.body, { status: response.status, headers: response.headers });
}

export async function handleSSE(c: Context) {
  return handleStreamableHTTP(c);
}
