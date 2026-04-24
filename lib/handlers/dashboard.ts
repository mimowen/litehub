// handlers/dashboard.ts — GET /api/dashboard (HTML UI)
export async function handleDashboard(req: Request): Promise<Response> {
  const html = `<!DOCTYPE html>
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
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" }
  });
}