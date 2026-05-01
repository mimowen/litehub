// src/adapters/cf-workers.ts — Cloudflare Workers entry point
/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono";
import baseApp from "../index.js";
import { getDbClient } from "../adapters/db/d1.js";
import type { LiteHubEnv } from "../types.js";

type Bindings = { DB: D1Database };
const app = new Hono<{ Bindings: Bindings } & LiteHubEnv>();

// Inject D1-based DbClient into each request
app.use("*", async (c, next) => {
  const db = await getDbClient({ d1: c.env.DB });
  c.set("db", db);
  await next();
});

app.route("/", baseApp);

export default app;
