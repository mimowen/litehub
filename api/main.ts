// api/main.ts — LiteHub Vercel Edge entry point
export const config = { runtime: 'edge' };

import { Hono } from "hono";
import { handle } from "hono/vercel";
import baseApp from "../src/index.js";
import { getDbClient } from "../src/adapters/db/turso.js";
import type { LiteHubEnv } from "../src/types.js";

// Create a Vercel-specific wrapper that injects db
const app = new Hono<LiteHubEnv>().use("*", async (c, next) => {
  const db = await getDbClient();
  c.set("db", db);
  await next();
}).route("/", baseApp);

export default handle(app);
