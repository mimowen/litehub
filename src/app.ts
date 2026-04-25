// src/index.ts — Hono 主入口（纯 app 定义，无平台特定代码）
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { bearerAuth } from "hono/bearer-auth";
import { handleStreamableHTTP, handleSSE } from "./lib/mcp-handler.js";
import {
  registerAgent, getAgent, listAgents,
  ensureQueue, getQueueStatus, listQueues,
  produce, consume, peek, pipe,
} from "./lib/queue.js";
import {
  createPool, getPool, listPools,
  joinPool, leavePool, listMembers,
  speak, getMessages,
} from "./lib/pool.js";

const app = new Hono();
export default app;

app.use("*", logger());
app.use("*", cors());

// ─── Auth (disabled when LITEHUB_TOKEN is not set) ─────────────────────
const TOKEN = process.env.LITEHUB_TOKEN || "";
const EXTRA_TOKENS = (process.env.LITEHUB_TOKENS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (TOKEN) {
  // Single token: use Hono's built-in bearerAuth
  if (EXTRA_TOKENS.length === 0) {
    app.use("/api/*", bearerAuth({ token: TOKEN }));
  } else {
    // Multiple tokens: custom middleware
    const validTokens = new Set([TOKEN, ...EXTRA_TOKENS]);
    app.use("/api/*", async (c, next) => {
      const header = c.req.header("Authorization") || "";
      const t = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!t || !validTokens.has(t)) {
        return c.json({ ok: false, error: "Unauthorized" }, 401);
      }
      await next();
    });
  }
}

// ─── Hello Landing Page ────────────────────────────────────────────────────

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

// ─── Dashboard (status page) ───────────────────────────────────────────────

app.get("/api/dashboard", (c) => {
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
      <div class="card">
        <h2>Agents</h2>
        <div id="agents">Loading...</div>
      </div>
      <div class="card">
        <h2>Queues</h2>
        <div id="queues">Loading...</div>
      </div>
      <div class="card">
        <h2>Pools</h2>
        <div id="pools">Loading...</div>
      </div>
    </div>

    <div class="section">
      <h3>Quick Test</h3>
      <input type="text" id="testQueue" placeholder="Queue name" value="test">
      <textarea id="testData" placeholder="Data to produce" rows="3">Hello from LiteHub!</textarea>
      <button onclick="produce()">Produce</button>
      <pre id="result"></pre>
    </div>
  </div>

  <script>
    const token = localStorage.getItem('litehub_token') || '';
    document.getElementById('token').value = token;

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
        const [agents, queues, pools] = await Promise.all([
          fetch('/api/agents', { headers: headers() }).then(r => r.json()),
          fetch('/api/queues', { headers: headers() }).then(r => r.json()),
          fetch('/api/pools', { headers: headers() }).then(r => r.json())
        ]);
        document.getElementById('agents').innerHTML = agents.agents?.map(a => '<div>' + a.name + ' (' + a.role + ')</div>').join('') || 'No agents';
        document.getElementById('queues').innerHTML = queues.queues?.map(q => '<div>' + q.name + '</div>').join('') || 'No queues';
        document.getElementById('pools').innerHTML = pools.pools?.map(p => '<div>' + p.name + ' (' + p.memberCount + '/' + p.maxMembers + ')</div>').join('') || 'No pools';
      } catch (e) {
        console.error(e);
      }
    }

    async function produce() {
      const queue = document.getElementById('testQueue').value;
      const data = document.getElementById('testData').value;
      const res = await fetch('/api/agent/produce', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ queue, producerId: 'dashboard', data })
      });
      const json = await res.json();
      document.getElementById('result').textContent = JSON.stringify(json, null, 2);
      loadData();
    }

    loadData();
    setInterval(loadData, 5000);
  </script>
</body>
</html>`);
});

import { join } from "path";
import { readFileSync } from "fs";

// skills/ 目录相对项目根目录
function skillDir(): string {
  return join(process.cwd(), "skills");
}

app.get("/api/skill", (c) => {
  const filePath = join(skillDir(), "litehub.md");
  try {
    const content = readFileSync(filePath, "utf-8");
    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("Content-Disposition", "attachment; filename=\"litehub.md\"");
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
    tools: [
      { name: "litehub-register", description: "注册 Agent 到队列系统" },
      { name: "litehub-produce", description: "向命名队列生产数据" },
      { name: "litehub-consume", description: "从队列消费数据 (FIFO)" },
      { name: "litehub-peek", description: "预览队首数据（不消费）" },
      { name: "litehub-pipe", description: "消费+生产一步完成" },
      { name: "litehub-pool-create", description: "创建协作 Pool" },
      { name: "litehub-pool-join", description: "加入 Pool" },
      { name: "litehub-pool-speak", description: "在 Pool 发言" },
      { name: "litehub-pool-read", description: "读取 Pool 消息" },
      { name: "litehub-agents", description: "列出所有 Agent" },
      { name: "litehub-queues", description: "列出所有队列" },
      { name: "litehub-pools", description: "列出所有 Pool" },
    ],
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

// ─── MCP Streamable HTTP / SSE Endpoint ─────────────────────────────────
// Primary endpoint supporting both Streamable HTTP (recommended) and SSE
// 
// Streamable HTTP: POST/DELETE requests for JSON-RPC communication (RECOMMENDED)
// SSE: GET requests for server-sent events (demo only)

// MCP root path - supports standard MCP protocol
app.get("/mcp", (c) => {
  // GET request: return SSE stream with initialization message
  return handleSSE(c);
});

app.post("/mcp", (c) => {
  // POST request: handle JSON-RPC via Streamable HTTP
  return handleStreamableHTTP(c);
});

app.delete("/mcp", (c) => {
  // DELETE request: close session
  return handleStreamableHTTP(c);
});

app.all("/api/mcp/sse", (c) => {
  if (c.req.method === "GET") {
    // SSE connection (demo only, not recommended for production)
    return handleSSE(c);
  }
  // Streamable HTTP (POST/DELETE) - RECOMMENDED for production
  return handleStreamableHTTP(c);
});

// ─── API Root ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

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

// ─── Agent API ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

app.post("/api/agent/register", async (c) => {
  const body = await c.req.json();
  const { agentId, name, role, queues, pollInterval } = body;
  if (!agentId || !name || !role || !queues?.length) {
    return c.json({ ok: false, error: "缺少必填字段: agentId, name, role, queues" }, 400);
  }
  const agent = registerAgent({ agentId, name, role, queues, pollInterval });
  return c.json({ ok: true, agent });
});

app.get("/api/agents", (c) => {
  return c.json({ ok: true, agents: listAgents() });
});

// ─── Produce / Consume / Pipe ──────────────────────────────────────────────

app.post("/api/agent/produce", async (c) => {
  const body = await c.req.json();
  const { agentId, queue, data, contentType, metadata } = body;
  if (!agentId || !queue || data === undefined) {
    return c.json({ ok: false, error: "缺少必填字段: agentId, queue, data" }, 400);
  }
  const pointer = produce(queue, String(data), agentId, { contentType, metadata });
  return c.json({ ok: true, pointer });
});

app.post("/api/agent/consume", async (c) => {
  const body = await c.req.json();
  const { agentId, queue, maxItems, loopDetection } = body;
  if (!agentId || !queue) {
    return c.json({ ok: false, error: "缺少必填字段: agentId, queue" }, 400);
  }
  const items = consume(queue, agentId, maxItems || 1, { loopDetection });
  return c.json({ ok: true, items });
});

app.post("/api/agent/pipe", async (c) => {
  const body = await c.req.json();
  const { agentId, sourceQueue, targetQueue, data, contentType, metadata } = body;
  if (!agentId || !sourceQueue || !targetQueue || data === undefined) {
    return c.json({ ok: false, error: "缺少必填字段: agentId, sourceQueue, targetQueue, data" }, 400);
  }
  const result = pipe(sourceQueue, targetQueue, agentId, String(data), { contentType, metadata });
  if (!result) return c.json({ ok: false, error: "源队列无数据" }, 404);
  return c.json({ ok: true, input: result.input, output: result.output });
});

// ─── Queue API ─────────────────────────────────────────────────────────────

app.get("/api/queues", (c) => {
  return c.json({ ok: true, queues: listQueues() });
});

app.get("/api/peek", (c) => {
  const queue = c.req.query("queue");
  if (!queue) return c.json({ ok: false, error: "缺少 query: queue" }, 400);
  const pointer = peek(queue);
  if (!pointer) return c.json({ ok: false, error: "队列为空或不存在" }, 404);
  return c.json({ ok: true, pointer });
});

// ─── Pool API ───────────────────────────────────────────────────────────

app.post("/api/pool/create", async (c) => {
  const body = await c.req.json();
  const { name, description, guidelines, maxMembers } = body;
  if (!name) return c.json({ ok: false, error: "缺少必填字段: name" }, 400);
  try {
    const pool = createPool(name, description, guidelines, maxMembers);
    return c.json({ ok: true, pool });
  } catch (e: any) {
    return c.json({ ok: false, error: e.message || "Pool 已存在" }, 400);
  }
});

app.get("/api/pools", (c) => {
  return c.json({ ok: true, pools: listPools() });
});

// 具体路径必须在参数路由 :name 之前，否则会被 :name 匹配
app.get("/api/pool/members", (c) => {
  const pool = c.req.query("pool");
  if (!pool) return c.json({ ok: false, error: "缺少 query: pool" }, 400);
  return c.json({ ok: true, members: listMembers(pool) });
});

app.get("/api/pool/messages", (c) => {
  const pool = c.req.query("pool");
  const since = c.req.query("since");
  const tag = c.req.query("tag");
  const limit = c.req.query("limit");
  if (!pool) return c.json({ ok: false, error: "缺少 query: pool" }, 400);
  const result = getMessages(pool, { since, tag, limit: limit ? parseInt(limit) : undefined });
  return c.json({ ok: true, messages: result.messages, guidelines: result.guidelines });
});

app.get("/api/pool/:name", (c) => {
  const name = c.req.param("name");
  const pool = getPool(name);
  if (!pool) return c.json({ ok: false, error: "Pool 不存在" }, 404);
  return c.json({ ok: true, pool });
});

app.post("/api/pool/join", async (c) => {
  const body = await c.req.json();
  const { pool, agentId } = body;
  if (!pool || !agentId) return c.json({ ok: false, error: "缺少必填字段: pool, agentId" }, 400);
  const result = joinPool(pool, agentId);
  if (!result.ok) return c.json(result, 400);
  return c.json(result);
});

app.post("/api/pool/leave", async (c) => {
  const body = await c.req.json();
  const { pool, agentId } = body;
  if (!pool || !agentId) return c.json({ ok: false, error: "缺少必填字段: pool, agentId" }, 400);
  leavePool(pool, agentId);
  return c.json({ ok: true });
});

app.post("/api/pool/speak", async (c) => {
  const body = await c.req.json();
  const { pool, agentId, content, replyTo, tags, metadata } = body;
  if (!pool || !agentId || !content) return c.json({ ok: false, error: "缺少必填字段: pool, agentId, content" }, 400);
  const msg = speak(pool, agentId, content, { replyTo, tags, metadata });
  return c.json({ ok: true, message: msg });
});

// ─── Start ─────────────────────────────────────────────────────────────────
// 各平台入口文件负责启动服务器，这里只导出 app
