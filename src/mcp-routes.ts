// src/mcp-routes.ts — MCP routes (Node.js only, not Edge Runtime compatible)
import type { Hono } from "hono";
import type { LiteHubEnv } from "./types.js";
import { handleStreamableHTTP, handleSSE } from "./mcp-handler.js";
import { getBaseUrl, buildMcpDiscoveryConfig } from "./utils.js";

export function mountMCPRoutes(app: Hono<LiteHubEnv>) {

  app.get("/api/mcp", (c) => {
    const baseUrl = getBaseUrl(c);
    const config = buildMcpDiscoveryConfig(baseUrl);
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
