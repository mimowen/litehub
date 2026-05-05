import type { DbClient } from "../adapters/db/interface.js";
import { listAgents, listQueues } from "../core/queue.js";
import { listPools } from "../core/pool.js";
import { listTasks } from "../core/a2a.js";
import { listRuns } from "../core/acp.js";
import { buildMcpDiscoveryConfig } from "../utils.js";
import { ok } from "../utils/response.js";

const HTML_CACHE = new Map<string, string>();

async function fetchHtml(filename: string, baseUrl?: string): Promise<string> {
  const cacheKey = filename;
  if (HTML_CACHE.has(cacheKey)) {
    return HTML_CACHE.get(cacheKey)!;
  }

  // Edge Runtime: fetch from static files
  try {
    const url = baseUrl ? `${baseUrl}/${filename}` : `/${filename}`;
    const response = await fetch(url);
    if (response.ok) {
      const html = await response.text();
      HTML_CACHE.set(cacheKey, html);
      return html;
    }
  } catch (e) {
    console.error(`Failed to fetch ${filename}:`, e);
  }

  // Fallback: inline minimal HTML
  return getFallbackHtml(filename);
}

function getFallbackHtml(filename: string): string {
  if (filename === 'login.html') {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>LiteHub Login</title>
<style>body{font-family:system-ui;background:#0a0f0a;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh}
.container{max-width:400px;padding:2rem;text-align:center}input{width:100%;padding:0.75rem;border:1px solid #2d4a2d;border-radius:8px;background:#0f1a0f;color:#e4e4e7;margin:1rem 0}
button{width:100%;padding:0.75rem;background:#22c55e;color:#0a0f0a;border:none;border-radius:8px;font-weight:600;cursor:pointer}</style></head>
<body><div class="container"><h1>LiteHub</h1><input type="password" id="token" placeholder="Token"/><button onclick="login()">Login</button></div>
<script>function login(){const t=document.getElementById('token').value;if(!t)return;localStorage.setItem('litehub_token',t);location.href='/dashboard'}</script></body></html>`;
  }
  if (filename === 'dashboard.html') {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>LiteHub Dashboard</title>
<style>body{font-family:system-ui;background:#0a0f0a;color:#e4e4e7}.container{max-width:1200px;margin:0 auto;padding:1.5rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem}
.card{background:#0f1a0f;border:1px solid #1a2f1a;border-radius:10px;padding:1rem}
.card h3{color:#4ade80;font-size:0.9rem}.item{background:#1a2f1a;padding:0.5rem;border-radius:6px;margin:0.25rem 0;font-size:0.85rem}</style></head>
<body><div class="container"><h1>LiteHub Dashboard</h1><div class="grid">
<div class="card"><h3>Agents</h3><div id="agents">Loading...</div></div>
<div class="card"><h3>Queues</h3><div id="queues">Loading...</div></div>
<div class="card"><h3>Pools</h3><div id="pools">Loading...</div></div>
</div></div>
<script>const t=localStorage.getItem('litehub_token');if(!t)location.href='/login';
const h={'Authorization':'Bearer '+t};
async function load(){try{const[a,q,p]=await Promise.all([fetch('/api/agents',{headers:h}).then(r=>r.json()).catch(()=>({agents:[]})),fetch('/api/queues',{headers:h}).then(r=>r.json()).catch(()=>({queues:[]})),fetch('/api/pools',{headers:h}).then(r=>r.json()).catch(()=>({pools:[]}))]);document.getElementById('agents').innerHTML=a.agents?.map(x=>'<div class="item">'+x.name+'</div>').join('')||'None';document.getElementById('queues').innerHTML=q.queues?.map(x=>'<div class="item">'+x.name+'</div>').join('')||'None';document.getElementById('pools').innerHTML=p.pools?.map(x=>'<div class="item">'+x.name+'</div>').join('')||'None'}catch(e){console.error(e)}}load()</script></body></html>`;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>LiteHub</title></head><body><h1>LiteHub</h1><a href="/dashboard">Dashboard</a></body></html>`;
}

export async function getLoginHtml(baseUrl?: string): Promise<string> {
  return fetchHtml('login.html', baseUrl);
}

export async function getDashboardHtml(baseUrl?: string): Promise<string> {
  return fetchHtml('dashboard.html', baseUrl);
}

export async function getHomeHtml(baseUrl?: string): Promise<string> {
  return fetchHtml('index.html', baseUrl);
}

export async function getHomePageHtml(baseUrl?: string): Promise<string> {
  return getHomeHtml(baseUrl);
}

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

export async function handleSkillDownload(baseUrl?: string) {
  const content = await fetchHtml('skills/litehub.md', baseUrl);
  return { ok: true, contentType: 'text/markdown', content };
}

export async function handleSkillList() {
  return ok([{ name: 'litehub', description: 'LiteHub - Agent collaboration pipeline', version: '0.1.0' }]);
}

export async function handleMcpDiscovery(baseUrl: string) {
  return buildMcpDiscoveryConfig(baseUrl);
}

export const mcpFallback = { error: "MCP SSE requires Node.js runtime.", status: 501 };

export function getApiInfo() {
  return {
    name: "LiteHub",
    version: "0.2.0",
    description: "Lightweight Agent Collaboration Pipeline",
    endpoints: { agents: "/api/agents", queues: "/api/queues", pools: "/api/pools", a2a: "/api/a2a", acp: "/api/acp", mcp: "/api/mcp" },
  };
}

export function getAgentCard(baseUrl: string) {
  return {
    name: "LiteHub",
    description: "Lightweight Agent Collaboration Pipeline",
    url: baseUrl,
    version: "0.2.0",
    capabilities: {
      queue: { produce: `${baseUrl}/api/agent/produce`, consume: `${baseUrl}/api/agent/consume`, register: `${baseUrl}/api/agent/register` },
      pool: { create: `${baseUrl}/api/pool/create`, join: `${baseUrl}/api/pool/join`, speak: `${baseUrl}/api/pool/speak` },
      a2a: true, acp: true, mcp: { endpoint: `${baseUrl}/api/mcp` },
    },
    endpoints: { a2a: `${baseUrl}/a2a`, acp: `${baseUrl}/api/acp`, mcp: `${baseUrl}/api/mcp` },
  };
}
