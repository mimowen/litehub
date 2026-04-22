# LiteHub Vercel 部署踩坑指南

> 记录从 2026-04-22 下午开始的 Vercel 部署调试全过程，供后续项目参考。

---

## 项目背景

**LiteHub** 是一个基于文件指针的分布式队列管道系统，技术栈：
- Hono (Web 框架)
- SQLite (better-sqlite3 本地版 / Turso 云端版)
- TypeScript

目标：一套代码，多平台部署（本地/VPS/Docker/Vercel/Cloudflare Workers）

---

## 坑 #1：原生模块无法在 Vercel Serverless 运行

### 错误现象
```
Error: Cannot find module '/var/task/src/lib/queue'
```

### 根因
`better-sqlite3` 是原生 C++ 模块，依赖 Node.js 本地编译环境。Vercel 的 Serverless 环境无法运行这种模块。

### 解决方案
**多运行时适配策略：**
| 平台 | 数据库 | 适配器文件 |
|------|--------|-----------|
| 本地/VPS/Docker | better-sqlite3 | `src/app.ts` + `src/lib/queue.ts` |
| Vercel | Turso (libsql) | `api/hello.ts` (独立文件，零依赖) |
| Cloudflare Workers | D1 | `src/adapters/cf-workers.ts` |

### 关键教训
- 不要把 `better-sqlite3` 放在 `dependencies`，移到 `optionalDependencies`
- Vercel 版本必须完全自包含，不能引用 `src/` 下的任何文件

---

## 坑 #2：Vercel 把项目当静态站处理（404 + 无 Build Log）

### 错误现象
- 访问 `/api/hello` 返回 404
- Vercel Dashboard 里没有 Build Log（说明根本没触发构建）

### 尝试过的错误方案

#### ❌ 错误 1：使用 hono/vercel 适配器
```ts
// api/[[...route]].ts - 错误的写法
import { handle } from 'hono/vercel'
import app from '../src/app'
export default handle(app)
```
**问题**：Vercel 不识别这种格式，且引用了 `src/` 下的文件。

#### ❌ 错误 2：复杂的 vercel.json
```json
{
  "framework": null,
  "builds": [
    { "src": "api/**/*.ts", "use": "@vercel/node" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/$1" }
  ]
}
```
**问题**：`builds` 和 `routes` 是 legacy 配置，新版 Vercel 已不推荐。

#### ❌ 错误 3：framework 预设为 "hono"
```json
{ "framework": "hono" }
```
**问题**：Vercel 会去找根目录的 `app.ts` 作为入口，但我们的结构是 `api/hello.ts`。

#### ❌ 错误 4：`.vercelignore` 忽略 src/
```
src/
```
**问题**：虽然意图是让 Vercel 不编译 src/，但这也导致 Vercel 完全找不到入口文件。

---

## 坑 #3：Vercel Functions 的正确格式

### 核心发现
Vercel Functions 使用 **标准 Web API** 的 fetch 签名，不需要任何框架适配器：

```ts
// api/hello.ts - ✅ 正确的写法
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('Hello from LiteHub!')
  }
}
```

### 关键区别
| 方式 | 是否可行 | 说明 |
|------|---------|------|
| `export default { fetch() }` | ✅ 推荐 | 标准 Web API，零依赖 |
| `export default handle(app)` | ❌ 不推荐 | Hono 适配器，容易出问题 |
| `export default app.fetch` | ⚠️ 可能可行 | 需要测试 |

---

## 坑 #4：Framework 预设的缓存问题

### 错误现象
即使删除了 `vercel.json`，Vercel 仍然报错 "No entrypoint found" 或 404。

### 根因
Vercel 项目设置里缓存了 `framework: "hono"`，需要手动清除。

### 解决方案
**在 Vercel Dashboard 里：**
1. 进入项目 Settings → General
2. 找到 "Framework Preset"
3. 设置为 "Other"（不是 "Hono"，不是 "Next.js"）
4. 或者设置为 null（命令行：`vercel --framework=null`）

---

## 坑 #5：本地构建 vs 云端部署的差异

### 本地构建成功，云端 404
```bash
vercel build  # 本地成功
vercel deploy # 云端 404
```

### 根因分析
检查 `.vercel/output/config.json`：
```json
{
  "routes": [
    { "src": "^/api(/.*)?$", "status": 404 },  // ❌ 这个规则拦截了所有 /api 请求
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/$1" }
  ]
}
```

**问题**：当 framework 预设错误时，Vercel 会生成一个 404 规则拦截 `/api` 路由。

### 正确的 config.json 应该长这样
```json
{
  "version": 3,
  "routes": [
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/$1" }
  ]
}
```

---

## 最终正确的项目结构

```
litehub/
├── api/
│   └── hello.ts          # Vercel Function 入口（完全自包含）
├── index.html            # 静态首页
├── src/                  # 本地开发代码（Vercel 忽略）
│   ├── app.ts
│   └── lib/
│       └── queue.ts
├── package.json
└── .gitignore
```

**不需要的文件：**
- ❌ `vercel.json`（让 Vercel 自动检测）
- ❌ `.vercelignore`（不需要，src/ 不会被自动部署）
- ❌ `app.ts` 在根目录（Vercel 会误以为是入口）

---

## 正确的 api/hello.ts 模板

```typescript
// api/hello.ts
// Vercel Function 入口 - 完全自包含，不引用 src/ 下的任何文件

import { createClient } from '@libsql/client/web'

// Turso 数据库配置（Vercel 环境变量）
const TURSO_URL = process.env.TURSO_URL
const TURSO_TOKEN = process.env.TURSO_TOKEN

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    
    // 路由分发
    if (url.pathname === '/api/hello') {
      return new Response(JSON.stringify({
        message: 'Hello from LiteHub on Vercel!',
        time: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    if (url.pathname === '/api/status') {
      // 数据库健康检查
      if (!TURSO_URL) {
        return new Response(JSON.stringify({ error: 'TURSO_URL not set' }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      
      try {
        const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN })
        const rs = await client.execute('SELECT 1')
        return new Response(JSON.stringify({ 
          status: 'ok', 
          db: 'connected',
          result: rs.rows 
        }), {
          headers: { 'Content-Type': 'application/json' }
        })
      } catch (e) {
        return new Response(JSON.stringify({ 
          status: 'error', 
          message: String(e) 
        }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }
    
    return new Response('Not Found', { status: 404 })
  }
}
```

---

## 部署 checklist

```bash
# 1. 安装 Vercel CLI
npm i -g vercel

# 2. 登录（如果还没登录）
vercel login

# 3. 本地构建测试
vercel build

# 4. 检查输出目录
ls .vercel/output/functions/api/hello.func/

# 5. 部署
vercel deploy

# 6. 验证
open https://your-project.vercel.app/
open https://your-project.vercel.app/api/hello
```

---

## 关键教训总结

1. **不要用框架适配器**：Hono/Next.js 的适配器在 Vercel 上容易出问题，直接用标准 Web API
2. **完全自包含**：`api/` 下的文件不能引用 `src/` 下的代码
3. **删除 vercel.json**：让 Vercel 自动检测，除非你真的需要特殊配置
4. **检查 framework preset**：Vercel Dashboard 里的设置会覆盖本地配置
5. **本地构建验证**：`vercel build` 成功不代表云端能跑，要看生成的 `config.json`
6. **GitHub push 有限制**：频繁试错会被 GitHub 限流，尽量本地测试通过再 push

---

## 参考链接

- Vercel Functions 文档：https://vercel.com/docs/functions
- Turso 文档：https://docs.turso.tech/
- Hono 适配器源码（仅供参考）：https://github.com/honojs/hono/tree/main/src/adapter/vercel

---

*文档生成时间：2026-04-23*
*项目：https://github.com/mimowen/litehub*
