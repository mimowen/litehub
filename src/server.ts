// src/server.ts — Node.js / Bun / Deno 启动入口
// Vercel 和 CF Workers 不用这个文件，它们用自己的适配器
import { serve } from "@hono/node-server";
import app from "./index";

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`⚡ LiteHub running on http://localhost:${info.port}`);
});
