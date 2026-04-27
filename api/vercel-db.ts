// api/vercel-db.ts — Turso database client for Vercel serverless (HTTP mode)
import { createClient, type Client } from "@libsql/client/http";

let _client: Client | null = null;
let _initialized = false;

// DDL: 建表 + 缺失列的 ALTER（幂等，可重复执行）
const DDLs = [
  `CREATE TABLE IF NOT EXISTS queues (
    name TEXT PRIMARY KEY,
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    queues TEXT DEFAULT '[]',
    poll_interval INTEGER DEFAULT 0,
    registered_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS pointers (
    id TEXT PRIMARY KEY,
    queue TEXT NOT NULL,
    producer_id TEXT NOT NULL,
    data TEXT NOT NULL,
    size INTEGER NOT NULL,
    content_type TEXT DEFAULT 'text/plain',
    metadata TEXT DEFAULT '{}',
    status TEXT DEFAULT 'pending',
    lineage TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // 给已有 pointers 表补 lineage 列（ALTER TABLE 幂等写法）
  `ALTER TABLE pointers ADD COLUMN lineage TEXT DEFAULT '[]'`,
  `CREATE INDEX IF NOT EXISTS idx_pointers_queue ON pointers(queue)`,
  `CREATE INDEX IF NOT EXISTS idx_pointers_queue_status ON pointers(queue, status)`,
  `CREATE TABLE IF NOT EXISTS pools (
    name TEXT PRIMARY KEY,
    description TEXT DEFAULT '',
    guidelines TEXT DEFAULT 'You are a collaborative agent in this Pool. Share progress transparently. Reference others work. Do not command other agents.',
    max_members INTEGER DEFAULT 20,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS pool_members (
    pool TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (pool, agent_id)
  )`,
  `CREATE TABLE IF NOT EXISTS pool_messages (
    id TEXT PRIMARY KEY,
    pool TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    content TEXT NOT NULL,
    reply_to TEXT,
    tags TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pool_messages_pool ON pool_messages(pool, created_at)`,
  // 给 queues/pools 表补 creator_id 列
  `ALTER TABLE queues ADD COLUMN creator_id TEXT DEFAULT ''`,
  `ALTER TABLE pools ADD COLUMN creator_id TEXT DEFAULT ''`,
  // Push subscriptions for webhook notifications
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    subscriber_id TEXT NOT NULL,
    target_url TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'queue',
    scope_name TEXT NOT NULL,
    secret TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_push_scope ON push_subscriptions(scope, scope_name)`,
  // A2A tasks table — maps to Queue channel
  `CREATE TABLE IF NOT EXISTS a2a_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    queue TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_a2a_queue ON a2a_tasks(queue)`,
  `CREATE INDEX IF NOT EXISTS idx_a2a_agent ON a2a_tasks(agent_id)`,
  // ACP runs table — maps to Pool channel
  `CREATE TABLE IF NOT EXISTS acp_runs (
    id TEXT PRIMARY KEY,
    context_id TEXT NOT NULL,
    pool TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'participant',
    guidelines TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_acp_context ON acp_runs(context_id)`,
  `CREATE INDEX IF NOT EXISTS idx_acp_pool ON acp_runs(pool)`,
];

async function initDb(client: Client) {
  if (_initialized) return;
  for (const ddl of DDLs) {
    try {
      await client.execute(ddl);
    } catch (e: any) {
      // 忽略“列已存在”等幂等错误，其他错误抛出
      if (!e?.message?.includes('already exists') && !e?.message?.includes('duplicate column')) {
        throw e;
      }
    }
  }
  _initialized = true;
}

export async function getDb(): Promise<Client> {
  if (_client) {
    await initDb(_client);
    return _client;
  }
  const url = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL || "";
  if (!url) throw new Error("Missing TURSO_URL environment variable");
  _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || "" });
  await initDb(_client);
  return _client;
}

export function validateAuth(req: Request): boolean {
  const token = process.env.LITEHUB_TOKEN;
  const tokens = process.env.LITEHUB_TOKENS;
  if (!token && !tokens) return true; // Open mode
  const authHeader = req.headers.get("Authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (token && bearerToken === token) return true;
  if (tokens) {
    const allowed = tokens.split(",").map(t => t.trim());
    if (allowed.includes(bearerToken)) return true;
  }
  return false;
}

export function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function body(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}
