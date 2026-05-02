// src/handlers/pages.ts — Page data and discovery handlers
import type { DbClient } from "../adapters/db/interface.js";
import { listAgents, listQueues } from "../core/queue.js";
import { listPools } from "../core/pool.js";
import { listTasks } from "../core/a2a.js";
import { listRuns } from "../core/acp.js";
import { buildMcpDiscoveryConfig } from "../utils.js";
import { ok } from "../utils/response.js";

export async function getDashboardData(db: DbClient) {
  const [agents, queues, pools, tasks, runs] = await Promise.all([
    listAgents(db),
    listQueues(db),
    listPools(db),
    listTasks(db, { limit: 20 }),
    listRuns(db, { limit: 20 }),
  ]);
  return { agents, queues, pools, tasks, runs };
}

export function getDashboardHtml() {
  return `<!DOCTYPE html>
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
</script></body></html>`;
}

export function getHomePageHtml(baseUrl: string) {
  return `<!DOCTYPE html>
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
<pre>curl -X POST ${baseUrl}/api/agent/register \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"searcher","name":"Search Agent","role":"producer","queues":["raw"]}'</pre>
  <h3>2. Produce Data</h3>
<pre>curl -X POST ${baseUrl}/api/agent/produce \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"searcher","queue":"raw","data":"Found: ..."}'</pre>
  <h3>3. Consume Data</h3>
<pre>curl -X POST ${baseUrl}/api/agent/consume \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"writer","queue":"raw"}'</pre>
</div>
<div class="section">
  <h2>For AI Agents — Skill</h2>
  <p>LiteHub provides a <strong>SKILL.md</strong> that any AI agent can download and use.</p>
  <div class="skill-banner">
    <h3>📄 Download the Skill</h3>
    <p>Point your AI agent to this URL:</p>
    <span class="url">${baseUrl}/skill</span>
  </div>
</div>
<footer>LiteHub is open source · <a href="https://github.com/mimowen/litehub">GitHub</a> · MIT License</footer>
</body></html>`;
}

export async function handleMcpDiscovery(baseUrl: string) {
  return buildMcpDiscoveryConfig(baseUrl);
}

export async function handleSkillDownload() {
  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(join(process.cwd(), "skills", "litehub.md"), "utf-8");
    return { content, contentType: "text/markdown; charset=utf-8" };
  } catch {
    return null;
  }
}

export function getApiInfo() {
  return {
    name: "LiteHub", version: "2.0.0",
    endpoints: { agents: "/api/agents", queues: "/api/queues", pools: "/api/pools", dashboard: "/api/dashboard", skill: "/api/skill", mcp: "/api/mcp" },
  };
}

export function getAgentCard(baseUrl: string) {
  return {
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
  };
}

export const mcpFallback = { error: "MCP protocol requires Node.js runtime.", status: 501 };

export async function handleSkillList() {
  return ok({ skills: [{ name: "litehub", file: "litehub.md", description: "LiteHub AI Agent 协作技能" }] });
}
