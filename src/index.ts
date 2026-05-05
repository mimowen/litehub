// src/index.ts — Unified Hono app for LiteHub
// Route layer: maps URL → handler, nothing more
// Note: MCP SDK routes are handled separately in api/mcp-sse.ts to reduce bundle size
import { Hono } from "hono";
import { logger } from "hono/logger";
import type { LiteHubEnv } from "./types.js";
import { getBaseUrl } from "./utils.js";
import { authMiddleware } from "./middleware/auth.js";
import { fail, ok, sseHeaders } from "./utils/response.js";
import { wrap } from "./utils/wrap.js";

import * as agentH from "./handlers/agents.js";
import * as queueH from "./handlers/queues.js";
import * as poolH from "./handlers/pools.js";
import * as a2aH from "./handlers/a2a.js";
import * as acpH from "./handlers/acp.js";
import * as webhookH from "./handlers/webhook.js";
import * as pageH from "./handlers/pages.js";
import { handleA2ARequest, handleA2AStream } from "./protocols/a2a.js";

const app = new Hono<LiteHubEnv>();
export default app;

app.use("*", logger());

// Custom CORS middleware for Vercel Node.js Runtime compatibility
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("Access-Control-Allow-Origin", process.env.LITEHUB_CORS_ORIGIN || "*");
  c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  c.res.headers.set("Access-Control-Max-Age", "86400");
});

// Handle OPTIONS requests
app.options("*", (c) => new Response(null, { status: 204 }));

app.use("/api/*", async (c, next) => {
  if (!c.get("db")) return c.json(fail("Database not initialized", 500), 500);
  await next();
});
app.use("/a2a", async (c, next) => {
  if (!c.get("db")) return c.json(fail("Database not initialized", 500), 500);
  await next();
});

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(fail(err.message || "Internal server error", 500), 500);
});

app.use("/api/*", authMiddleware);

// ─── Landing Page ────────────────────────────────────────────────────────

app.get("/", async (c) => c.html(await pageH.getHomeHtml(getBaseUrl(c))));

// ─── Dashboard ───────────────────────────────────────────────────────────

app.get("/dashboard", async (c) => c.html(await pageH.getDashboardHtml(getBaseUrl(c))));
app.get("/login", async (c) => c.html(await pageH.getLoginHtml(getBaseUrl(c))));

// ─── Skill download ──────────────────────────────────────────────────────

app.get("/api/skill", async (c) => {
  const result = await pageH.handleSkillDownload(getBaseUrl(c));
  if (!result) return c.text("Skill file not found", 404);
  c.header("Content-Type", result.contentType);
  c.header("Content-Disposition", 'attachment; filename="litehub.md"');
  return c.body(result.content);
});

app.get("/api/skills", wrap(() => pageH.handleSkillList()));

// ─── MCP Discovery ───────────────────────────────────────────────────────

app.get("/api/mcp", async (c) => {
  const config = await pageH.handleMcpDiscovery(getBaseUrl(c));
  c.header("Content-Type", "application/json");
  c.header("Content-Disposition", 'attachment; filename="litehub-mcp.json"');
  return c.json(config);
});

// Note: MCP SSE endpoints (/mcp, /api/mcp/sse) are handled by api/mcp-sse.ts

// ─── API Root ────────────────────────────────────────────────────────────

app.get("/api", wrap(() => Promise.resolve(ok(pageH.getApiInfo()))));

// ─── Agent Card ──────────────────────────────────────────────────────────

app.get("/.well-known/agent-card.json", wrap((c: any) =>
  Promise.resolve(ok(pageH.getAgentCard(getBaseUrl(c))))));

// ─── Agent routes ────────────────────────────────────────────────────────

app.post("/api/agent/register", wrap(async (c) =>
  agentH.handleRegister(c.get("db"), await c.req.json())));

app.post("/api/agent/produce", wrap(async (c) =>
  queueH.handleProduce(c.get("db"), await c.req.json())));

app.post("/api/agent/consume", wrap(async (c) =>
  queueH.handleConsume(c.get("db"), await c.req.json())));

app.post("/api/agent/pipe", wrap(async (c) =>
  queueH.handlePipe(c.get("db"), await c.req.json())));

// ─── Agent query routes ──────────────────────────────────────────────────

app.get("/api/agents", wrap(async (c) =>
  agentH.handleListAgents(c.get("db"))));

app.get("/api/agents/:id", wrap(async (c) =>
  agentH.handleGetAgent(c.get("db"), c.req.param("id")!)));

app.get("/api/queues", wrap(async (c) =>
  queueH.handleListQueues(c.get("db"))));

app.get("/api/queues/:name", wrap(async (c) =>
  queueH.handleQueueStatus(c.get("db"), c.req.param("name")!)));

app.post("/api/queues/update", wrap(async (c) =>
  queueH.handleQueueUpdate(c.get("db"), await c.req.json())));

app.post("/api/queues/block", wrap(async (c) =>
  queueH.handleQueueBlock(c.get("db"), await c.req.json())));

app.post("/api/queues/unblock", wrap(async (c) =>
  queueH.handleQueueUnblock(c.get("db"), await c.req.json())));

app.post("/api/agent/delete", wrap(async (c) =>
  queueH.handleAgentDelete(c.get("db"), await c.req.json())));

app.get("/api/queues/:name/history", wrap(async (c) => {
  const name = c.req.param("name")!;
  const limit = c.req.query("limit");
  return queueH.handleQueueHistory(c.get("db"), name, {
    status: c.req.query("status"),
    afterId: c.req.query("afterId"),
    limit: limit ? parseInt(limit) : undefined,
  });
}));

app.get("/api/peek", wrap(async (c) =>
  queueH.handlePeek(c.get("db"), c.req.query("queue") || "")));

// ─── Pool routes ─────────────────────────────────────────────────────────

app.post("/api/pool/create", wrap(async (c) =>
  poolH.handlePoolCreate(c.get("db"), await c.req.json())));

app.post("/api/pool/update", wrap(async (c) =>
  poolH.handlePoolUpdate(c.get("db"), await c.req.json())));

app.get("/api/pools", wrap(async (c) =>
  poolH.handleListPools(c.get("db"))));

app.get("/api/pool/members", wrap(async (c) =>
  poolH.handlePoolMembers(c.get("db"), c.req.query("pool") || "")));

app.get("/api/pool/messages", wrap(async (c) => {
  const pool = c.req.query("pool") || "";
  const agentId = c.req.query("agentId");
  const limit = c.req.query("limit");
  return poolH.handlePoolMessages(c.get("db"), pool, agentId, {
    since: c.req.query("since"),
    tag: c.req.query("tag"),
    limit: limit ? parseInt(limit) : undefined,
    afterId: c.req.query("afterId"),
  });
}));

app.get("/api/pool/:name", wrap(async (c) =>
  poolH.handleGetPool(c.get("db"), c.req.param("name")!)));

app.post("/api/pool/join", wrap(async (c) =>
  poolH.handlePoolJoin(c.get("db"), await c.req.json())));

app.post("/api/pool/leave", wrap(async (c) =>
  poolH.handlePoolLeave(c.get("db"), await c.req.json())));

app.post("/api/pools/block", wrap(async (c) =>
  poolH.handlePoolBlock(c.get("db"), await c.req.json())));

app.post("/api/pools/unblock", wrap(async (c) =>
  poolH.handlePoolUnblock(c.get("db"), await c.req.json())));

app.post("/api/pool/speak", wrap(async (c) =>
  poolH.handlePoolSpeak(c.get("db"), await c.req.json())));

// ─── A2A Standard Protocol (JSON-RPC 2.0) ────────────────────────────────

app.post("/a2a", async (c) => {
  const db = c.get("db");
  const body = await c.req.json();
  const agentId = c.req.header("x-agent-id") || "default-agent";
  const result = await handleA2ARequest(db, body, agentId, getBaseUrl(c));
  return c.json(result);
});

app.get("/a2a/stream", async (c) => {
  const taskId = c.req.query("taskId");
  if (!taskId) return c.json(fail("Missing taskId", 400), 400);
  const stream = handleA2AStream(c.get("db"), taskId);
  if (!stream) return c.json(fail("Task not found", 404), 404);
  return new Response(stream, { headers: sseHeaders() });
});

// ─── A2A Legacy API ──────────────────────────────────────────────────────

app.get("/api/a2a/tasks", wrap(async (c) =>
  a2aH.handleA2AListTasks(c.get("db"))));

app.post("/api/a2a/tasks", wrap(async (c) =>
  a2aH.handleA2ACreateTask(c.get("db"), await c.req.json())));

app.get("/api/a2a/tasks/pushNotificationConfig", wrap(async (c) =>
  a2aH.handleA2AGetPushNotification(c.get("db"), c.req.query("agentId") || "")));

app.get("/api/a2a/tasks/:id", wrap(async (c) =>
  a2aH.handleA2AGetTask(c.get("db"), c.req.param("id")!)));

app.post("/api/a2a/tasks/cancel", wrap(async (c) =>
  a2aH.handleA2ACancelTask(c.get("db"), await c.req.json())));

app.post("/api/a2a/tasks/pushNotificationConfig/set", wrap(async (c) =>
  a2aH.handleA2ASetPushNotification(c.get("db"), await c.req.json())));

app.post("/api/a2a/tasks/update", wrap(async (c) =>
  a2aH.handleA2AUpdateTask(c.get("db"), await c.req.json())));

app.post("/api/a2a/tasks/:id/send", wrap(async (c) =>
  a2aH.handleA2ASendToTask(c.get("db"), c.req.param("id")!, await c.req.json())));

app.get("/api/a2a/tasks/:id/subscribe", async (c) => {
  const result = await a2aH.handleA2ASubscribe(c.get("db"), c.req.param("id"));
  c.req.raw.signal.addEventListener("abort", result.close);
  return new Response(result.stream, { headers: result.headers });
});

// ─── Webhook ─────────────────────────────────────────────────────────────

app.post("/api/webhook/test", wrap(async (c) =>
  webhookH.handleWebhookTest(c.get("db"), await c.req.json().catch(() => ({})), c.req.header())));

app.get("/api/webhook/test", wrap(async (c) =>
  webhookH.handleWebhookLogs(c.get("db"))));

// ─── ACP routes ──────────────────────────────────────────────────────────

app.get("/api/acp/runs", wrap(async (c) =>
  acpH.handleACPListRuns(c.get("db"))));

app.post("/api/acp/runs", wrap(async (c) =>
  acpH.handleACPCreateRun(c.get("db"), await c.req.json())));

app.get("/api/acp/runs/:id/stream", async (c) => {
  const result = await acpH.handleACPRunStream(c.get("db"), c.req.param("id"), c.req.raw.signal);
  if (!result) return c.json(fail("Run not found", 404), 404);
  return new Response(result.stream, { headers: result.headers });
});

app.get("/api/acp/runs/:id", wrap(async (c) =>
  acpH.handleACPGetRun(c.get("db"), c.req.param("id")!)));

app.post("/api/acp/runs/cancel", wrap(async (c) =>
  acpH.handleACPCancelRun(c.get("db"), await c.req.json())));

app.get("/api/acp/contexts", wrap(async (c) =>
  acpH.handleACPListContexts(c.get("db"))));

app.post("/api/acp/contexts", wrap(async (c) =>
  acpH.handleACPCreateContext(c.get("db"), await c.req.json())));

app.get("/api/acp/contexts/:id", wrap(async (c) =>
  acpH.handleACPGetContext(c.get("db"), c.req.param("id")!)));

app.get("/api/acp/contexts/:id/messages", wrap(async (c) =>
  acpH.handleACPContextMessages(c.get("db"), c.req.param("id")!)));

app.post("/api/acp/contexts/:id/join", wrap(async (c) =>
  acpH.handleACPJoinContext(c.get("db"), c.req.param("id")!, await c.req.json())));

app.post("/api/acp/contexts/:id/leave", wrap(async (c) =>
  acpH.handleACPLeaveContext(c.get("db"), c.req.param("id")!, await c.req.json())));

app.post("/api/acp/contexts/:id/speak", wrap(async (c) =>
  acpH.handleACPSpeakContext(c.get("db"), c.req.param("id")!, await c.req.json())));

app.get("/api/acp/agents/:agentId", wrap(async (c) =>
  acpH.handleACPGetAgent(c.get("db"), c.req.param("agentId")!)));
