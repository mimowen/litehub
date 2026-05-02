// api/mcp-sse.ts - MCP SSE endpoint using Node.js Runtime
export const config = { runtime: 'nodejs' };

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { handle } from 'hono/vercel';
import { getDbClient } from '../src/adapters/db/turso.js';
import type { LiteHubEnv } from '../src/types.js';
import { handleStreamableHTTP, handleSSE } from '../src/mcp-handler.js';
import { getBaseUrl, buildMcpDiscoveryConfig } from '../src/utils.js';

const app = new Hono<LiteHubEnv>();

// Middleware
app.use('*', logger());
app.use('*', cors({ origin: process.env.LITEHUB_CORS_ORIGIN || '*' }));

// Inject db client
app.use('*', async (c, next) => {
  const db = await getDbClient();
  c.set('db', db);
  await next();
});

// MCP Discovery
app.get('/api/mcp', (c) => {
  const baseUrl = getBaseUrl(c);
  const config = buildMcpDiscoveryConfig(baseUrl);
  c.header('Content-Type', 'application/json');
  c.header('Content-Disposition', 'attachment; filename="litehub-mcp.json"');
  return c.json(config);
});

// MCP Endpoints
app.get('/mcp', (c) => handleSSE(c));
app.post('/mcp', (c) => handleStreamableHTTP(c));
app.delete('/mcp', (c) => handleStreamableHTTP(c));
app.all('/api/mcp/sse', (c) => {
  if (c.req.method === 'GET') return handleSSE(c);
  return handleStreamableHTTP(c);
});

export default handle(app);
