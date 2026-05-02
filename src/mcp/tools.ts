// src/mcp/tools.ts — MCP tool definitions (pure metadata, no logic)
// MUST be kept in sync with mcp-handler.ts tool registrations

export const MCP_TOOLS = [
  {
    name: "litehub_register",
    description: "Register an AI agent to the LiteHub collaboration system with specified role and queue subscriptions",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Unique identifier for the agent" },
        name: { type: "string", description: "Human-readable name of the agent" },
        role: { type: "string", description: "Agent role: producer, consumer, or both", enum: ["producer", "consumer", "both"] },
        queues: { type: "array", items: { type: "string" }, description: "List of queue names this agent subscribes to" },
        pollInterval: { type: "number", description: "Polling interval in milliseconds (default: 5000)" }
      },
      required: ["agentId", "name", "role"]
    }
  },
  {
    name: "litehub_produce",
    description: "Produce data to a named queue in LiteHub. Other agents can consume this data.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "ID of the producing agent" },
        queue: { type: "string", description: "Target queue name" },
        data: { type: "string", description: "Data to produce (string content)" },
        contentType: { type: "string", description: "Content type (e.g., 'text/plain', 'application/json')" },
        metadata: { type: "object", description: "Optional metadata attached to the message" }
      },
      required: ["agentId", "queue", "data"]
    }
  },
  {
    name: "litehub_consume",
    description: "Consume data from a queue (FIFO). Returns the next available item(s).",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "ID of the consuming agent" },
        queue: { type: "string", description: "Source queue name" },
        maxItems: { type: "number", description: "Maximum number of items to consume (default: 1)" },
        loopDetection: { type: "boolean", description: "Enable loop detection to prevent infinite cycles (default: true)" }
      },
      required: ["agentId", "queue"]
    }
  },
  {
    name: "litehub_peek",
    description: "Preview the next item in a queue without consuming it.",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name to peek" }
      },
      required: ["queue"]
    }
  },
  {
    name: "litehub_pipe",
    description: "Consume from source queue and produce to target queue. Automatically carries source lineage in metadata.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "ID of the processing agent" },
        sourceQueue: { type: "string", description: "Source queue to consume from" },
        targetQueue: { type: "string", description: "Target queue to produce to" },
        data: { type: "string", description: "Transformed data to produce to target queue" },
        contentType: { type: "string", description: "Content type of the output data" },
        metadata: { type: "object", description: "Additional metadata for the output" }
      },
      required: ["agentId", "sourceQueue", "targetQueue", "data"]
    }
  },
  {
    name: "litehub_pool_create",
    description: "Create a new collaboration pool (group chat space) for multiple agents to interact",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique pool name" },
        description: { type: "string", description: "Pool description" },
        guidelines: { type: "string", description: "Collaboration guidelines for pool members" },
        maxMembers: { type: "number", description: "Maximum number of members (default: 50)" }
      },
      required: ["name"]
    }
  },
  {
    name: "litehub_pool_join",
    description: "Join an existing collaboration pool as an agent member",
    inputSchema: {
      type: "object",
      properties: {
        pool: { type: "string", description: "Pool name to join" },
        agentId: { type: "string", description: "Agent ID joining the pool" }
      },
      required: ["pool", "agentId"]
    }
  },
  {
    name: "litehub_pool_leave",
    description: "Leave a collaboration pool",
    inputSchema: {
      type: "object",
      properties: {
        pool: { type: "string", description: "Pool name to leave" },
        agentId: { type: "string", description: "Agent ID leaving the pool" }
      },
      required: ["pool", "agentId"]
    }
  },
  {
    name: "litehub_pool_speak",
    description: "Send a message to a collaboration pool. Supports threading via replyTo and tagging via tags.",
    inputSchema: {
      type: "object",
      properties: {
        pool: { type: "string", description: "Pool name to send message to" },
        agentId: { type: "string", description: "Agent ID sending the message" },
        content: { type: "string", description: "Message content" },
        replyTo: { type: "string", description: "Message ID to reply to (for threading)" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorizing the message" },
        metadata: { type: "object", description: "Additional metadata" }
      },
      required: ["pool", "agentId", "content"]
    }
  },
  {
    name: "litehub_pool_read",
    description: "Read messages from a collaboration pool. Supports filtering by time, tags, and limit.",
    inputSchema: {
      type: "object",
      properties: {
        pool: { type: "string", description: "Pool name to read messages from" },
        since: { type: "string", description: "ISO timestamp to filter messages after this time" },
        tag: { type: "string", description: "Filter messages by tag" },
        limit: { type: "number", description: "Maximum number of messages to retrieve (default: 50)" }
      },
      required: ["pool"]
    }
  },
  {
    name: "litehub_agents",
    description: "List all registered agents in the system",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "litehub_queues",
    description: "List all queues with their statistics (pending/consumed counts)",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "litehub_pools",
    description: "List all collaboration pools with member counts",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "litehub_my_resources",
    description: "List resources (queues, pools) created by a specific agent",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent ID to filter resources by" }
      },
      required: ["agentId"]
    }
  },
  // ── A2A Protocol ──
  {
    name: "a2a_create_task",
    description: "Create an A2A (Agent-to-Agent) task mapped to a LiteHub queue",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent creating the task" },
        targetAgentId: { type: "string", description: "Target agent ID" },
        name: { type: "string", description: "Task name" },
        input: { description: "Task input data" }
      },
      required: ["agentId"]
    }
  },
  {
    name: "a2a_get_task",
    description: "Get details of an A2A task",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID" }
      },
      required: ["taskId"]
    }
  },
  {
    name: "a2a_list_tasks",
    description: "List A2A tasks, optionally filtered by agent or status",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Filter by agent ID" },
        status: { type: "string", description: "Filter by status" }
      }
    }
  },
  {
    name: "a2a_cancel_task",
    description: "Cancel an A2A task",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID to cancel" },
        agentId: { type: "string", description: "Agent requesting cancellation" }
      },
      required: ["taskId", "agentId"]
    }
  },
  {
    name: "a2a_update_task",
    description: "Update an A2A task status (running/completed/failed)",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID to update" },
        agentId: { type: "string", description: "Agent requesting the update" },
        status: { type: "string", description: "New status", enum: ["running", "completed", "failed"] }
      },
      required: ["taskId", "agentId", "status"]
    }
  },
  {
    name: "a2a_set_push_notification",
    description: "Configure push notification (webhook) for an A2A task",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent ID" },
        webhookUrl: { type: "string", description: "Webhook URL for notifications" },
        taskId: { type: "string", description: "Task ID to subscribe to" },
        secret: { type: "string", description: "Secret for webhook verification" }
      },
      required: ["agentId", "webhookUrl"]
    }
  },
  {
    name: "a2a_get_push_notification",
    description: "Get push notification subscriptions for an agent",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent ID" }
      },
      required: ["agentId"]
    }
  },
  {
    name: "a2a_send_message",
    description: "Send a message to an existing A2A task. This is the core messaging function for agent-to-agent communication.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID to send message to" },
        agentId: { type: "string", description: "Sender agent ID" },
        message: { description: "Message content to send (any JSON-serializable data)" },
        messageId: { type: "string", description: "Optional message ID for idempotency" },
        metadata: { type: "object", description: "Optional metadata attached to the message" }
      },
      required: ["taskId", "agentId", "message"]
    }
  },
  {
    name: "a2a_subscribe_task",
    description: "Get the SSE subscription URL for real-time task updates. Returns the URL to connect to for receiving messages and status changes.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID to subscribe to" }
      },
      required: ["taskId"]
    }
  },
  // ── ACP Protocol ──
  {
    name: "acp_create_run",
    description: "Create an ACP (Agent Communication Protocol) run mapped to a LiteHub pool",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent creating the run" },
        name: { type: "string", description: "Run name" },
        guidelines: { type: "string", description: "Collaboration guidelines" }
      },
      required: ["agentId"]
    }
  },
  {
    name: "acp_get_run",
    description: "Get details of an ACP run",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run ID" }
      },
      required: ["runId"]
    }
  },
  {
    name: "acp_list_runs",
    description: "List ACP runs, optionally filtered by agent",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Filter by agent ID" }
      }
    }
  },
  {
    name: "acp_cancel_run",
    description: "Cancel an ACP run",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run ID to cancel" },
        agentId: { type: "string", description: "Agent requesting cancellation" }
      },
      required: ["runId", "agentId"]
    }
  },
  {
    name: "acp_create_context",
    description: "Create an ACP context (collaboration space) mapped to a LiteHub pool",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent creating the context" },
        name: { type: "string", description: "Context name" },
        guidelines: { type: "string", description: "Collaboration guidelines" }
      },
      required: ["agentId"]
    }
  },
  {
    name: "acp_get_context",
    description: "Get details of an ACP context",
    inputSchema: {
      type: "object",
      properties: {
        contextId: { type: "string", description: "Context ID" }
      },
      required: ["contextId"]
    }
  },
  {
    name: "acp_join_context",
    description: "Join an ACP context",
    inputSchema: {
      type: "object",
      properties: {
        contextId: { type: "string", description: "Context ID to join" },
        agentId: { type: "string", description: "Agent ID joining" }
      },
      required: ["contextId", "agentId"]
    }
  },
  {
    name: "acp_leave_context",
    description: "Leave an ACP context",
    inputSchema: {
      type: "object",
      properties: {
        contextId: { type: "string", description: "Context ID to leave" },
        agentId: { type: "string", description: "Agent ID leaving" }
      },
      required: ["contextId", "agentId"]
    }
  },
  {
    name: "acp_speak_context",
    description: "Send a message in an ACP context",
    inputSchema: {
      type: "object",
      properties: {
        contextId: { type: "string", description: "Context ID" },
        agentId: { type: "string", description: "Agent ID sending the message" },
        content: { type: "string", description: "Message content" },
        replyTo: { type: "string", description: "Message ID to reply to" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for the message" }
      },
      required: ["contextId", "agentId", "content"]
    }
  },
  {
    name: "acp_list_contexts",
    description: "List ACP contexts (collaboration spaces)",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum number of contexts to return" }
      }
    }
  },
  {
    name: "acp_get_context_messages",
    description: "Read messages from an ACP context",
    inputSchema: {
      type: "object",
      properties: {
        contextId: { type: "string", description: "Context ID to read messages from" },
        limit: { type: "number", description: "Maximum number of messages to retrieve" }
      },
      required: ["contextId"]
    }
  }
];
