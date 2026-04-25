import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import type { Context } from "hono";
import {
  registerAgent, listAgents, listQueues,
  produce, consume, peek, pipe,
} from "./queue.js";
import {
  createPool, getPool, listPools,
  joinPool, leavePool, listMembers,
  speak, getMessages,
} from "./pool.js";

/**
 * LiteHub MCP Server with Full Protocol Support
 * 
 * Supports both Streamable HTTP (recommended) and SSE transports
 * Compatible with Vercel Serverless/Edge Functions via Web Standard APIs
 */

// Store active transports for session management
const streamableTransports = new Map<string, WebStandardStreamableHTTPServerTransport>();
const sseTransports = new Map<string, SSEServerTransport>();

// Store active servers for each session
const sessionServers = new Map<string, McpServer>();

export function getMcpServer() {
  // Return a cached server or create a new one
  if (!sessionServers.has("default")) {
    sessionServers.set("default", createMcpServer());
  }
  return sessionServers.get("default")!;
}

export function createMcpServer() {
  const server = new McpServer(
    {
      name: "LiteHub",
      version: "2.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // ─── Agent Tools ──────────────────────────────────────────────────────

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
        const agent = registerAgent({ agentId, name, role, queues, pollInterval });
        return {
          content: [
            {
              type: "text",
              text: `✅ Agent registered successfully:\n${JSON.stringify(agent, null, 2)}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to register agent: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
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
    async ({ agentId, queue, data, contentType, metadata }) => {
      try {
        const pointer = produce(queue, String(data), agentId, { contentType, metadata });
        return {
          content: [
            {
              type: "text",
              text: `✅ Data produced to queue '${queue}':\nPointer ID: ${pointer.id}\nQueue: ${pointer.queue}\nCreated: ${pointer.createdAt}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to produce data: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "litehub_consume",
    "Consume data from a queue (FIFO). Returns the next available item(s) without removing them from history.",
    {
      agentId: z.string().describe("ID of the consuming agent"),
      queue: z.string().describe("Source queue name"),
      maxItems: z.number().optional().describe("Maximum number of items to consume (default: 1)"),
      loopDetection: z.boolean().optional().describe("Enable loop detection to prevent infinite cycles (default: true)"),
    },
    async ({ agentId, queue, maxItems, loopDetection }) => {
      try {
        const items = consume(queue, agentId, maxItems || 1, { loopDetection: loopDetection !== false });
        
        if (!items || items.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `ℹ️ Queue '${queue}' is empty. No data to consume.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `✅ Consumed ${items.length} item(s) from queue '${queue}':\n\n${items.map((item: any, idx: number) => 
                `--- Item ${idx + 1} ---\nData: ${item.data}\nProducer: ${item.producerId}\nCreated: ${item.createdAt}\nPointer ID: ${item.pointerId}`
              ).join("\n\n")}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to consume data: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "litehub_peek",
    "Preview the next item in a queue without consuming it. Useful for checking queue status.",
    {
      queue: z.string().describe("Queue name to peek"),
    },
    async ({ queue }) => {
      try {
        const pointer = peek(queue);
        
        if (!pointer) {
          return {
            content: [
              {
                type: "text",
                text: `ℹ️ Queue '${queue}' is empty or does not exist.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `👀 Peek at queue '${queue}':\nPointer ID: ${pointer.id}\nProducer: ${pointer.producerId}\nCreated: ${pointer.createdAt}\nSize: ${pointer.size} bytes`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to peek queue: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "litehub_pipe",
    "Atomic consume + produce operation. Consume from source queue and produce to target queue in one step. Automatically carries source lineage in metadata.",
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
        const result = pipe(sourceQueue, targetQueue, agentId, String(data), { contentType, metadata });
        
        if (!result) {
          return {
            content: [
              {
                type: "text",
                text: `ℹ️ Source queue '${sourceQueue}' is empty. Nothing to pipe.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `✅ Piped data from '${sourceQueue}' → '${targetQueue}':\n\nInput Pointer: ${result.input.id}\nOutput Pointer: ${result.output.id}\nLineage: sourceQueue=${result.input.queue}, sourcePointer=${result.input.id}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to pipe data: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── Pool Tools ───────────────────────────────────────────────────────

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
        const pool = createPool(name, description, guidelines, maxMembers);
        return {
          content: [
            {
              type: "text",
              text: `✅ Pool created successfully:\nName: ${pool.name}\nDescription: ${pool.description || "N/A"}\nMax Members: ${pool.maxMembers}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to create pool: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "litehub_pool_join",
    "Join an existing collaboration pool as an agent member",
    {
      pool: z.string().describe("Pool name to join"),
      agentId: z.string().describe("Agent ID joining the pool"),
    },
    async ({ pool, agentId }) => {
      try {
        const result = joinPool(pool, agentId);
        
        if (!result.ok) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Failed to join pool: ${result.error}`,
              },
            ],
            isError: true,
          };
        }

        const poolInfo = getPool(pool);
        const memberCount = poolInfo ? poolInfo.memberCount : 0;
        const maxMembers = poolInfo ? poolInfo.maxMembers : 0;

        return {
          content: [
            {
              type: "text",
              text: `✅ Agent '${agentId}' joined pool '${pool}'\nCurrent members: ${memberCount}/${maxMembers}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to join pool: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
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
    async ({ pool, agentId, content, replyTo, tags, metadata }) => {
      try {
        const msg = speak(pool, agentId, content, { replyTo, tags, metadata });
        return {
          content: [
            {
              type: "text",
              text: `✅ Message sent to pool '${pool}':\nMessage ID: ${msg.id}\nFrom: ${msg.agentId}\nCreated: ${msg.createdAt}\nContent: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? "..." : ""}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to send message: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
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
    async ({ pool, since, tag, limit }) => {
      try {
        const result = getMessages(pool, { since, tag, limit });
        
        if (!result.messages || result.messages.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `ℹ️ No messages found in pool '${pool}'.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `📨 Retrieved ${result.messages.length} message(s) from pool '${pool}':\n\n${result.messages.map((msg: any, idx: number) => 
                `--- Message ${idx + 1} ---\nID: ${msg.id}\nFrom: ${msg.agentId}\nTime: ${msg.createdAt}\nContent: ${msg.content.substring(0, 150)}${msg.content.length > 150 ? "..." : ""}`
              ).join("\n\n")}${result.guidelines ? `\n\n📋 Pool Guidelines:\n${result.guidelines}` : ""}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to read messages: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── Query Tools ──────────────────────────────────────────────────────

  server.tool(
    "litehub_agents",
    "List all registered agents in the system",
    {},
    async () => {
      try {
        const agents = listAgents();
        return {
          content: [
            {
              type: "text",
              text: `📋 Registered Agents (${agents.length}):\n\n${agents.map((a: any) => `- ${a.name} (${a.agentId})\n  Role: ${a.role}\n  Queues: ${a.queues.join(", ")}`).join("\n")}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to list agents: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "litehub_queues",
    "List all queues with their statistics (pending/consumed counts)",
    {},
    async () => {
      try {
        const queues = listQueues();
        return {
          content: [
            {
              type: "text",
              text: `📊 Queues (${queues.length}):\n\n${queues.map((q: any) => `- ${q.name}\n  Pending: ${q.pending}\n  Consumed: ${q.consumed}\n  Created: ${q.createdAt}`).join("\n")}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to list queues: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "litehub_pools",
    "List all collaboration pools with member counts",
    {},
    async () => {
      try {
        const pools = listPools();
        return {
          content: [
            {
              type: "text",
              text: `👥 Collaboration Pools (${pools.length}):\n\n${pools.map((p: any) => `- ${p.name}\n  Members: ${p.memberCount}/${p.maxMembers}\n  Description: ${p.description || "N/A"}`).join("\n")}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to list pools: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}

/**
 * Handle Streamable HTTP requests using Web Standard APIs
 * RECOMMENDED for production - works perfectly with Vercel Serverless/Edge
 */
export async function handleStreamableHTTP(c: Context) {
  const req = c.req.raw;
  const sessionId = req.headers.get("mcp-session-id");
  
  let transport: WebStandardStreamableHTTPServerTransport;
  let server: McpServer;
  
  if (sessionId && streamableTransports.has(sessionId)) {
    // Reuse existing transport and server for this session
    transport = streamableTransports.get(sessionId)!;
    server = sessionServers.get(sessionId)!;
  } else if (!sessionId && req.method === "POST") {
    // New session initialization
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => {
        streamableTransports.set(sid, transport);
        sessionServers.set(sid, server);
        console.log(`[MCP] New Streamable HTTP session: ${sid}`);
      },
      onsessionclosed: (sid) => {
        streamableTransports.delete(sid);
        sessionServers.delete(sid);
        console.log(`[MCP] Streamable HTTP session closed: ${sid}`);
      },
    });
    
    // Create a new MCP server instance for this session
    server = createMcpServer();
    
    // Connect the server to the transport
    await server.connect(transport);
  } else {
    // Invalid request
    return c.json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: null,
    }, 400);
  }
  
  // Handle the request through the transport
  const response = await transport.handleRequest(req);
  
  // Return the Web Standard Response
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

/**
 * Handle SSE connection (GET request)
 * Returns proper MCP initialization message via SSE stream
 */
export async function handleSSE(c: Context) {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      
      const sendMessage = (data: any) => {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };
      
      // Send MCP initialization message (standard format)
      sendMessage({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: { listChanged: true },
            resources: {},
          },
          serverInfo: {
            name: "LiteHub",
            version: "2.0.0",
          },
        },
      });
      
      // Keep connection alive with periodic heartbeat
      const interval = setInterval(() => {
        // SSE comment to keep connection alive
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15000);
      
      // Clean up on client disconnect
      c.req.raw.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });
  
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
