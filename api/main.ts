// api/main.ts — LiteHub Vercel Edge Runtime entry point
export const config = { 
  runtime: 'edge',
};

import { Hono } from "hono";
import { handle } from "hono/vercel";
import baseApp from "../src/index.js";
import { getDbClient } from "../src/adapters/db/turso.js";
import type { LiteHubEnv } from "../src/types.js";

const app = new Hono<LiteHubEnv>();

app.get("/health", (c) => c.json({ ok: true, timestamp: Date.now() }));

app.use("*", async (c, next) => {
  try {
    const db = await getDbClient();
    c.set("db", db);
    await next();
  } catch (error) {
    console.error("Database connection error:", error);
    return c.json({ 
      ok: false, 
      error: "Database connection failed. Please check TURSO_URL and TURSO_AUTH_TOKEN environment variables." 
    }, 500);
  }
});

app.route("/", baseApp);

export default handle(app);
