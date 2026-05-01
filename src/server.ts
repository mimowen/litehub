// src/server.ts — Node.js / Bun 启动入口
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import baseApp from "./index.js";
import { getDbClient } from "./adapters/db/sqlite.js";
import type { LiteHubEnv } from "./types.js";
import { mountMCPRoutes } from "./mcp-routes.js";

// 创建包装 App，在最前面注入 DbClient
const db = getDbClient();
const app = new Hono<LiteHubEnv>();
app.use("*", async (c, next) => {
  c.set("db", db);
  await next();
});
app.route("/", baseApp);

// Mount MCP routes (Node.js only — uses @modelcontextprotocol/sdk)
mountMCPRoutes(app);

const port = Number(process.env.PORT) || 3000;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`LiteHub running on http://localhost:${info.port}`);
});
