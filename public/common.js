const LONG_PRESS_DURATION = 600;
function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function headers(){const h={'Content-Type':'application/json'};const t=localStorage.getItem('litehub_token');if(t)h['Authorization']='Bearer '+t;return h}
function logout(){localStorage.removeItem('litehub_token');location.href='/login'}
function checkAuth(){if(!localStorage.getItem('litehub_token'))location.href='/login'}
function getQueues(a){return Array.isArray(a.queues)?a.queues:(typeof a.queues==='string'?JSON.parse(a.queues):[])}
function getPools(a){return Array.isArray(a.pools)?a.pools:(typeof a.pools==='string'?JSON.parse(a.pools):[])}

function showDeleteDialog(title,message,onConfirm){
  const container=document.getElementById('dialog-container');
  container.innerHTML='<div class="dialog-overlay" onclick="closeDialog()"><div class="dialog" onclick="event.stopPropagation()"><h3>'+escapeHtml(title)+'</h3><p>'+escapeHtml(message)+'</p><div class="dialog-buttons"><button class="btn-cancel" onclick="closeDialog()">取消</button><button class="btn-danger" id="confirm-delete-btn">删除</button></div></div></div>';
  document.getElementById('confirm-delete-btn').onclick=async()=>{closeDialog();await onConfirm()};
}
function closeDialog(){document.getElementById('dialog-container').innerHTML=''}

let longPressTimer=null;
function startLongPress(event,el,type,handlers){
  event.preventDefault();
  longPressTimer=setTimeout(()=>{if(handlers[type])handlers[type](el)},LONG_PRESS_DURATION);
}
function cancelLongPress(){if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null}}

function initAutoRefresh(loadFn){
  let interval=null;
  const sel=document.getElementById('refresh-select');
  function set(seconds){
    if(interval){clearInterval(interval);interval=null}
    if(seconds>0){interval=setInterval(loadFn,seconds*1000);localStorage.setItem('litehub_refresh',seconds)}
    else{localStorage.setItem('litehub_refresh','0')}
  }
  sel.onchange=()=>set(parseInt(sel.value));
  const saved=parseInt(localStorage.getItem('litehub_refresh')||'0');
  sel.value=saved;
  if(saved>0)set(saved);
}

function navHtml(active){
  const items=[
    {href:'/dashboard.html',label:'📊 概览',id:'dashboard'},
    {href:'/queues.html',label:'🤖 队列',id:'queues'},
    {href:'/pools.html',label:'🏊 池子',id:'pools'},
    {href:'/a2a.html',label:'📋 A2A',id:'a2a'},
    {href:'/acp.html',label:'⚡ ACP',id:'acp'},
  ];
  return items.map(i=>`<a href="${i.href}" class="${i.id===active?'active':''}">${i.label}</a>`).join('');
}

function headerHtml(title,active){
  return `<div class="header"><h1>${title}</h1><div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap"><span class="status">● 在线</span><select id="refresh-select"><option value="0">手动刷新</option><option value="10">10秒</option><option value="30">30秒</option></select><button onclick="location.reload()">🔄</button><button class="btn-logout" onclick="logout()">退出</button></div></div><div class="nav">${navHtml(active)}</div>`;
}
