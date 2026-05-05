// src/utils.ts — Shared utility functions
import type { Context } from "hono";
import { MCP_TOOLS } from "./mcp/tools.js";

export function getBaseUrl(c: Context): string {
  const host = c.req.header("host") || "localhost:3000";
  const proto = c.req.header("x-forwarded-proto") || "http";
  return `${proto}://${host}`;
}

export function buildMcpDiscoveryConfig(baseUrl: string) {
  return {
    mcpServers: {
      litehub: {
        url: `${baseUrl}/mcp`,
        transport: "streamableHttp",
        description: "LiteHub — 轻量级 Agent 协作管道",
      },
    },
    tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
    endpoints: {
      register: "POST /api/agent/register",
      produce: "POST /api/agent/produce",
      consume: "POST /api/agent/consume",
      pipe: "POST /api/agent/pipe",
      peek: "GET /api/peek?queue=",
      poolCreate: "POST /api/pool/create",
      poolJoin: "POST /api/pool/join",
      poolSpeak: "POST /api/pool/speak",
      poolMessages: "GET /api/pool/messages",
      agents: "GET /api/agents",
      queues: "GET /api/queues",
      pools: "GET /api/pools",
      a2aTasks: "GET /api/a2a/tasks",
      a2aTaskCreate: "POST /api/a2a/tasks",
      a2aTaskSend: "POST /api/a2a/tasks/:id/send",
      a2aTaskSubscribe: "GET /api/a2a/tasks/:id/subscribe (SSE)",
      a2aTaskUpdate: "POST /api/a2a/tasks/update",
      a2aPushNotification: "POST /api/a2a/tasks/pushNotificationConfig/set",
      acpRuns: "GET /api/acp/runs",
      acpRunCreate: "POST /api/acp/runs",
      acpContexts: "GET /api/acp/contexts",
      acpContextCreate: "POST /api/acp/contexts",
      mcp: "GET|POST /mcp",
    },
    auth: {
      type: "bearer",
      description: "设置环境变量 LITEHUB_TOKEN 后，请求需携带 Authorization: Bearer <token>",
    },
    transports: {
      sse: "Server-Sent Events (传统方式)",
      streamableHttp: "Streamable HTTP (推荐，更高效)",
    },
  };
}
