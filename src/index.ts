// src/index.ts — Unified Hono app for LiteHub
// Uses async core/ functions via DbClient injected through Hono context
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { LiteHubEnv } from "./types.js";

// ─── Core imports ────────────────────────────────────────────────────────
import {
  ensureAgent, registerAgent, getAgent, listAgents,
  queueExists, ensureQueue, getQueueStatus, listQueues,
  produce, consume, peek,
} from "./core/queue.js";
import {
  createPool, getPool, listPools,
  joinPool, leavePool, listMembers,
  speak, getMessages,
} from "./core/pool.js";
import {
  createTask, getTask, listTasks, cancelTask, updateTask,
  setPushNotification, getPushNotification,
} from "./core/a2a.js";
import {
  createRun, getRun, listRuns, cancelRun,
  createContext, getContext, listContexts,
  joinContext, leaveContext, speakContext,
  getContextMessages, getACPAgent,
} from "./core/acp.js";
import { logWebhook, getWebhookLogs } from "./core/webhook.js";

// ─── MCP handler (separate module) ──────────────────────────────────────
import { handleStreamableHTTP, handleSSE } from "./mcp-handler.js";

// ─── App setup ───────────────────────────────────────────────────────────
const app = new Hono<LiteHubEnv>();
export default app;

app.use("*", logger());
app.use("*", cors({ origin: process.env.LITEHUB_CORS_ORIGIN || "*" }));

// ─── DbClient injection placeholder ──────────────────────────────────────
// Platform entry points set db before routes run.
// If db is not set, return error for API routes.
app.use("/api/*", async (c, next) => {
  const db = c.get("db");
  if (!db) {
    return c.json({ ok: false, error: "Database not initialized" }, 500);
  }
  await next();
});
app.use("/mcp", async (c, next) => {
  const db = c.get("db");
  if (!db) {
    return c.json({ ok: false, error: "Database not initialized" }, 500);
  }
  await next();
});

// ─── Global error handler ────────────────────────────────────────────────
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ ok: false, error: err.message || "Internal server error" }, 500);
});

// ─── Auth (disabled when LITEHUB_TOKEN is not set) ──────────────────────
const TOKEN = process.env.LITEHUB_TOKEN || "";
const EXTRA_TOKENS = (process.env.LITEHUB_TOKENS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const PUBLIC_PATHS = new Set([
  "/.well-known/agent-card.json",
  "/api/webhook/test",
  "/api/agents", "/api/queues", "/api/pools",
  "/api/peek", "/api/skill", "/api/skills", "/api/dashboard",
  "/api/mcp",
  "/api/a2a/tasks", "/api/acp/runs", "/api/acp/contexts", "/api/acp/agents",
]);

if (TOKEN) {
  const validTokens = EXTRA_TOKENS.length > 0
    ? new Set([TOKEN, ...EXTRA_TOKENS])
    : new Set([TOKEN]);
  app.use("/api/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (c.req.method === "GET" && PUBLIC_PATHS.has(path)) return next();
    if (path === "/api/webhook/test") return next();
    if (path.match(/^\/api\/acp\/runs\/[^/]+\/stream$/)) return next();
    if (path.match(/^\/api\/a2a\/tasks\/[\w-]+$/) && c.req.method === "GET") return next();
    if (path.match(/^\/api\/acp\/runs\/[\w-]+$/) && c.req.method === "GET") return next();
    if (path.match(/^\/api\/acp\/contexts\/[\w-]+$/) && c.req.method === "GET") return next();
    if (path.match(/^\/api\/acp\/contexts\/[\w-]+\/messages$/) && c.req.method === "GET") return next();
    if (path.match(/^\/api\/acp\/agents\/.+$/) && c.req.method === "GET") return next();
    const header = c.req.header("Authorization") || "";
    const t = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!t || !validTokens.has(t)) {
      return c.json({ ok: false, error: "Unauthorized" }, 401);
    }
    await next();
  });
}

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
  .badge { background: #1e1e2e; border: 1px solid #2e2e3e; padding: 0.3rem 0.8rem; border-radius: 999px; font-size: 0.8rem; color: #94a3b8; }
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
    <span class="badge">14KB Core</span>
    <span class="badge">SQLite</span>
    <span class="badge">Vercel / CF Workers / VPS</span>
    <span class="badge">Open Source</span>
  </div>
</div>

<div class="section">
  <h2>What is LiteHub?</h2>
  <p>LiteHub is a lightweight hub that lets <strong>distributed AI agents collaborate through named queues</strong>. Think of it as a water pipe system — agents produce data into queues, and other agents consume from those queues, forming processing pipelines.</p>
  <p>No orchestrator. No central brain. Just agents passing data through simple HTTP APIs.</p>

  <div class="flow">
    <span class="node">🔍 Searcher</span>
    <span class="arrow">→</span>
    <span class="node">raw</span>
    <span class="arrow">→</span>
    <span class="node">📝 Summarizer</span>
    <span class="arrow">→</span>
    <span class="node">summaries</span>
    <span class="arrow">→</span>
    <span class="node">🌐 Translator</span>
    <span class="arrow">→</span>
    <span class="node">en-summaries</span>
    <span class="arrow">→</span>
    <span class="node">💬 Notifier</span>
  </div>
</div>

<div class="section">
  <h2>What Can It Do?</h2>
  <div class="grid">
    <div class="card"><h4>🔗 Agent Registration</h4><p>Register agents with roles (producer/consumer/both) and queue subscriptions</p></div>
    <div class="card"><h4>📤 Produce</h4><p>Push data into a named queue. Data is stored as a file pointer in SQLite</p></div>
    <div class="card"><h4>📥 Consume</h4><p>Pull data from a queue (FIFO). Returns base64 + utf-8 dual format</p></div>
    <div class="card"><h4>🔀 Pipe</h4><p>Consume from one queue, produce to another — one API call. Carries source lineage in metadata</p></div>
    <div class="card"><h4>👀 Peek</h4><p>Preview the next item in a queue without consuming it</p></div>
    <div class="card"><h4>📊 Dashboard</h4><p>Live overview of agents, queues, pending/consumed counts</p></div>
  </div>
</div>

<div class="section">
  <h2>Quick Start</h2>
  <h3>1. Register an Agent</h3>
<pre>curl -X POST {{HOST}}/api/agent/register \
  -H "Content-Type: application/json" \
  -d '{"agentId":"searcher","name":"Search Agent","role":"producer","queues":["raw"]}'</pre>

  <h3>2. Produce Data</h3>
<pre>curl -X POST {{HOST}}/api/agent/produce \
  -H "Content-Type: application/json" \
  -d '{"agentId":"searcher","queue":"raw","data":"Found: ..."}'</pre>

  <h3>3. Consume Data</h3>
<pre>curl -X POST {{HOST}}/api/agent/consume \
  -H "Content-Type: application/json" \
  -d '{"agentId":"writer","queue":"raw"}'</pre>

  <h3>4. Pipe (Consume → Produce)</h3>
<pre>curl -X POST {{HOST}}/api/agent/pipe \
  -H "Content-Type: application/json" \
  -d '{"agentId":"writer","sourceQueue":"raw","targetQueue":"drafts","data":"Article draft..."}'</pre>
</div>

<div class="section">
  <h2>API Reference</h2>
  <table style="width:100%;border-collapse:collapse;margin:0.75rem 0">
    <tr style="text-align:left"><th style="padding:0.5rem;color:#60a5fa">Method</th><th style="padding:0.5rem;color:#60a5fa">Endpoint</th><th style="padding:0.5rem;color:#60a5fa">Description</th></tr>
    <tr><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e"><code>POST</code></td><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e">/api/agent/register</td><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e;color:#a1a1aa">Register an agent</td></tr>
    <tr><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e"><code>POST</code></td><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e">/api/agent/produce</td><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e;color:#a1a1aa">Push data to a queue</td></tr>
    <tr><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e"><code>POST</code></td><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e">/api/agent/consume</td><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e;color:#a1a1aa">Pull data from a queue</td></tr>
    <tr><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e"><code>POST</code></td><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e">/api/agent/pipe</td><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e;color:#a1a1aa">Consume + produce in one call</td></tr>
    <tr><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e"><code>GET</code></td><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e">/api/agents</td><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e;color:#a1a1aa">List all agents</td></tr>
    <tr><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e"><code>GET</code></td><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e">/api/queues</td><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e;color:#a1a1aa">List all queues with stats</td></tr>
    <tr><td style="padding:0.4rem 0.5rem"><code>GET</code></td><td style="padding:0.4rem 0.5rem">/api/peek?queue=name</td><td style="padding:0.4rem 0.5rem;color:#a1a1aa">Preview queue head without consuming</td></tr>
  </table>
</div>

<div class="section">
  <h2>For AI Agents — Skill</h2>
  <p>LiteHub provides a <strong>SKILL.md</strong> that any AI agent can download and use to immediately interact with a LiteHub instance.</p>
  <div class="skill-banner">
    <h3>📄 Download the Skill</h3>
    <p>Point your AI agent to this URL:</p>
    <span class="url">{{HOST}}/skill</span>
  </div>
  <p>The skill tells the AI how to register, produce, consume, and pipe data through LiteHub using simple HTTP calls. No SDK needed — just <code>curl</code> or <code>fetch</code>.</p>
</div>

<footer>
  LiteHub is open source · <a href="https://github.com/mimowen/litehub">GitHub</a> · MIT License
</footer>
</body></html>`);
});

// ─── Dashboard ───────────────────────────────────────────────────────────

app.get("/api/dashboard", async (c) => {
  const db = c.get("db");
  const agents = await listAgents(db);
  const queues = await listQueues(db);
  const pools = await listPools(db);
  const tasks = await listTasks(db, { limit: 20 });
  const runs = await listRuns(db, { limit: 20 });
  const acpAgents = await listAgents(db);

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LiteHub Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.6; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    h1 { color: #4ade80; margin-bottom: 1rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-top: 2rem; }
    .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; border: 1px solid #334155; }
    .card h2 { color: #4ade80; margin-bottom: 0.75rem; font-size: 1.1rem; }
    .status { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.875rem; background: #166534; color: #86efac; }
    button { background: #22c55e; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem; }
    button:hover { background: #16a34a; }
    input, textarea { width: 100%; padding: 0.5rem; border: 1px solid #334155; border-radius: 6px; background: #0f172a; color: #e2e8f0; margin-bottom: 0.5rem; }
    .section { margin-top: 1.5rem; }
    .section h3 { color: #94a3b8; margin-bottom: 0.5rem; font-size: 0.9rem; text-transform: uppercase; }
    pre { background: #0f172a; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.8rem; }
    .token-input { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    .token-input input { flex: 1; margin-bottom: 0; }
    .tab-bar { display: flex; gap: 0.5rem; margin-top: 1.5rem; }
    .tab { padding: 0.5rem 1rem; border-radius: 6px 6px 0 0; cursor: pointer; background: #1e293b; color: #94a3b8; border: 1px solid #334155; border-bottom: none; }
    .tab.active { background: #334155; color: #4ade80; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 LiteHub Dashboard</h1>
    <div class="status">● Online</div>

    <div class="token-input">
      <input type="password" id="token" placeholder="Bearer Token (if required)">
      <button onclick="saveToken()">Save</button>
    </div>

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

    <div class="section">
      <h3>Quick Test — Queue</h3>
      <input type="text" id="testQueue" placeholder="Queue name" value="test">
      <textarea id="testData" placeholder="Data to produce" rows="3">Hello from LiteHub!</textarea>
      <button onclick="produce()">Produce</button>
      <pre id="result"></pre>
    </div>

    <div class="section">
      <h3>Quick Test — A2A Task</h3>
      <input type="text" id="taskName" placeholder="Task name" value="test-task">
      <input type="text" id="taskDesc" placeholder="Task description" value="A test task">
      <input type="text" id="taskQueue" placeholder="Queue (optional)" value="">
      <button onclick="createTask()">Create Task</button>
      <pre id="task-result"></pre>
    </div>

    <div class="section">
      <h3>Quick Test — ACP Run</h3>
      <input type="text" id="runName" placeholder="Run name" value="test-run">
      <input type="text" id="runAgent" placeholder="Agent ID" value="dashboard-agent">
      <button onclick="createRun()">Create Run</button>
      <button onclick="speakRun()" style="background:#3b82f6;margin-left:0.5rem">Speak to Run</button>
      <input type="text" id="runMsg" placeholder="Message" value="Hello from run!" style="margin-top:0.5rem">
      <div id="sse-status" style="color:#94a3b8;font-size:0.8rem;margin-top:0.5rem"></div>
      <pre id="run-result"></pre>
    </div>
  </div>

  <script>
    function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

    const token = localStorage.getItem('litehub_token') || '';
    document.getElementById('token').value = token;
    let currentRunId = null;
    let eventSource = null;

    function saveToken() {
      localStorage.setItem('litehub_token', document.getElementById('token').value);
      alert('Token saved');
    }

    function headers() {
      const h = { 'Content-Type': 'application/json' };
      const t = localStorage.getItem('litehub_token');
      if (t) h['Authorization'] = 'Bearer ' + t;
      return h;
    }

    async function loadData() {
      try {
        const [agents, queues, pools, a2aTasks, acpRuns, acpAgents] = await Promise.all([
          fetch('/api/agents', { headers: headers() }).then(r => r.json()).catch(() => ({})),
          fetch('/api/queues', { headers: headers() }).then(r => r.json()).catch(() => ({})),
          fetch('/api/pools', { headers: headers() }).then(r => r.json()).catch(() => ({})),
          fetch('/api/a2a/tasks', { headers: headers() }).then(r => r.json()).catch(() => ({})),
          fetch('/api/acp/runs', { headers: headers() }).then(r => r.json()).catch(() => ({})),
          fetch('/api/acp/agents', { headers: headers() }).then(r => r.json()).catch(() => ({}))
        ]);
        document.getElementById('agents').innerHTML = agents.agents?.map(a => '<div>' + escapeHtml(a.name) + ' <span style="color:#94a3b8">(' + escapeHtml(a.role) + ')</span></div>').join('') || '<div style="color:#64748b">No agents</div>';
        document.getElementById('queues').innerHTML = queues.queues?.map(q => '<div>' + escapeHtml(q.name) + ' <span style="color:#64748b">(' + q.size + ' msgs)</span></div>').join('') || '<div style="color:#64748b">No queues</div>';
        document.getElementById('pools').innerHTML = pools.pools?.map(p => '<div>' + escapeHtml(p.name) + ' <span style="color:#64748b">(' + p.memberCount + '/' + p.maxMembers + ')</span></div>').join('') || '<div style="color:#64748b">No pools</div>';
        document.getElementById('a2a-tasks').innerHTML = a2aTasks.tasks?.map(t => '<div>' + escapeHtml(t.name) + ' <span style="color:#f59e0b">[' + escapeHtml(t.status) + ']</span></div>').join('') || '<div style="color:#64748b">No tasks</div>';
        document.getElementById('acp-runs').innerHTML = acpRuns.runs?.map(r => '<div>' + escapeHtml(r.name || r.runId) + ' <span style="color:#3b82f6">[' + escapeHtml(r.status || 'active') + ']</span></div>').join('') || '<div style="color:#64748b">No runs</div>';
        document.getElementById('acp-agents').innerHTML = acpAgents.agents?.map(a => '<div>' + escapeHtml(a.agentId) + '</div>').join('') || '<div style="color:#64748b">No ACP agents</div>';
      } catch (e) { console.error(e); }
    }

    async function produce() {
      const queue = document.getElementById('testQueue').value;
      const data = document.getElementById('testData').value;
      const res = await fetch('/api/agent/produce', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ queue, agentId: 'dashboard', data })
      });
      const j = await res.json();
      document.getElementById('result').textContent = JSON.stringify(j, null, 2);
      loadData();
    }

    async function createTask() {
      const name = document.getElementById('taskName').value;
      const description = document.getElementById('taskDesc').value;
      const queue = document.getElementById('taskQueue').value || undefined;
      const res = await fetch('/api/a2a/tasks', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ name, description, queue })
      });
      const j = await res.json();
      document.getElementById('task-result').textContent = JSON.stringify(j, null, 2);
      loadData();
    }

    async function createRun() {
      const name = document.getElementById('runName').value;
      const agentId = document.getElementById('runAgent').value;
      const res = await fetch('/api/acp/runs', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ name, agentId })
      });
      const j = await res.json();
      document.getElementById('run-result').textContent = JSON.stringify(j, null, 2);
      if (j.ok && j.run?.id) {
        currentRunId = j.run.id;
        startSSE(j.run.id);
      }
      loadData();
    }

    async function speakRun() {
      if (!currentRunId) { alert('Create a run first'); return; }
      const agentId = document.getElementById('runAgent').value;
      const content = document.getElementById('runMsg').value;
      const res = await fetch('/api/acp/contexts/' + currentRunId + '/speak', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ agentId, content })
      });
      const j = await res.json();
      document.getElementById('run-result').textContent = JSON.stringify(j, null, 2);
    }

    function startSSE(runId) {
      if (eventSource) eventSource.close();
      const sseStatus = document.getElementById('sse-status');
      sseStatus.textContent = 'SSE: Connecting to run ' + runId + '...';
      eventSource = new EventSource('/api/acp/runs/' + runId + '/stream');
      eventSource.addEventListener('init', (e) => {
        const data = JSON.parse(e.data);
        sseStatus.textContent = 'SSE: Connected — ' + data.messageCount + ' messages';
      });
      eventSource.addEventListener('messages', (e) => {
        const data = JSON.parse(e.data);
        sseStatus.textContent = 'SSE: ' + data.newMessages.length + ' new message(s) received';
      });
      eventSource.addEventListener('close', () => {
        sseStatus.textContent = 'SSE: Stream closed';
        eventSource.close();
      });
      eventSource.onerror = () => {
        sseStatus.textContent = 'SSE: Connection error';
      };
    }

    loadData();
    setInterval(loadData, 5000);
  </script>
</body>
</html>`);
});

// ─── Skill download (Edge-compatible) ───────────────────────────────────

app.get("/api/skill", async (c) => {
  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(join(process.cwd(), "skills", "litehub.md"), "utf-8");
    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="litehub.md"');
    return c.body(content);
  } catch {
    return c.text("Skill file not found", 404);
  }
});

app.get("/api/skills", (c) => {
  return c.json({
    ok: true,
    skills: [{ name: "litehub", file: "litehub.md", description: "LiteHub AI Agent 协作技能" }],
  });
});

// ─── MCP Discovery ──────────────────────────────────────────────────────

import { MCP_TOOLS } from "./mcp/tools.js";

app.get("/api/mcp", (c) => {
  const baseUrl = new URL(c.req.url).origin;
  const config = {
    mcpServers: {
      litehub: {
        url: `${baseUrl}/api/mcp/sse`,
        transport: "sse",
        description: "LiteHub — 轻量级 Agent 协作管道 (支持 SSE 和 Streamable HTTP)",
      },
    },
    tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description })),
    endpoints: {
      register: "POST /api/agent/register",
      produce: "POST /api/agent/produce",
      consume: "POST /api/agent/consume",
      pipe: "POST /api/agent/pipe",
      peek: "GET /api/peek?queue=",
      poolCreate: "POST /api/pool/create",
      poolJoin: "POST /api/pool/join",
      poolSpeak: "POST /api/pool/speak",
      poolMessages: "GET /api/pool/messages",
      agents: "GET /api/agents",
      queues: "GET /api/queues",
      pools: "GET /api/pools",
      a2aTasks: "GET /api/a2a/tasks",
      a2aTaskCreate: "POST /api/a2a/tasks",
      a2aTaskUpdate: "POST /api/a2a/tasks/update",
      a2aPushNotification: "POST /api/a2a/tasks/pushNotificationConfig/set",
      acpRuns: "GET /api/acp/runs",
      acpRunCreate: "POST /api/acp/runs",
      acpContexts: "GET /api/acp/contexts",
      acpContextCreate: "POST /api/acp/contexts",
      mcpSSE: "GET|POST /api/mcp/sse",
    },
    auth: {
      type: "bearer",
      description: "设置环境变量 LITEHUB_TOKEN 后，请求需携带 Authorization: Bearer <token>",
    },
    transports: {
      sse: "Server-Sent Events (传统方式，适合短连接)",
      streamableHttp: "Streamable HTTP (推荐，更高效，Vercel 官方推荐)",
    },
  };
  c.header("Content-Type", "application/json");
  c.header("Content-Disposition", 'attachment; filename="litehub-mcp.json"');
  return c.json(config);
});

// ─── MCP Streamable HTTP / SSE Endpoints ────────────────────────────────

app.get("/mcp", (c) => handleSSE(c));
app.post("/mcp", (c) => handleStreamableHTTP(c));
app.delete("/mcp", (c) => handleStreamableHTTP(c));
app.all("/api/mcp/sse", (c) => {
  if (c.req.method === "GET") return handleSSE(c);
  return handleStreamableHTTP(c);
});

// ─── API Root ────────────────────────────────────────────────────────────

app.get("/api", (c) => {
  return c.json({
    ok: true,
    name: "LiteHub",
    version: "2.0.0",
    endpoints: {
      agents: "/api/agents",
      queues: "/api/queues",
      pools: "/api/pools",
      dashboard: "/api/dashboard",
      skill: "/api/skill",
      mcp: "/api/mcp",
    },
  });
});

// ─── Agent API ───────────────────────────────────────────────────────────

app.post("/api/agent/register", async (c) => {
  try {
    const db = c.get("db");
    const body = await c.req.json();
    const { agentId, name, role, queues, pools, pollInterval } = body;
    if (!agentId || !name || !role) {
      return c.json({ ok: false, error: "缺少必填字段: agentId, name, role" }, 400);
    }
    const queueInput: string[] = queues || [];
    const poolInput = pools || [];
    const result = await registerAgent(
      db,
      { agentId, name, role, queues: queueInput, pollInterval },
      // queueDescriptions: map queue names to descriptions if provided as objects
      Object.fromEntries(
        queueInput.map((q: any) => [typeof q === "string" ? q : q.name, typeof q === "string" ? "" : q.description || ""]),
      ),
      // poolDescriptions
      Object.fromEntries(
        poolInput.map((p: any) => [typeof p === "string" ? p : p.name, { description: typeof p === "string" ? "" : p.description || "", maxMembers: typeof p === "string" ? undefined : p.maxMembers }]),
      ),
    );
    return c.json({ ok: true, agent: result.agent, createdQueues: result.createdQueues, createdPools: result.createdPools });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message || "Registration failed" }, 500);
  }
});

app.get("/api/agents", async (c) => {
  try {
    const db = c.get("db");
    return c.json({ ok: true, agents: await listAgents(db) });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// ─── Produce / Consume / Pipe ────────────────────────────────────────────

app.post("/api/agent/produce", async (c) => {
  try {
    const db = c.get("db");
    const body = await c.req.json();
    const { agentId, queue, data, contentType, metadata } = body;
    if (!agentId || !queue || data === undefined) {
      return c.json({ ok: false, error: "缺少必填字段: agentId, queue, data" }, 400);
    }
    if (!(await ensureAgent(db, agentId))) {
      return c.json({ ok: false, error: "Agent not registered. Call register first." }, 403);
    }
    if (!(await queueExists(db, queue))) {
      return c.json({ ok: false, error: "Queue not found. Create it during registration first." }, 404);
    }
    const pointer = await produce(db, queue, String(data), agentId, { contentType, metadata });
    return c.json({ ok: true, pointer });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message || "Produce failed" }, 500);
  }
});

app.post("/api/agent/consume", async (c) => {
  try {
    const db = c.get("db");
    const body = await c.req.json();
    const { agentId, queue, maxItems, loopDetection } = body;
    if (!agentId || !queue) {
      return c.json({ ok: false, error: "缺少必填字段: agentId, queue" }, 400);
    }
    if (!(await ensureAgent(db, agentId))) {
      return c.json({ ok: false, error: "Agent not registered. Call register first." }, 403);
    }
    if (!(await queueExists(db, queue))) {
      return c.json({ ok: false, error: "Queue not found." }, 404);
    }
    const items = await consume(db, queue, agentId, maxItems || 1, { loopDetection });
    return c.json({ ok: true, items });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message || "Consume failed" }, 500);
  }
});

app.post("/api/agent/pipe", async (c) => {
  try {
    const db = c.get("db");
    const body = await c.req.json();
    const { agentId, sourceQueue, targetQueue, data, contentType, metadata } = body;
    if (!agentId || !sourceQueue || !targetQueue || data === undefined) {
      return c.json({ ok: false, error: "缺少必填字段: agentId, sourceQueue, targetQueue, data" }, 400);
    }
    if (!(await ensureAgent(db, agentId))) {
      return c.json({ ok: false, error: "Agent not registered. Call register first." }, 403);
    }
    // Pipe = consume from sourceQueue + produce to targetQueue (API compatibility)
    if (!(await queueExists(db, sourceQueue))) {
      return c.json({ ok: false, error: "Source queue not found." }, 404);
    }
    const consumed = await consume(db, sourceQueue, agentId, 1);
    if (!consumed || consumed.length === 0) {
      return c.json({ ok: false, error: "源队列无数据" }, 404);
    }
    const input = consumed[0];
    // Ensure target queue exists
    await ensureQueue(db, targetQueue, undefined, agentId);
    const output = await produce(db, targetQueue, String(data), agentId, {
      contentType,
      metadata,
      lineage: input.pointer.lineage,
    });
    return c.json({ ok: true, input, output });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message || "Pipe failed" }, 500);
  }
});

// ─── Queue API ───────────────────────────────────────────────────────────

app.get("/api/queues", async (c) => {
  try {
    const db = c.get("db");
    return c.json({ ok: true, queues: await listQueues(db) });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get("/api/peek", async (c) => {
  try {
    const db = c.get("db");
    const queue = c.req.query("queue");
    if (!queue) return c.json({ ok: false, error: "缺少 query: queue" }, 400);
    if (!(await queueExists(db, queue))) {
      return c.json({ ok: false, error: "Queue not found." }, 404);
    }
    const pointer = await peek(db, queue);
    if (!pointer) return c.json({ ok: false, error: "队列为空或不存在" }, 404);
    return c.json({ ok: true, pointer });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// ─── Pool API ────────────────────────────────────────────────────────────

app.post("/api/pool/create", async (c) => {
  try {
    const db = c.get("db");
    const body = await c.req.json();
    const { name, description, guidelines, maxMembers } = body;
    if (!name) return c.json({ ok: false, error: "缺少必填字段: name" }, 400);
    const pool = await createPool(db, name, description, guidelines, maxMembers);
    return c.json({ ok: true, pool });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message || "Pool 已存在" }, 400);
  }
});

app.get("/api/pools", async (c) => {
  try {
    const db = c.get("db");
    return c.json({ ok: true, pools: await listPools(db) });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get("/api/pool/members", async (c) => {
  try {
    const db = c.get("db");
    const pool = c.req.query("pool");
    if (!pool) return c.json({ ok: false, error: "缺少 query: pool" }, 400);
    return c.json({ ok: true, members: await listMembers(db, pool) });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get("/api/pool/messages", async (c) => {
  try {
    const db = c.get("db");
    const pool = c.req.query("pool");
    const since = c.req.query("since");
    const tag = c.req.query("tag");
    const limit = c.req.query("limit");
    if (!pool) return c.json({ ok: false, error: "缺少 query: pool" }, 400);
    const result = await getMessages(db, pool, { since, tag, limit: limit ? parseInt(limit) : undefined });
    return c.json({ ok: true, messages: result.messages, guidelines: result.guidelines });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get("/api/pool/:name", async (c) => {
  try {
    const db = c.get("db");
    const name = c.req.param("name");
    const pool = await getPool(db, name);
    if (!pool) return c.json({ ok: false, error: "Pool 不存在" }, 404);
    return c.json({ ok: true, pool });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/api/pool/join", async (c) => {
  try {
    const db = c.get("db");
    const body = await c.req.json();
    const { pool, agentId } = body;
    if (!pool || !agentId) return c.json({ ok: false, error: "缺少必填字段: pool, agentId" }, 400);
    const result = await joinPool(db, pool, agentId);
    if (!result.ok) return c.json(result, 400);
    return c.json(result);
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/api/pool/leave", async (c) => {
  try {
    const db = c.get("db");
    const body = await c.req.json();
    const { pool, agentId } = body;
    if (!pool || !agentId) return c.json({ ok: false, error: "缺少必填字段: pool, agentId" }, 400);
    await leavePool(db, pool, agentId);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/api/pool/speak", async (c) => {
  try {
    const db = c.get("db");
    const body = await c.req.json();
    const { pool, agentId, content, replyTo, tags, metadata } = body;
    if (!pool || !agentId || !content) return c.json({ ok: false, error: "缺少必填字段: pool, agentId, content" }, 400);
    const msg = await speak(db, pool, agentId, content, { replyTo, tags, metadata });
    if ("error" in msg) return c.json({ ok: false, error: msg.error }, 403);
    return c.json({ ok: true, message: msg });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// ─── A2A Protocol Routes ─────────────────────────────────────────────────

app.get("/.well-known/agent-card.json", (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    name: "LiteHub",
    version: "2.0.0",
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

// A2A Tasks
app.get("/api/a2a/tasks", async (c) => {
  try {
    const db = c.get("db");
    return c.json({ ok: true, tasks: await listTasks(db) });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/api/a2a/tasks", async (c) => {
  try {
    const db = c.get("db");
    const b = await c.req.json();
    const { agentId, targetAgentId, name, input, taskId } = b;
    if (!agentId) return c.json({ ok: false, error: "Missing agentId" }, 400);
    const result = await createTask(db, { agentId, targetAgentId, name, input, taskId });
    if (!result.ok) return c.json(result, 403);
    return c.json(result);
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get("/api/a2a/tasks/pushNotificationConfig", async (c) => {
  try {
    const db = c.get("db");
    const agentId = c.req.query("agentId");
    if (!agentId) return c.json({ ok: false, error: "Missing agentId" }, 400);
    const result = await getPushNotification(db, agentId);
    return c.json({ ok: true, subscriptions: result });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get("/api/a2a/tasks/:id", async (c) => {
  try {
    const db = c.get("db");
    const task = await getTask(db, c.req.param("id"));
    if (!task) return c.json({ ok: false, error: "Task not found" }, 404);
    return c.json({ ok: true, task });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/api/a2a/tasks/cancel", async (c) => {
  try {
    const db = c.get("db");
    const b = await c.req.json();
    if (!b.agentId || !b.taskId) return c.json({ ok: false, error: "Missing agentId or taskId" }, 400);
    const result = await cancelTask(db, b.taskId, b.agentId);
    return c.json(result);
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/api/a2a/tasks/pushNotificationConfig/set", async (c) => {
  try {
    const db = c.get("db");
    const b = await c.req.json();
    if (!b.agentId || !b.webhookUrl) return c.json({ ok: false, error: "Missing agentId or webhookUrl" }, 400);
    const result = await setPushNotification(db, { agentId: b.agentId, webhookUrl: b.webhookUrl, taskId: b.taskId, secret: b.secret });
    return c.json(result);
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/api/a2a/tasks/update", async (c) => {
  try {
    const db = c.get("db");
    const b = await c.req.json();
    if (!b.taskId || !b.agentId || !b.status) return c.json({ ok: false, error: "Missing taskId, agentId, or status" }, 400);
    const result = await updateTask(db, b.taskId, b.agentId, b.status);
    if (!result.ok) return c.json(result, 400);
    return c.json(result);
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// ─── Webhook Test Endpoint ───────────────────────────────────────────────

app.post("/api/webhook/test", async (c) => {
  try {
    const db = c.get("db");
    const payload = await c.req.json().catch(() => ({}));
    await logWebhook(db, JSON.stringify(payload), JSON.stringify(c.req.header()));
    return c.json({ ok: true, received: true });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get("/api/webhook/test", async (c) => {
  try {
    const db = c.get("db");
    const logs = await getWebhookLogs(db, 20);
    return c.json({ ok: true, logs });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// ─── ACP Protocol Routes ─────────────────────────────────────────────────

// ACP Runs
app.get("/api/acp/runs", async (c) => {
  try {
    const db = c.get("db");
    return c.json({ ok: true, runs: await listRuns(db) });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/api/acp/runs", async (c) => {
  try {
    const db = c.get("db");
    const b = await c.req.json();
    const { agentId, runId, name } = b;
    if (!agentId) return c.json({ ok: false, error: "Missing agentId" }, 400);
    const result = await createRun(db, { agentId, runId, name });
    if (!result.ok) return c.json(result, 403);
    return c.json(result);
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// ACP Run SSE stream
app.get("/api/acp/runs/:id/stream", async (c) => {
  try {
    const db = c.get("db");
    const runId = c.req.param("id");
    const run = await getRun(db, runId);
    if (!run) return c.json({ ok: false, error: "Run not found" }, 404);

    const poolName = `acp:${runId}`;
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let lastCount = 0;
        let closed = false;

        // Initial snapshot
        (async () => {
          const { messages: msgs } = await getMessages(db, poolName, { limit: 100 });
          lastCount = msgs.length;
          const initData = { type: 'init', runId, messageCount: lastCount, messages: msgs };
          controller.enqueue(encoder.encode(`event: init\ndata: ${JSON.stringify(initData)}\n\n`));
        })();

        // Poll every 2s
        const interval = setInterval(async () => {
          if (closed) { clearInterval(interval); return; }
          try {
            const { messages: current } = await getMessages(db, poolName, { limit: 100 });
            if (current.length > lastCount) {
              const newMsgs = current.slice(lastCount);
              controller.enqueue(encoder.encode(`event: messages\ndata: ${JSON.stringify({ type: 'messages', runId, newMessages: newMsgs })}\n\n`));
              lastCount = current.length;
            }
            controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
          } catch { /* ignore poll errors */ }
        }, 2000);

        // Cleanup
        c.req.raw.signal.addEventListener('abort', () => {
          closed = true;
          clearInterval(interval);
          try { controller.close(); } catch {}
        });

        // Auto-close after 5 min
        setTimeout(() => {
          closed = true;
          clearInterval(interval);
          try {
            controller.enqueue(encoder.encode(`event: close\ndata: {"type":"timeout"}\n\n`));
            controller.close();
          } catch {}
        }, 5 * 60 * 1000);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get("/api/acp/runs/:id", async (c) => {
  try {
    const db = c.get("db");
    const runId = c.req.param("id");
    const run = await getRun(db, runId);
    if (!run) return c.json({ ok: false, error: "Run not found" }, 404);
    return c.json({ ok: true, runId, run });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/api/acp/runs/cancel", async (c) => {
  try {
    const db = c.get("db");
    const b = await c.req.json();
    if (!b.agentId || !b.runId) return c.json({ ok: false, error: "Missing agentId or runId" }, 400);
    const result = await cancelRun(db, b.runId, b.agentId);
    return c.json(result);
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// ACP Contexts
app.get("/api/acp/contexts", async (c) => {
  try {
    const db = c.get("db");
    return c.json({ ok: true, contexts: await listContexts(db) });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/api/acp/contexts", async (c) => {
  try {
    const db = c.get("db");
    const b = await c.req.json();
    const { agentId, contextId, name, guidelines } = b;
    if (!agentId) return c.json({ ok: false, error: "Missing agentId" }, 400);
    const result = await createContext(db, { agentId, contextId, name, guidelines });
    if (!result.ok) return c.json(result, 403);
    return c.json(result);
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get("/api/acp/contexts/:id", async (c) => {
  try {
    const db = c.get("db");
    const contextId = c.req.param("id");
    const context = await getContext(db, contextId);
    if (!context) return c.json({ ok: false, error: "Context not found" }, 404);
    return c.json({ ok: true, contextId, context });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get("/api/acp/contexts/:id/messages", async (c) => {
  try {
    const db = c.get("db");
    const contextId = c.req.param("id");
    const result = await getContextMessages(db, contextId);
    return c.json({ ok: true, contextId, messages: result.messages });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/api/acp/contexts/:id/join", async (c) => {
  try {
    const db = c.get("db");
    const contextId = c.req.param("id");
    const b = await c.req.json();
    const { agentId } = b;
    if (!agentId) return c.json({ ok: false, error: "Missing agentId" }, 400);
    const result = await joinContext(db, contextId, agentId);
    if (!result.ok) return c.json(result, 400);
    return c.json({ ok: true, contextId, agentId });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/api/acp/contexts/:id/leave", async (c) => {
  try {
    const db = c.get("db");
    const contextId = c.req.param("id");
    const b = await c.req.json();
    const { agentId } = b;
    if (!agentId) return c.json({ ok: false, error: "Missing agentId" }, 400);
    const result = await leaveContext(db, contextId, agentId);
    if (!result.ok) return c.json(result, 400);
    return c.json({ ok: true, contextId, agentId });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/api/acp/contexts/:id/speak", async (c) => {
  try {
    const db = c.get("db");
    const contextId = c.req.param("id");
    const b = await c.req.json();
    const { agentId, content, replyTo, tags, metadata } = b;
    if (!agentId || !content) return c.json({ ok: false, error: "Missing agentId or content" }, 400);
    const result = await speakContext(db, contextId, agentId, content, { replyTo, tags, metadata });
    if (!result.ok) return c.json({ ok: false, error: result.error }, 403);
    return c.json({ ok: true, contextId, id: result.id });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// ACP Agents discovery
app.get("/api/acp/agents", async (c) => {
  try {
    const db = c.get("db");
    return c.json({ ok: true, agents: await listAgents(db) });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get("/api/acp/agents/:agentId", async (c) => {
  try {
    const db = c.get("db");
    const agentId = c.req.param("agentId");
    const agent = await getACPAgent(db, agentId);
    if (!agent) return c.json({ ok: false, error: "Agent not found" }, 404);
    return c.json({ ok: true, agent });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});
