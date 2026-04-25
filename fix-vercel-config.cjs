// fix-vercel-config.cjs — 删除 Vercel 自动生成的错误 404 拦截规则
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '.vercel', 'output', 'config.json');

if (!fs.existsSync(configPath)) {
  console.log('⚠️  config.json not found, skipping');
  process.exit(0);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// 删除 src = ^/api(/.*)?$ 且 status = 404 的规则
const before = config.routes.length;
config.routes = config.routes.filter(r => {
  if (r.src && r.src.includes('/api(/.*)?$') && r.status === 404) {
    console.log('🗑️  Removed bad rule:', JSON.stringify(r));
    return false;
  }
  return true;
});

// 确保 ^/api/(.*)$ → /api/main 路由存在且排在其他 /api 规则之前
const hasApiRoute = config.routes.some(r => r.dest === '/api/main');
if (!hasApiRoute) {
  // 在 filesystem 之后插入
  const fsIdx = config.routes.findIndex(r => r.handle === 'filesystem');
  config.routes.splice(fsIdx + 1, 0, {
    src: '^/api/(.*)$',
    dest: '/api/main',
    check: true,
  });
  console.log('➕ Added /api/main route');
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`✅ Fixed config.json (${before} → ${config.routes.length} routes)`);
