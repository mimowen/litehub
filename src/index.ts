// src/index.ts — Unified Hono app for LiteHub
// Single entry point: all API routes dispatch to handlers/
// Vercel route limit: only 2 functions (api/main + api/mcp-sse)
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { LiteHubEnv } from "./types.js";
import { getBaseUrl } from "./utils.js";
import { authMiddleware } from "./middleware/auth.js";
import { ok, fail, send, sseHeaders } from "./utils/response.js";

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
app.use("*", cors({ origin: process.env.LITEHUB_CORS_ORIGIN || "*" }));

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

app.get("/", (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>LiteHub — Lightweight Agent Collaboration Hub</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #09090b; color: #e4e4e7; line-height: 1.7; }
  a { color: #60a5fa; text-decoration: none; } a:hover { text-decoration: underline; }
  code { background: #1e1e2e; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; color: #a5d6ff; }
  pre { background: #1e1e2e; padding: 1rem 1.25rem; border-radius: 8px; overflow-x: auto; font-size: 0.85rem; line-height: 1.5; margin: 0.75rem 0; }
  .hero { max-width: 720px; margin: 0 auto; padding: 6rem 2rem 3rem; text-align: center; }
  .hero h1 { font-size: 3rem; font-weight: 800; margin-bottom: 0.5rem; }
  .hero h1 span { background: linear-gradient(135deg, #60a5fa, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .hero p.tagline { font-size: 1.25rem; color: #94a3b8; margin-bottom: 2rem; }
  .badges { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; margin-bottom: 3rem; }
  .badge { background: #1e1e2e; border: 1px solid #2e2e3e; padding: 0.3rem 0.8rem; border-radius: 9999px; font-size: 0.8rem; color: #94a3b8; }
  .section { max-width: 720px; margin: 0 auto; padding: 0 2rem 3rem; }
  .section h2 { font-size: 1.5rem; margin-bottom: 1rem; color: #f4f4f5; }
  .section h3 { font-size: 1.1rem; margin: 1.25rem 0 0.5rem; color: #c4b5fd; }
  .section p { margin-bottom: 0.75rem; color: #a1a1aa; }
  .flow { display: flex; align-items: center; justify-content: center; gap: 0.5rem; flex-wrap: wrap; padding: 1.5rem 0; margin: 1rem 0; }
  .flow .node { background: #1e1e2e; border: 1px solid #3b3b50; padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.9rem; }
  .flow .arrow { color: #60a5fa; font-size: 1.2rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; }
  .card { background: #111118; border: 1px solid #1e1e2e; border-radius: 12px; padding: 1.25rem; }
  .card h4 { color: #60a5fa; font-size: 0.95rem; margin-bottom: 0.3rem; }
  .card p { font-size: 0.85rem; color: #71717a; margin: 0; }
  .skill-banner { background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); border: 1px solid #312e81; border-radius: 12px; padding: 1.5rem 2rem; margin: 2rem 0; text-align: center; }
  .skill-banner h3 { color: #a5b4fc; font-size: 1.1rem; margin-bottom: 0.5rem; }
  .skill-banner p { color: #818cf8; font-size: 0.9rem; margin-bottom: 1rem; }
  .skill-banner .url { font-family: monospace; background: #0f0f23; padding: 0.5rem 1rem; border-radius: 6px; color: #c4b5fd; font-size: 0.85rem; display: inline-block; }
  footer { max-width: 720px; margin: 0 auto; padding: 2rem; text-align: center; color: #52525b; font-size: 0.8rem; border-top: 1px solid #1e1e2e; }
  @media (max-width: 600px) { .hero h1 { font-size: 2rem; } .grid { grid-template-columns: 1fr; } }
</style></head><body>
<div class="hero">
  <h1>⚡ <span>LiteHub</span></h1>
  <p class="tagline">Lightweight Agent Collaboration Hub</p>
  <div class="badges">
    <span class="badge">14KB Core</span><span class="badge">SQLite</span><span class="badge">Vercel / CF Workers / VPS</span><span class="badge">Open Source</span>
  </div>
</div>
<div class="section">
  <h2>What is LiteHub?</h2>
  <p>LiteHub is a lightweight hub that lets <strong>distributed AI agents collaborate through named queues</strong>. Think of it as a water pipe system — agents produce data into queues, and other agents consume from those queues, forming processing pipelines.</p>
  <p>No orchestrator. No central brain. Just agents passing data through simple HTTP APIs.</p>
  <div class="flow">
    <span class="node">🔍 Searcher</span><span class="arrow">→</span><span class="node">raw</span><span class="arrow">→</span><span class="node">📝 Summarizer</span><span class="arrow">→</span><span class="node">summaries</span><span class="arrow">→</span><span class="node">🌐 Translator</span><span class="arrow">→</span><span class="node">en-summaries</span><span class="arrow">→</span><span class="node">💬 Notifier</span>
  </div>
</div>
<div class="section">
  <h2>What Can It Do?</h2>
  <div class="grid">
    <div class="card"><h4>🔗 Agent Registration</h4><p>Register agents with roles and queue subscriptions</p></div>
    <div class="card"><h4>📤 Produce</h4><p>Push data into a named queue</p></div>
    <div class="card"><h4>📥 Consume</h4><p>Pull data from a queue (FIFO)</p></div>
    <div class="card"><h4>🔀 Pipe</h4><p>Consume + produce in one call with lineage</p></div>
    <div class="card"><h4>👀 Peek</h4><p>Preview queue head without consuming</p></div>
    <div class="card"><h4>📊 Dashboard</h4><p>Live overview of agents, queues, counts</p></div>
  </div>
</div>
<div class="section">
  <h2>Quick Start</h2>
  <h3>1. Register an Agent</h3>
<pre>curl -X POST {{HOST}}/api/agent/register \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"searcher","name":"Search Agent","role":"producer","queues":["raw"]}'</pre>
  <h3>2. Produce Data</h3>
<pre>curl -X POST {{HOST}}/api/agent/produce \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"searcher","queue":"raw","data":"Found: ..."}'</pre>
  <h3>3. Consume Data</h3>
<pre>curl -X POST {{HOST}}/api/agent/consume \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"writer","queue":"raw"}'</pre>
</div>
<div class="section">
  <h2>For AI Agents — Skill</h2>
  <p>LiteHub provides a <strong>SKILL.md</strong> that any AI agent can download and use.</p>
  <div class="skill-banner">
    <h3>📄 Download the Skill</h3>
    <p>Point your AI agent to this URL:</p>
    <span class="url">{{HOST}}/skill</span>
  </div>
</div>
<footer>LiteHub is open source · <a href="https://github.com/mimowen/litehub">GitHub</a> · MIT License</footer>
</body></html>`);
});

// ─── Dashboard ───────────────────────────────────────────────────────────

app.get("/api/dashboard", async (c) => {
  const db = c.get("db");
  const data = await pageH.getDashboardData(db);
  return c.html(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>LiteHub Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.6}
.container{max-width:1200px;margin:0 auto;padding:2rem}h1{color:#4ade80;margin-bottom:1rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1.5rem;margin-top:2rem}
.card{background:#1e293b;border-radius:12px;padding:1.5rem;border:1px solid #334155}
.card h2{color:#4ade80;margin-bottom:.75rem;font-size:1.1rem}
.status{display:inline-flex;align-items:center;gap:.5rem;padding:.25rem .75rem;border-radius:9999px;font-size:.875rem;background:#166534;color:#86efac}
button{background:#22c55e;color:#fff;border:none;padding:.5rem 1rem;border-radius:6px;cursor:pointer;font-size:.875rem}button:hover{background:#16a34a}
input,textarea{width:100%;padding:.5rem;border:1px solid #334155;border-radius:6px;background:#0f172a;color:#e2e8f0;margin-bottom:.5rem}
.section{margin-top:1.5rem}.section h3{color:#94a3b8;margin-bottom:.5rem;font-size:.9rem;text-transform:uppercase}
pre{background:#0f172a;padding:1rem;border-radius:6px;overflow-x:auto;font-size:.8rem}
.token-input{display:flex;gap:.5rem;margin-bottom:1rem}.token-input input{flex:1;margin-bottom:0}
</style></head><body>
<div class="container">
  <h1>🚀 LiteHub Dashboard</h1><div class="status">● Online</div>
  <div class="token-input"><input type="password" id="token" placeholder="Bearer Token (if required)"><button onclick="saveToken()">Save</button></div>
  <div class="grid">
    <div class="card"><h2>🤖 Agents</h2><div id="agents">Loading...</div></div>
    <div class="card"><h2>📨 Queues</h2><div id="queues">Loading...</div></div>
    <div class="card"><h2>🏊 Pools</h2><div id="pools">Loading...</div></div>
  </div>
  <div class="grid">
    <div class="card"><h2>📋 A2A Tasks</h2><div id="a2a-tasks">Loading...</div></div>
    <div class="card"><h2>⚡ ACP Runs</h2><div id="acp-runs">Loading...</div></div>
    <div class="card"><h2>🔍 ACP Agents</h2><div id="acp-agents">Loading...</div></div>
  </div>
  <div class="section"><h3>Quick Test — Queue</h3>
    <input type="text" id="testQueue" placeholder="Queue name" value="test">
    <textarea id="testData" placeholder="Data to produce" rows="3">Hello from LiteHub!</textarea>
    <button onclick="produce()">Produce</button><pre id="result"></pre>
  </div>
  <div class="section"><h3>Quick Test — A2A Task</h3>
    <input type="text" id="taskName" placeholder="Task name" value="test-task">
    <input type="text" id="taskDesc" placeholder="Task description" value="A test task">
    <button onclick="createTask()">Create Task</button><pre id="task-result"></pre>
  </div>
</div>
<script>
function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
const token=localStorage.getItem('litehub_token')||'';document.getElementById('token').value=token;
function saveToken(){localStorage.setItem('litehub_token',document.getElementById('token').value);alert('Token saved')}
function headers(){const h={'Content-Type':'application/json'};const t=localStorage.getItem('litehub_token');if(t)h['Authorization']='Bearer '+t;return h}
async function loadData(){try{const[a,q,p,t,r,ag]=await Promise.all([fetch('/api/agents',{headers:headers()}).then(r=>r.json()).catch(()=>({})),fetch('/api/queues',{headers:headers()}).then(r=>r.json()).catch(()=>({})),fetch('/api/pools',{headers:headers()}).then(r=>r.json()).catch(()=>({})),fetch('/api/a2a/tasks',{headers:headers()}).then(r=>r.json()).catch(()=>({})),fetch('/api/acp/runs',{headers:headers()}).then(r=>r.json()).catch(()=>({})),fetch('/api/acp/agents',{headers:headers()}).then(r=>r.json()).catch(()=>({}))]);
document.getElementById('agents').innerHTML=a.agents?.map(x=>'<div>'+escapeHtml(x.name)+' <span style="color:#94a3b8">('+escapeHtml(x.role)+')</span></div>').join('')||'<div style="color:#64748b">No agents</div>';
document.getElementById('queues').innerHTML=q.queues?.map(x=>'<div>'+escapeHtml(x.name)+' <span style="color:#64748b">('+x.size+' msgs)</span></div>').join('')||'<div style="color:#64748b">No queues</div>';
document.getElementById('pools').innerHTML=p.pools?.map(x=>'<div>'+escapeHtml(x.name)+' <span style="color:#64748b">('+x.memberCount+'/'+x.maxMembers+')</span></div>').join('')||'<div style="color:#64748b">No pools</div>';
document.getElementById('a2a-tasks').innerHTML=t.tasks?.map(x=>'<div>'+escapeHtml(x.name)+' <span style="color:#f59e0b">['+escapeHtml(x.status)+']</span></div>').join('')||'<div style="color:#64748b">No tasks</div>';
document.getElementById('acp-runs').innerHTML=r.runs?.map(x=>'<div>'+escapeHtml(x.name||x.runId)+' <span style="color:#3b82f6">['+escapeHtml(x.status||'active')+']</span></div>').join('')||'<div style="color:#64748b">No runs</div>';
document.getElementById('acp-agents').innerHTML=ag.agents?.map(x=>'<div>'+escapeHtml(x.agentId)+'</div>').join('')||'<div style="color:#64748b">No ACP agents</div>';
}catch(e){console.error(e)}}
async function produce(){const q=document.getElementById('testQueue').value;const d=document.getElementById('testData').value;const r=await fetch('/api/agent/produce',{method:'POST',headers:headers(),body:JSON.stringify({queue:q,agentId:'dashboard',data:d})});document.getElementById('result').textContent=JSON.stringify(await r.json(),null,2);loadData()}
async function createTask(){const n=document.getElementById('taskName').value;const d=document.getElementById('taskDesc').value;const r=await fetch('/api/a2a/tasks',{method:'POST',headers:headers(),body:JSON.stringify({name:n,description:d})});document.getElementById('task-result').textContent=JSON.stringify(await r.json(),null,2);loadData()}
loadData();setInterval(loadData,5000);
</script></body></html>`);
});

// ─── Skill download ──────────────────────────────────────────────────────

app.get("/api/skill", async (c) => {
  const result = await pageH.handleSkillDownload();
  if (!result) return c.text("Skill file not found", 404);
  c.header("Content-Type", result.contentType);
  c.header("Content-Disposition", 'attachment; filename="litehub.md"');
  return c.body(result.content);
});

app.get("/api/skills", (c) => {
  return c.json(ok({ skills: [{ name: "litehub", file: "litehub.md", description: "LiteHub AI Agent 协作技能" }] }));
});

// ─── MCP Discovery ───────────────────────────────────────────────────────

app.get("/api/mcp", async (c) => {
  const config = await pageH.handleMcpDiscovery(getBaseUrl(c));
  c.header("Content-Type", "application/json");
  c.header("Content-Disposition", 'attachment; filename="litehub-mcp.json"');
  return c.json(config);
});

// ─── MCP endpoints (graceful fallback for Edge) ──────────────────────────

const mcpNotAvailable = (c: any) => c.json(fail("MCP protocol requires Node.js runtime.", 501), 501);
app.get("/mcp", mcpNotAvailable);
app.post("/mcp", mcpNotAvailable);
app.delete("/mcp", mcpNotAvailable);
app.all("/api/mcp/sse", mcpNotAvailable);

// ─── API Root ────────────────────────────────────────────────────────────

app.get("/api", (c) => {
  return c.json(ok({
    name: "LiteHub", version: "2.0.0",
    endpoints: { agents: "/api/agents", queues: "/api/queues", pools: "/api/pools", dashboard: "/api/dashboard", skill: "/api/skill", mcp: "/api/mcp" },
  }));
});

// ─── Agent API ───────────────────────────────────────────────────────────

app.post("/api/agent/register", async (c) => {
  try { return send(c, await agentH.handleRegister(c.get("db"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/agent/produce", async (c) => {
  try { return send(c, await queueH.handleProduce(c.get("db"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/agent/consume", async (c) => {
  try { return send(c, await queueH.handleConsume(c.get("db"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/agent/pipe", async (c) => {
  try { return send(c, await queueH.handlePipe(c.get("db"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/agents", async (c) => {
  try { return send(c, await agentH.handleListAgents(c.get("db"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/agents/:id", async (c) => {
  try { return send(c, await agentH.handleGetAgent(c.get("db"), c.req.param("id"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/queues", async (c) => {
  try { return send(c, await queueH.handleListQueues(c.get("db"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/queues/:name", async (c) => {
  try { return send(c, await queueH.handleQueueStatus(c.get("db"), c.req.param("name"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/peek", async (c) => {
  try { return send(c, await queueH.handlePeek(c.get("db"), c.req.query("queue") || "")); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

// ─── Pool API ────────────────────────────────────────────────────────────

app.post("/api/pool/create", async (c) => {
  try { return send(c, await poolH.handlePoolCreate(c.get("db"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/pools", async (c) => {
  try { return send(c, await poolH.handleListPools(c.get("db"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/pool/members", async (c) => {
  try { return send(c, await poolH.handlePoolMembers(c.get("db"), c.req.query("pool") || "")); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/pool/messages", async (c) => {
  try {
    const pool = c.req.query("pool") || "";
    const limit = c.req.query("limit");
    return send(c, await poolH.handlePoolMessages(c.get("db"), pool, { since: c.req.query("since"), tag: c.req.query("tag"), limit: limit ? parseInt(limit) : undefined }));
  } catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/pool/:name", async (c) => {
  try { return send(c, await poolH.handleGetPool(c.get("db"), c.req.param("name"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/pool/join", async (c) => {
  try { return send(c, await poolH.handlePoolJoin(c.get("db"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/pool/leave", async (c) => {
  try { return send(c, await poolH.handlePoolLeave(c.get("db"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/pool/speak", async (c) => {
  try { return send(c, await poolH.handlePoolSpeak(c.get("db"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

// ─── Agent Card ──────────────────────────────────────────────────────────

app.get("/.well-known/agent-card.json", (c) => {
  const baseUrl = getBaseUrl(c);
  return c.json({
    name: "LiteHub", version: "2.0.0",
    description: "Distributed Agent Collaboration Hub — Queue + Pool messaging",
    capabilities: {
      queue: { produce: `${baseUrl}/api/agent/produce`, consume: `${baseUrl}/api/agent/consume`, peek: `${baseUrl}/api/peek` },
      pool: { create: `${baseUrl}/api/pool/create`, join: `${baseUrl}/api/pool/join`, speak: `${baseUrl}/api/pool/speak`, messages: `${baseUrl}/api/pool/messages` },
      a2a: { tasks: `${baseUrl}/api/a2a/tasks`, pushNotificationConfig: `${baseUrl}/api/a2a/tasks/pushNotificationConfig/set` },
      acp: { runs: `${baseUrl}/api/acp/runs`, contexts: `${baseUrl}/api/acp/contexts` },
      mcp: { endpoint: `${baseUrl}/api/mcp`, config: `${baseUrl}/api/mcp` },
    },
    protocols: ["a2a", "acp", "mcp"],
  });
});

// ─── A2A Standard Protocol (JSON-RPC 2.0) ────────────────────────────────

app.post("/a2a", async (c) => {
  try {
    const db = c.get("db");
    const body = await c.req.json();
    const agentId = c.req.header("x-agent-id") || "default-agent";
    return c.json(await handleA2ARequest(db, body, agentId, getBaseUrl(c)));
  } catch (e: any) {
    return c.json({ jsonrpc: "2.0", error: { code: -32603, message: e.message }, id: null }, 500);
  }
});

app.get("/a2a/stream", async (c) => {
  try {
    const taskId = c.req.query("taskId");
    if (!taskId) return c.json(fail("Missing taskId", 400), 400);
    const stream = handleA2AStream(c.get("db"), taskId);
    if (!stream) return c.json(fail("Task not found", 404), 404);
    return new Response(stream, { headers: sseHeaders() });
  } catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

// ─── A2A Legacy API ──────────────────────────────────────────────────────

app.get("/api/a2a/tasks", async (c) => {
  try { return send(c, await a2aH.handleA2AListTasks(c.get("db"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/a2a/tasks", async (c) => {
  try { return send(c, await a2aH.handleA2ACreateTask(c.get("db"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/a2a/tasks/pushNotificationConfig", async (c) => {
  try { return send(c, await a2aH.handleA2AGetPushNotification(c.get("db"), c.req.query("agentId") || "")); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/a2a/tasks/:id", async (c) => {
  try { return send(c, await a2aH.handleA2AGetTask(c.get("db"), c.req.param("id"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/a2a/tasks/cancel", async (c) => {
  try { return send(c, await a2aH.handleA2ACancelTask(c.get("db"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/a2a/tasks/pushNotificationConfig/set", async (c) => {
  try { return send(c, await a2aH.handleA2ASetPushNotification(c.get("db"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/a2a/tasks/update", async (c) => {
  try { return send(c, await a2aH.handleA2AUpdateTask(c.get("db"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/a2a/tasks/:id/send", async (c) => {
  try { return send(c, await a2aH.handleA2ASendToTask(c.get("db"), c.req.param("id"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/a2a/tasks/:id/subscribe", async (c) => {
  try {
    const result = await a2aH.handleA2ASubscribe(c.get("db"), c.req.param("id"));
    c.req.raw.signal.addEventListener("abort", result.close);
    return new Response(result.stream, { headers: result.headers });
  } catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

// ─── Webhook ─────────────────────────────────────────────────────────────

app.post("/api/webhook/test", async (c) => {
  try {
    const payload = await c.req.json().catch(() => ({}));
    return send(c, await webhookH.handleWebhookTest(c.get("db"), payload, c.req.header()));
  } catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/webhook/test", async (c) => {
  try { return send(c, await webhookH.handleWebhookLogs(c.get("db"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

// ─── ACP Protocol Routes ─────────────────────────────────────────────────

app.get("/api/acp/runs", async (c) => {
  try { return send(c, await acpH.handleACPListRuns(c.get("db"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/acp/runs", async (c) => {
  try { return send(c, await acpH.handleACPCreateRun(c.get("db"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/acp/runs/:id/stream", async (c) => {
  try {
    const result = await acpH.handleACPRunStream(c.get("db"), c.req.param("id"), c.req.raw.signal);
    if (!result) return c.json(fail("Run not found", 404), 404);
    return new Response(result.stream, { headers: result.headers });
  } catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/acp/runs/:id", async (c) => {
  try { return send(c, await acpH.handleACPGetRun(c.get("db"), c.req.param("id"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/acp/runs/cancel", async (c) => {
  try { return send(c, await acpH.handleACPCancelRun(c.get("db"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/acp/contexts", async (c) => {
  try { return send(c, await acpH.handleACPListContexts(c.get("db"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/acp/contexts", async (c) => {
  try { return send(c, await acpH.handleACPCreateContext(c.get("db"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/acp/contexts/:id", async (c) => {
  try { return send(c, await acpH.handleACPGetContext(c.get("db"), c.req.param("id"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/acp/contexts/:id/messages", async (c) => {
  try { return send(c, await acpH.handleACPContextMessages(c.get("db"), c.req.param("id"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/acp/contexts/:id/join", async (c) => {
  try { return send(c, await acpH.handleACPJoinContext(c.get("db"), c.req.param("id"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/acp/contexts/:id/leave", async (c) => {
  try { return send(c, await acpH.handleACPLeaveContext(c.get("db"), c.req.param("id"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.post("/api/acp/contexts/:id/speak", async (c) => {
  try { return send(c, await acpH.handleACPSpeakContext(c.get("db"), c.req.param("id"), await c.req.json())); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/acp/agents", async (c) => {
  try { return send(c, await acpH.handleACPListAgents(c.get("db"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});

app.get("/api/acp/agents/:agentId", async (c) => {
  try { return send(c, await acpH.handleACPGetAgent(c.get("db"), c.req.param("agentId"))); }
  catch (e: any) { return c.json(fail(e.message, 500), 500); }
});
