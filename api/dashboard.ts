// api/dashboard.ts — GET /dashboard
// Serves an interactive dashboard HTML page
import { initDb, getClient } from "./_lib/turso.js";

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LiteHub — Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #09090b; --surface: #111118; --border: #1e1e2e; --text: #e4e4e7;
    --muted: #71717a; --blue: #60a5fa; --purple: #a78bfa; --green: #4ade80;
    --red: #f87171; --yellow: #fbbf24; --orange: #fb923c; --cyan: #22d3ee;
  }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  .container { max-width: 1100px; margin: 0 auto; padding: 1.5rem 1.5rem 3rem; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border); }
  h1 { font-size: 1.4rem; font-weight: 700; }
  h1 span { color: var(--blue); }
  .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
  .error-banner { background: #2d1515; border: 1px solid var(--red); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1rem; font-size: 0.85rem; color: var(--red); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; margin-bottom: 1.5rem; }
  @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem; }
  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  .card h2 { font-size: 0.95rem; color: var(--blue); display: flex; align-items: center; gap: 0.4rem; }
  .count-badge { background: var(--border); padding: 0.1rem 0.5rem; border-radius: 10px; font-size: 0.75rem; color: var(--muted); }
  .empty { color: var(--muted); font-size: 0.8rem; padding: 1.5rem 0; text-align: center; }

  /* Agents list */
  .agent-item { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem 0.85rem; margin-bottom: 0.4rem; }
  .agent-item:hover { border-color: #3b3b50; }
  .agent-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.2rem; }
  .agent-id { font-weight: 600; font-size: 0.85rem; color: var(--text); }
  .role-badge { font-size: 0.65rem; padding: 0.1rem 0.4rem; border-radius: 4px; }
  .role-producer { background: #1e3a5f; color: var(--blue); }
  .role-consumer { background: #2d1b4e; color: var(--purple); }
  .role-both { background: #1a3a2a; color: var(--green); }
  .agent-meta { font-size: 0.72rem; color: var(--muted); margin-bottom: 0.2rem; }
  .queue-tags { display: flex; flex-wrap: wrap; gap: 0.25rem; }
  .queue-tag { background: var(--border); padding: 0.05rem 0.4rem; border-radius: 4px; font-size: 0.65rem; color: var(--muted); }

  /* Queue list */
  .queue-item { display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.85rem; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 0.4rem; }
  .queue-item:hover { border-color: #3b3b50; }
  .queue-name { font-weight: 600; font-size: 0.85rem; }
  .queue-stats { display: flex; gap: 0.6rem; font-size: 0.75rem; }
  .stat-pending { color: var(--yellow); }
  .stat-consumed { color: var(--green); }
  .stat-total { color: var(--muted); }
  .queue-peek-btn { background: none; border: 1px solid var(--border); color: var(--muted); padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; cursor: pointer; }
  .queue-peek-btn:hover { border-color: var(--cyan); color: var(--cyan); }

  /* Actions panel */
  .actions { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem; }
  .actions h2 { font-size: 0.95rem; color: var(--blue); margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.75rem; }
  .form-group { display: flex; flex-direction: column; gap: 0.2rem; }
  label { font-size: 0.75rem; color: var(--muted); }
  input, select, textarea { background: var(--bg); border: 1px solid var(--border); border-radius: 7px; padding: 0.5rem 0.7rem; color: var(--text); font-size: 0.82rem; width: 100%; font-family: inherit; }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--blue); }
  textarea { resize: vertical; min-height: 72px; font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace; font-size: 0.78rem; }
  .btn-row { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
  button { padding: 0.5rem 1rem; border-radius: 7px; border: none; cursor: pointer; font-size: 0.8rem; font-weight: 600; transition: opacity 0.15s, transform 0.1s; }
  button:hover { opacity: 0.88; }
  button:active { transform: scale(0.97); }
  .btn-blue { background: var(--blue); color: #000; }
  .btn-purple { background: var(--purple); color: #000; }
  .btn-green { background: var(--green); color: #000; }
  .btn-orange { background: var(--orange); color: #000; }
  .btn-cyan { background: var(--cyan); color: #000; }
  .btn-sm { font-size: 0.72rem; padding: 0.3rem 0.7rem; background: var(--border); color: var(--muted); border: none; border-radius: 6px; cursor: pointer; }
  .btn-sm:hover { color: var(--text); }
  .btn-sm.active { background: var(--blue); color: #000; }

  /* Expandable forms */
  .expand-form { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 0.85rem; margin-bottom: 0.6rem; display: none; }
  .expand-form.show { display: block; }
  .expand-form-header { font-size: 0.8rem; color: var(--muted); margin-bottom: 0.6rem; font-weight: 600; }
  .expand-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; margin-bottom: 0.6rem; }
  .expand-form textarea { min-height: 60px; }
  .form-actions { display: flex; gap: 0.4rem; align-items: center; }
  .hint { font-size: 0.7rem; color: var(--muted); margin-top: 0.3rem; }

  /* Log area */
  .log-area { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem; font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace; font-size: 0.75rem; max-height: 180px; overflow-y: auto; white-space: pre-wrap; color: var(--muted); margin-top: 0.75rem; line-height: 1.6; }
  .log-entry { margin-bottom: 0.1rem; }
  .log-ok { color: var(--green); }
  .log-err { color: var(--red); }
  .log-info { color: var(--blue); }
  .log-warn { color: var(--yellow); }

  /* Peek modal */
  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100; align-items: center; justify-content: center; padding: 1rem; }
  .modal-overlay.show { display: flex; }
  .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; max-width: 560px; width: 100%; max-height: 80vh; overflow-y: auto; }
  .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  .modal-title { font-size: 1rem; font-weight: 700; color: var(--cyan); }
  .modal-close { background: none; border: none; color: var(--muted); font-size: 1.2rem; cursor: pointer; padding: 0; }
  .modal-close:hover { color: var(--text); }
  .modal-meta { font-size: 0.75rem; color: var(--muted); margin-bottom: 0.75rem; }
  .modal-meta span { margin-right: 1rem; }
  .modal-data { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem; font-family: monospace; font-size: 0.78rem; white-space: pre-wrap; word-break: break-all; color: var(--text); max-height: 300px; overflow-y: auto; }
  .modal-pointer { font-size: 0.7rem; color: var(--muted); margin-top: 0.5rem; font-family: monospace; }
</style>
</head>
<body>
<div class="container">
  <div class="top-bar">
    <header>
      <h1>⚡ <span>LiteHub</span> Dashboard</h1>
    </header>
    <button class="btn-sm" onclick="loadAll()">🔄 刷新</button>
    <button class="btn-sm" id="token-btn" onclick="toggleTokenInput()">🔑 Token</button>
  </div>
  <div id="token-row" style="display:none;margin-bottom:1rem">
    <input id="token-input" type="password" placeholder="Bearer Token（留空=开放模式）" style="width:70%;margin-right:0.5rem">
    <button class="btn-sm" onclick="saveToken()">💾 保存</button>
    <button class="btn-sm" onclick="clearToken()">🗑️ 清除</button>
  </div>

  <div id="error-banner" class="error-banner" style="display:none"></div>

  <div class="grid">
    <div class="card">
      <div class="card-header">
        <h2>👥 Agents <span class="count-badge" id="agent-count">-</span></h2>
      </div>
      <div id="agents-list"><div class="empty">加载中...</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <h2>📋 Queues <span class="count-badge" id="queue-count">-</span></h2>
      </div>
      <div id="queues-list"><div class="empty">加载中...</div></div>
    </div>
  </div>

  <div class="actions">
    <h2>⚡ 操作面板</h2>

    <!-- Agent info row -->
    <div class="form-row">
      <div class="form-group">
        <label>Agent ID</label>
        <input id="agentId" placeholder="e.g. searcher, writer, translator">
      </div>
      <div class="form-group">
        <label>Agent Name</label>
        <input id="agentName" placeholder="e.g. Search Agent">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Role</label>
        <select id="agentRole">
          <option value="producer">Producer（生产者）</option>
          <option value="consumer">Consumer（消费者）</option>
          <option value="both">Both（既是生产者也是消费者）</option>
        </select>
      </div>
      <div class="form-group">
        <label>Queues（逗号分隔，订阅的队列）</label>
        <input id="agentQueues" placeholder="e.g. raw, summaries, drafts">
      </div>
    </div>

    <div class="btn-row">
      <button class="btn-blue" onclick="registerAgent()">📋 注册 Agent</button>
      <button class="btn-purple" onclick="toggleForm('produce')">📤 Produce（生产数据）</button>
      <button class="btn-green" onclick="toggleForm('consume')">📥 Consume（消费数据）</button>
      <button class="btn-orange" onclick="toggleForm('pipe')">🔀 Pipe（消费+生产）</button>
    </div>

    <!-- Produce form -->
    <div id="form-produce" class="expand-form">
      <div class="expand-form-header">📤 Produce — 推送数据到队列</div>
      <div class="expand-form-row">
        <div class="form-group">
          <label>目标队列</label>
          <input id="produceQueue" placeholder="queue name">
        </div>
        <div class="form-group">
          <label>Content-Type</label>
          <input id="produceContentType" placeholder="text/plain">
        </div>
      </div>
      <div class="form-group">
        <label>数据内容</label>
        <textarea id="produceData" placeholder="要发送的数据..."></textarea>
      </div>
      <div class="form-actions">
        <button class="btn-purple" onclick="doProduce()">🚀 发送</button>
        <button class="btn-sm" onclick="toggleForm('produce')">取消</button>
      </div>
    </div>

    <!-- Consume form -->
    <div id="form-consume" class="expand-form">
      <div class="expand-form-header">📥 Consume — 从队列拉取数据（会标记为已消费）</div>
      <div class="expand-form-row">
        <div class="form-group">
          <label>源队列</label>
          <input id="consumeQueue" placeholder="queue name">
        </div>
        <div class="form-group">
          <label>最大数量</label>
          <input id="consumeMaxItems" type="number" value="1" min="1" max="100" placeholder="1">
        </div>
      </div>
      <div class="form-actions">
        <button class="btn-green" onclick="doConsume()">🚀 消费</button>
        <button class="btn-sm" onclick="toggleForm('consume')">取消</button>
      </div>
    </div>

    <!-- Pipe form -->
    <div id="form-pipe" class="expand-form">
      <div class="expand-form-header">🔀 Pipe — 从源队列消费，同时推送到目标队列（一步完成，支持溯源）</div>
      <div class="expand-form-row">
        <div class="form-group">
          <label>源队列（消费）</label>
          <input id="pipeSourceQueue" placeholder="source queue name">
        </div>
        <div class="form-group">
          <label>目标队列（生产）</label>
          <input id="pipeTargetQueue" placeholder="target queue name">
        </div>
      </div>
      <div class="form-group">
        <label>要写入目标队列的数据</label>
        <textarea id="pipeData" placeholder="处理后的数据（会携带源队列溯源信息）..."></textarea>
      </div>
      <div class="form-actions">
        <button class="btn-orange" onclick="doPipe()">🚀 执行 Pipe</button>
        <button class="btn-sm" onclick="toggleForm('pipe')">取消</button>
      </div>
      <div class="hint">Pipe 会在 metadata 中自动记录 sourcePointerId 和 sourceQueue，支持全链路溯源</div>
    </div>

    <div class="log-area" id="log"><span class="log-entry log-info">Ready. 操作完成后会自动刷新状态。</span></div>
  </div>
</div>

<!-- Peek Modal -->
<div class="modal-overlay" id="peek-modal">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title">👀 Peek — 预览队首</span>
      <button class="modal-close" onclick="closePeekModal()">×</button>
    </div>
    <div class="modal-meta" id="peek-meta"></div>
    <div class="modal-data" id="peek-data"></div>
    <div class="modal-pointer" id="peek-pointer"></div>
  </div>
</div>

<script>
const API = '';
const AUTH_KEY = 'litehub-auth-token';

function getToken() {
  return localStorage.getItem(AUTH_KEY) || '';
}

function log(msg, type='info') {
  const el = document.getElementById('log');
  const ts = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'log-entry log-' + type;
  entry.textContent = '[' + ts + '] ' + msg;
  el.appendChild(entry);
  el.scrollTop = el.scrollHeight;
}

function showError(msg) {
  const b = document.getElementById('error-banner');
  b.textContent = '⚠ ' + msg;
  b.style.display = 'block';
  log(msg, 'err');
}

function clearError() { document.getElementById('error-banner').style.display = 'none'; }

function toggleForm(name) {
  const el = document.getElementById('form-' + name);
  const wasVisible = el.classList.contains('show');
  // Hide all
  ['produce','consume','pipe'].forEach(n => {
    document.getElementById('form-' + n).classList.remove('show');
  });
  if (!wasVisible) el.classList.add('show');
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  const token = getToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  if (!r.ok) {
    const err = await r.text().catch(() => r.statusText);
    throw new Error(path + ' → ' + r.status + ': ' + err);
  }
  return r.json();
}

// ---- Load data ----
async function loadAgents() {
  try {
    const res = await api('GET', '/api/agents');
    const agents = res.agents || [];
    document.getElementById('agent-count').textContent = agents.length;
    const el = document.getElementById('agents-list');
    if (!agents.length) {
      el.innerHTML = '<div class="empty">暂无 Agent，请先注册</div>';
    } else {
      el.innerHTML = agents.map(a => '<div class="agent-item">' +
        '<div class="agent-top">' +
          '<span class="agent-id">' + esc(a.agentId) + '</span>' +
          '<span class="role-badge role-' + esc(a.role) + '">' + esc(a.role) + '</span>' +
        '</div>' +
        '<div class="agent-meta">' + esc(a.name || '') + ' · ' + (a.registeredAt ? esc(a.registeredAt).slice(0,16).replace('T',' ') : '') + '</div>' +
        '<div class="queue-tags">' + (JSON.parse(a.queues||'[]').map(q=>'<span class="queue-tag">'+esc(q)+'</span>').join('')) + '</div>' +
      '</div>').join('');
    }
  } catch(e) { document.getElementById('agents-list').innerHTML = '<div class="empty">加载失败: ' + esc(e.message) + '</div>'; }
}

async function loadQueues() {
  try {
    const res = await api('GET', '/api/queues');
    const queues = res.queues || [];
    document.getElementById('queue-count').textContent = queues.length;
    const el = document.getElementById('queues-list');
    if (!queues.length) {
      el.innerHTML = '<div class="empty">暂无队列，注册 Agent 后自动创建</div>';
    } else {
      el.innerHTML = queues.map(q => '<div class="queue-item">' +
        '<span class="queue-name">' + esc(q.name) + '</span>' +
        '<div class="queue-stats">' +
          '<span class="stat-pending">⏳ ' + (q.pending||0) + '</span>' +
          '<span class="stat-consumed">✅ ' + (q.consumed||0) + '</span>' +
          '<span class="stat-total">' + ((q.pending||0)+(q.consumed||0)) + ' 条</span>' +
          '<button class="queue-peek-btn" onclick="peekQueue(\'' + esc(q.name) + '\')">👀 peek</button>' +
        '</div>' +
      '</div>').join('');
    }
  } catch(e) { document.getElementById('queues-list').innerHTML = '<div class="empty">加载失败: ' + esc(e.message) + '</div>'; }
}

async function loadAll() {
  clearError();
  await Promise.all([loadAgents(), loadQueues()]);
}

// ---- Actions ----
async function registerAgent() {
  const id = document.getElementById('agentId').value.trim();
  const name = document.getElementById('agentName').value.trim();
  const role = document.getElementById('agentRole').value;
  const queues = document.getElementById('agentQueues').value.split(',').map(q=>q.trim()).filter(Boolean);
  if (!id) { log('⚠ Agent ID 不能为空', 'warn'); return; }
  if (!name) { log('⚠ Agent Name 不能为空', 'warn'); return; }
  try {
    log('注册 Agent: ' + id);
    const res = await api('POST', '/api/agent/register', { agentId: id, name, role, queues });
    if (res.ok) {
      log('✅ Agent ' + id + ' 注册成功', 'ok');
      await loadAll();
    } else {
      log('❌ 注册失败: ' + (res.error || '未知错误'), 'err');
    }
  } catch(e) { log('❌ ' + e.message, 'err'); }
}

async function doProduce() {
  const queue = document.getElementById('produceQueue').value.trim();
  const data = document.getElementById('produceData').value;
  const contentType = document.getElementById('produceContentType').value.trim() || 'text/plain';
  const agentId = document.getElementById('agentId').value.trim() || 'dashboard';
  if (!queue) { log('⚠ 目标队列不能为空', 'warn'); return; }
  if (!data) { log('⚠ 数据内容不能为空', 'warn'); return; }
  try {
    log('📤 Producing to [' + queue + ']...');
    const res = await api('POST', '/api/agent/produce', { agentId, queue, data, contentType });
    if (res.ok) {
      log('✅ 已推送至 [' + queue + ']，pointer id: ' + (res.pointer && res.pointer.id ? res.pointer.id.slice(0,8) : '?') + '...', 'ok');
      document.getElementById('form-produce').classList.remove('show');
      await loadAll();
    } else {
      log('❌ Produce 失败: ' + (res.error || '未知错误'), 'err');
    }
  } catch(e) { log('❌ ' + e.message, 'err'); }
}

async function doConsume() {
  const queue = document.getElementById('consumeQueue').value.trim();
  const maxItems = parseInt(document.getElementById('consumeMaxItems').value) || 1;
  const agentId = document.getElementById('agentId').value.trim() || 'dashboard';
  if (!queue) { log('⚠ 源队列不能为空', 'warn'); return; }
  try {
    log('📥 Consuming from [' + queue + ']...');
    const res = await api('POST', '/api/agent/consume', { agentId, queue, maxItems });
    if (res.ok && res.items && res.items.length > 0) {
      const item = res.items[0];
      const preview = item.text ? item.text.slice(0, 120) : (item.data ? '[base64: ' + item.data.slice(0,20) + '...]' : '');
      log('✅ 消费 [' + queue + ']: ' + preview + (item.text && item.text.length > 120 ? '...' : ''), 'ok');
      document.getElementById('form-consume').classList.remove('show');
      await loadAll();
    } else {
      log('📭 队列 [' + queue + '] 为空，无数据可消费', 'warn');
    }
  } catch(e) { log('❌ ' + e.message, 'err'); }
}

async function doPipe() {
  const sourceQueue = document.getElementById('pipeSourceQueue').value.trim();
  const targetQueue = document.getElementById('pipeTargetQueue').value.trim();
  const data = document.getElementById('pipeData').value;
  const agentId = document.getElementById('agentId').value.trim() || 'dashboard';
  if (!sourceQueue) { log('⚠ 源队列不能为空', 'warn'); return; }
  if (!targetQueue) { log('⚠ 目标队列不能为空', 'warn'); return; }
  if (!data) { log('⚠ 数据内容不能为空', 'warn'); return; }
  try {
    log('🔀 Pipping [' + sourceQueue + '] → [' + targetQueue + ']...');
    const res = await api('POST', '/api/agent/pipe', { agentId, sourceQueue, targetQueue, data });
    if (res.ok) {
      const inputId = res.input && res.input.id ? res.input.id.slice(0,8) : '?';
      const outputId = res.output && res.output.id ? res.output.id.slice(0,8) : '?';
      log('✅ Pipe 成功: consumed ' + inputId + '... → produced ' + outputId + '...', 'ok');
      document.getElementById('form-pipe').classList.remove('show');
      await loadAll();
    } else {
      log('❌ Pipe 失败: ' + (res.error || '源队列可能为空'), 'err');
    }
  } catch(e) { log('❌ ' + e.message, 'err'); }
}

async function peekQueue(queueName) {
  try {
    log('👀 Peeking at [' + queueName + ']...');
    const res = await api('GET', '/api/peek?queue=' + encodeURIComponent(queueName));
    if (res.ok && res.pointer) {
      // Get full data via consume then restore (or just show what we have)
      const p = res.pointer;
      document.getElementById('peek-meta').innerHTML =
        '<span>Queue: <b>' + esc(queueName) + '</b></span>' +
        '<span>Producer: ' + esc(p.producerId || '') + '</span>' +
        '<span>Size: ' + (p.size||0) + ' bytes</span>' +
        '<span>Created: ' + (p.createdAt ? esc(p.createdAt).replace('T',' ').slice(0,16) : '') + '</span>';
      document.getElementById('peek-data').textContent = '(需要 consume 才能获取数据内容)';
      document.getElementById('peek-pointer').textContent = 'pointer id: ' + esc(p.id || '');
      document.getElementById('peek-modal').classList.add('show');
      log('👀 已打开 peek 预览（数据内容需 consume 后可见）', 'info');
    } else {
      log('📭 队列 [' + queueName + '] 为空', 'warn');
    }
  } catch(e) { log('❌ ' + e.message, 'err'); }
}

function closePeekModal() {
  document.getElementById('peek-modal').classList.remove('show');
}

// Close modal on overlay click
document.getElementById('peek-modal').addEventListener('click', function(e) {
  if (e.target === this) closePeekModal();
});

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').<tr><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e"><code>POST</code></td><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e">/api/agent/pipe</td><td style="padding:0.4rem 0.5rem;border-bottom:1px solid #1e1e2e;color:#a1a1aa">Consume + produce in one call</td></tr>
.replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toggleTokenInput() {
  const row = document.getElementById('token-row');
  row.style.display = row.style.display === 'none' ? 'flex' : 'none';
  const input = document.getElementById('token-input');
  const existing = getToken();
  if (existing && !input.value) input.value = existing;
}

function saveToken() {
  const val = document.getElementById('token-input').value.trim();
  if (val) localStorage.setItem(AUTH_KEY, val);
  else localStorage.removeItem(AUTH_KEY);
  log(val ? '🔑 Token 已保存' : '🔑 Token 已清除', 'ok');
 loadAll();
}

function clearToken() {
  localStorage.removeItem(AUTH_KEY);
  document.getElementById('token-input').value = '';
  log('🔑 Token 已清除', 'ok');
  loadAll();
}

// Init
loadAll();
</script>
</body>
</html>`;

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    return new Response(HTML, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  },
};
