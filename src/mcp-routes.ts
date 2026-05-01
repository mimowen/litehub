// src/mcp-routes.ts — MCP routes (Node.js only, not Edge Runtime compatible)
import type { Hono } from "hono";
import type { LiteHubEnv } from "./types.js";
import { MCP_TOOLS } from "./mcp/tools.js";
import { handleStreamableHTTP, handleSSE } from "./mcp-handler.js";

export function mountMCPRoutes(app: Hono<LiteHubEnv>) {

  app.get("/api/mcp", (c) => {
    const baseUrl = new URL(c.req.url).origin;
    const config = {
      mcpServers: {
        litehub: {
          url: `${baseUrl}/api/mcp/sse`,
          transport: "sse",
          description: "LiteHub — 轻量级 Agent 协作管道 (支持 SSE 和 Streamable HTTP)",
        },
      },
      tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description })),
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
        a2aTaskUpdate: "POST /api/a2a/tasks/update",
        a2aPushNotification: "POST /api/a2a/tasks/pushNotificationConfig/set",
        acpRuns: "GET /api/acp/runs",
        acpRunCreate: "POST /api/acp/runs",
        acpContexts: "GET /api/acp/contexts",
        acpContextCreate: "POST /api/acp/contexts",
        mcpSSE: "GET|POST /api/mcp/sse",
      },
      auth: {
        type: "bearer",
        description: "设置环境变量 LITEHUB_TOKEN 后，请求需携带 Authorization: Bearer <token>",
      },
      transports: {
        sse: "Server-Sent Events (传统方式，适合短连接)",
        streamableHttp: "Streamable HTTP (推荐，更高效，Vercel 官方推荐)",
      },
    };
    c.header("Content-Type", "application/json");
    c.header("Content-Disposition", 'attachment; filename="litehub-mcp.json"');
    return c.json(config);
  });

  app.get("/mcp", (c) => handleSSE(c));
  app.post("/mcp", (c) => handleStreamableHTTP(c));
  app.delete("/mcp", (c) => handleStreamableHTTP(c));
  app.all("/api/mcp/sse", (c) => {
    if (c.req.method === "GET") return handleSSE(c);
    return handleStreamableHTTP(c);
  });
}
