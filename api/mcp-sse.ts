// api/mcp-sse.ts - MCP SSE endpoint using Node.js Runtime
export const config = { runtime: 'nodejs' };

import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import baseApp from '../src/index.js';
import { getDbClient } from '../src/adapters/db/turso.js';
import type { LiteHubEnv } from '../src/types.js';
import { mountMCPRoutes } from '../src/mcp-routes.js';

const app = new Hono<LiteHubEnv>();

// Inject db client
app.use('*', async (c, next) => {
  const db = await getDbClient();
  c.set('db', db);
  await next();
});

// Mount base app routes
app.route('/', baseApp);

// Mount MCP routes with Node.js runtime
mountMCPRoutes(app);

export default handle(app);
