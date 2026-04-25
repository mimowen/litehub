# LiteHub MCP 测试指南

## 🚀 快速开始

### 1. 启动服务器（使用非 3000 端口）

```bash
# 方法 1: 使用环境变量指定端口
PORT=3001 npx tsx src/server.ts

# 方法 2: 如果 3000 端口可用，也可以使用默认端口
npx tsx src/server.ts
```

### 2. 运行测试脚本

#### 测试完整 MCP 功能
```bash
# 使用默认端口 3001
node tests/test-mcp-full.js

# 指定其他端口
node tests/test-mcp-full.js 3002
LITEHUB_PORT=3002 node tests/test-mcp-full.js
```

#### 测试认证功能
```bash
# 无认证模式（开发环境）
node tests/test-mcp-auth.js

# 带认证模式（生产环境）
LITEHUB_TOKEN=your-secret-token node tests/test-mcp-auth.js

# 指定端口和认证
LITEHUB_TOKEN=test-token LITEHUB_PORT=3001 node tests/test-mcp-auth.js
```

## 📋 测试脚本说明

### test-mcp-full.js
测试完整的 MCP over Streamable HTTP 功能：
- ✅ Initialize - 建立 MCP 会话
- ✅ tools/list - 列出所有可用工具
- ✅ tools/call - 调用工具（litehub_agents）
- ✅ 完整工作流（注册 → 生产 → 消费）
- ✅ SSE 端点验证

### test-mcp-auth.js
测试认证机制：
- ✅ 带 Bearer Token 的初始化
- ✅ 带认证的工具列表查询
- ✅ 无认证请求的拒绝验证（应返回 401）

## 🔧 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `LITEHUB_URL` | 完整的服务器 URL | `http://localhost:3001` |
| `LITEHUB_PORT` | 服务器端口（与 URL 二选一） | `3001` |
| `LITEHUB_TOKEN` | 认证 token（可选） | `my-secret-token` |

## 💡 常见场景

### 场景 1: 本地开发测试（无认证）
```bash
# Terminal 1: 启动服务器
PORT=3001 npx tsx src/server.ts

# Terminal 2: 运行测试
node tests/test-mcp-full.js
```

### 场景 2: 测试认证功能
```bash
# Terminal 1: 启动带认证的服务器
LITEHUB_TOKEN=test-token PORT=3001 npx tsx src/server.ts

# Terminal 2: 运行认证测试
LITEHUB_TOKEN=test-token node tests/test-mcp-auth.js
```

### 场景 3: 使用自定义 URL
```bash
# 直接指定完整 URL
LITEHUB_URL=http://localhost:3002 node tests/test-mcp-full.js
```

## ⚠️ 注意事项

1. **端口冲突**: 项目默认使用 3000 端口，测试脚本默认使用 3001 端口以避免冲突
2. **认证配置**: 如果服务器设置了 `LITEHUB_TOKEN`，测试时必须提供相同的 token
3. **服务器状态**: 确保在运行测试前服务器已经启动并正常运行

## 🎯 预期输出

### 成功示例（test-mcp-full.js）
```
🧪 Testing LiteHub MCP Streamable HTTP Implementation

Base URL: http://localhost:3001
MCP Endpoint: http://localhost:3001/api/mcp/sse

══════════════════════════════════════════════════════════════════════
📋 Test 1: Initialize MCP Session
✅ Initialization successful
   Protocol Version: 2024-11-05
   Server: LiteHub v2.0.0
   Session ID: xxx-xxx-xxx

📋 Test 2: List Available Tools
✅ Found 12 tools:
   1. litehub_register: ...
   ...

🎉 SUCCESS! All tests passed!
```

### 认证成功示例（test-mcp-auth.js）
```
🧪 Testing LiteHub MCP with Authentication

Token Set: ✅ Yes

📋 Test 1: Initialize MCP Session with Authentication
   Using token: test-tok...
✅ Initialization successful

📋 Test 3: Test Without Authentication (Should Fail if Token Required)
✅ Correctly rejected (401 Unauthorized)
   Authentication is working as expected!

🎉 SUCCESS! Authentication is working correctly!
```
