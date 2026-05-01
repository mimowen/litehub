// src/mcp/tools.ts — MCP tool definitions (pure metadata, no logic)

export const MCP_TOOLS = [
  {
    name: "litehub_register",
    description: "注册一个新的 Agent 到 LiteHub，可同时创建队列和 Pool",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent 的唯一标识符" },
        name: { type: "string", description: "Agent 的显示名称" },
        role: { type: "string", description: "Agent 的角色: producer, consumer, 或 both" },
        queues: {
          type: "array", description: "Agent 关联的队列列表",
          items: {
            oneOf: [
              { type: "string" },
              { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name"] }
            ]
          }
        },
        pools: {
          type: "array", description: "Agent 创建的 Pool 列表",
          items: {
            type: "object",
            properties: { name: { type: "string" }, description: { type: "string" }, guidelines: { type: "string" }, maxMembers: { type: "number" } },
            required: ["name", "description"]
          }
        },
        pollInterval: { type: "number" }
      },
      required: ["agentId", "name", "role"]
    }
  },
  {
    name: "litehub_produce",
    description: "向指定队列生产数据",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string" }, agentId: { type: "string" }, data: {},
        contentType: { type: "string" }, metadata: { type: "object" },
        lineage: { type: "array", items: { type: "string" } }
      },
      required: ["queue", "agentId", "data"]
    }
  },
  {
    name: "litehub_consume",
    description: "从指定队列消费数据（FIFO）",
    inputSchema: {
      type: "object",
      properties: { queue: { type: "string" }, agentId: { type: "string" } },
      required: ["queue", "agentId"]
    }
  },
  {
    name: "litehub_peek",
    description: "预览队列中的数据（不消费）",
    inputSchema: {
      type: "object",
      properties: { queue: { type: "string" }, limit: { type: "number", description: "默认 10" } },
      required: ["queue"]
    }
  },
  {
    name: "litehub_pipe",
    description: "将数据从一个队列管道传输到另一个队列",
    inputSchema: {
      type: "object",
      properties: { pointerId: { type: "string" }, targetQueue: { type: "string" }, agentId: { type: "string" } },
      required: ["pointerId", "targetQueue"]
    }
  },
  {
    name: "litehub_pool_create",
    description: "创建一个新的 Pool（协作池）",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" }, description: { type: "string" }, guidelines: { type: "string" },
        maxMembers: { type: "number" }, agentId: { type: "string" }
      },
      required: ["name", "description", "agentId"]
    }
  },
  {
    name: "litehub_pool_join",
    description: "加入一个 Pool",
    inputSchema: {
      type: "object",
      properties: { pool: { type: "string" }, agentId: { type: "string" } },
      required: ["pool", "agentId"]
    }
  },
  {
    name: "litehub_pool_leave",
    description: "离开一个 Pool",
    inputSchema: {
      type: "object",
      properties: { pool: { type: "string" }, agentId: { type: "string" } },
      required: ["pool", "agentId"]
    }
  },
  {
    name: "litehub_pool_speak",
    description: "在 Pool 中发送消息",
    inputSchema: {
      type: "object",
      properties: {
        pool: { type: "string" }, agentId: { type: "string" }, content: { type: "string" },
        replyTo: { type: "string" }, tags: { type: "array", items: { type: "string" } },
        metadata: { type: "object" }
      },
      required: ["pool", "agentId", "content"]
    }
  },
  {
    name: "litehub_pool_messages",
    description: "获取 Pool 中的消息列表",
    inputSchema: {
      type: "object",
      properties: { pool: { type: "string" }, limit: { type: "number" }, since: { type: "string" }, tag: { type: "string" } },
      required: ["pool"]
    }
  },
  {
    name: "litehub_agents", description: "获取所有注册的 Agent 列表",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "litehub_queues", description: "获取所有队列及其统计信息",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "litehub_pools", description: "获取所有 Pool 列表",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "litehub_my_resources",
    description: "查询当前 Agent 创建的所有队列和 Pool",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string" } },
      required: ["agentId"]
    }
  },
  // ── A2A Protocol ──
  {
    name: "a2a_create_task",
    description: "创建一个 A2A Task",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" }, targetAgentId: { type: "string" }, taskId: { type: "string" },
        name: { type: "string" }, input: {}, messageId: { type: "string" }, metadata: { type: "object" }
      },
      required: ["agentId"]
    }
  },
  {
    name: "a2a_get_task",
    description: "查询 A2A Task 详情",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"]
    }
  },
  {
    name: "a2a_cancel_task",
    description: "取消一个 A2A Task",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" }, agentId: { type: "string" } },
      required: ["taskId", "agentId"]
    }
  },
  {
    name: "a2a_update_task",
    description: "更新 A2A Task 状态（running/completed/failed）",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" }, agentId: { type: "string" }, status: { type: "string", description: "新状态: running, completed, failed" } },
      required: ["taskId", "agentId", "status"]
    }
  },
  {
    name: "a2a_list_tasks",
    description: "列出所有 A2A Task",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string" }, status: { type: "string" }, limit: { type: "number" } }
    }
  },
  {
    name: "a2a_set_push_notification",
    description: "配置 Task 的 Webhook 推送通知",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string" }, webhookUrl: { type: "string" }, secret: { type: "string" } },
      required: ["agentId", "webhookUrl"]
    }
  },
  {
    name: "a2a_get_push_notification",
    description: "查询已配置的 Webhook 推送订阅",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string" } },
      required: ["agentId"]
    }
  },
  // ── ACP Protocol ──
  {
    name: "acp_create_run",
    description: "创建一个 ACP Run（协作会话）",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" }, runId: { type: "string" }, name: { type: "string" },
        guidelines: { type: "string" }, maxMembers: { type: "number" }
      },
      required: ["agentId"]
    }
  },
  {
    name: "acp_get_run",
    description: "查询 ACP Run 详情",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" } },
      required: ["runId"]
    }
  },
  {
    name: "acp_cancel_run",
    description: "取消一个 ACP Run",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" }, agentId: { type: "string" } },
      required: ["runId", "agentId"]
    }
  },
  {
    name: "acp_list_runs",
    description: "列出所有 ACP Run",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string" }, limit: { type: "number" } }
    }
  },
  {
    name: "acp_create_context",
    description: "创建一个 ACP Context",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" }, contextId: { type: "string" }, name: { type: "string" }, guidelines: { type: "string" }
      },
      required: ["agentId"]
    }
  },
  {
    name: "acp_get_context",
    description: "查询 ACP Context 详情",
    inputSchema: {
      type: "object",
      properties: { contextId: { type: "string" } },
      required: ["contextId"]
    }
  },
  {
    name: "acp_join_context",
    description: "加入一个 ACP Context",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string" }, contextId: { type: "string" } },
      required: ["agentId", "contextId"]
    }
  },
  {
    name: "acp_leave_context",
    description: "离开一个 ACP Context",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string" }, contextId: { type: "string" } },
      required: ["agentId", "contextId"]
    }
  },
  {
    name: "acp_speak_context",
    description: "在 ACP Context 中发送消息",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" }, contextId: { type: "string" }, content: { type: "string" },
        replyTo: { type: "string" }, tags: { type: "array", items: { type: "string" } }, metadata: { type: "object" }
      },
      required: ["agentId", "contextId", "content"]
    }
  },
  {
    name: "acp_list_contexts",
    description: "列出所有 ACP Context",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } }
    }
  },
  {
    name: "acp_get_context_messages",
    description: "读取 ACP Context 中的消息",
    inputSchema: {
      type: "object",
      properties: { contextId: { type: "string" }, limit: { type: "number" } },
      required: ["contextId"]
    }
  }
];
