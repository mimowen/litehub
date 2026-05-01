// src/core/schema.ts — 统一数据库 DDL 定义
// 所有平台（本地/Vercel/CF Workers）共享此文件
// 任何表结构变更只改这里，各适配器自动同步

// ─── CREATE TABLE 语句（幂等，IF NOT EXISTS）───────────────────────────────

export const DDLs: string[] = [
  `CREATE TABLE IF NOT EXISTS pointers (
    id TEXT PRIMARY KEY,
    queue TEXT NOT NULL,
    producer_id TEXT NOT NULL,
    data BLOB NOT NULL,
    size INTEGER NOT NULL,
    content_type TEXT DEFAULT 'text/plain',
    metadata TEXT DEFAULT '{}',
    status TEXT DEFAULT 'pending',
    lineage TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pointers_queue_status ON pointers(queue, status)`,
  `CREATE INDEX IF NOT EXISTS idx_pointers_queue ON pointers(queue)`,

  `CREATE TABLE IF NOT EXISTS queues (
    name TEXT PRIMARY KEY,
    description TEXT DEFAULT '',
    creator_id TEXT DEFAULT '',
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

  `CREATE TABLE IF NOT EXISTS pools (
    name TEXT PRIMARY KEY,
    description TEXT DEFAULT '',
    guidelines TEXT DEFAULT 'You are a collaborative agent in this Pool. Share progress transparently. Reference others work. Do not command other agents.',
    max_members INTEGER DEFAULT 20,
    creator_id TEXT DEFAULT '',
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
  `CREATE INDEX IF NOT EXISTS idx_pool_messages_reply ON pool_messages(reply_to)`,

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

  `CREATE TABLE IF NOT EXISTS webhook_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload TEXT NOT NULL,
    headers TEXT DEFAULT '{}',
    received_at TEXT DEFAULT (datetime('now'))
  )`,
];

// ─── 安全 ALTER 语句（列已存在则跳过）────────────────────────────────────

export const ALTERS: string[] = [
  `ALTER TABLE pointers ADD COLUMN lineage TEXT DEFAULT '[]'`,
  `ALTER TABLE queues ADD COLUMN creator_id TEXT DEFAULT ''`,
  `ALTER TABLE pools ADD COLUMN creator_id TEXT DEFAULT ''`,
  `ALTER TABLE a2a_tasks ADD COLUMN description TEXT`,
  `ALTER TABLE a2a_tasks ADD COLUMN queue TEXT`,
  `ALTER TABLE a2a_tasks ADD COLUMN agent_id TEXT`,
  `ALTER TABLE a2a_tasks ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))`,
  `ALTER TABLE acp_runs ADD COLUMN context_id TEXT`,
  `ALTER TABLE acp_runs ADD COLUMN pool TEXT`,
  `ALTER TABLE acp_runs ADD COLUMN agent_id TEXT`,
  `ALTER TABLE acp_runs ADD COLUMN role TEXT DEFAULT 'participant'`,
  `ALTER TABLE acp_runs ADD COLUMN guidelines TEXT`,
  `ALTER TABLE acp_runs ADD COLUMN ended_at TEXT`,
];

// ─── Schema 初始化（各适配器调用）─────────────────────────────────────────

export interface SchemaInitResult {
  tablesCreated: number;
  altersAttempted: number;
  errors: string[];
}

/**
 * 执行 schema 初始化 — 使用 DbClient 抽象接口
 * 适用于 Turso / 任何异步 DbClient
 */
export async function initSchemaAsync(
  execute: (sql: string, args?: unknown[]) => Promise<{ rowsAffected: number }>,
): Promise<SchemaInitResult> {
  const errors: string[] = [];
  let tablesCreated = 0;
  let altersAttempted = 0;

  for (const ddl of DDLs) {
    try {
      await execute(ddl);
      tablesCreated++;
    } catch (e: any) {
      if (e?.message?.includes("already exists")) {
        // 表/索引已存在，正常
      } else {
        errors.push(`DDL: ${e?.message}`);
      }
    }
  }

  for (const alt of ALTERS) {
    try {
      await execute(alt);
      altersAttempted++;
    } catch (e: any) {
      if (e?.message?.includes("duplicate column") || e?.message?.includes("already exists")) {
        // 列已存在，正常
      } else {
        errors.push(`ALTER: ${e?.message}`);
      }
    }
  }

  return { tablesCreated, altersAttempted, errors };
}

/**
 * 执行 schema 初始化 — 使用 better-sqlite3 同步 API
 * 适用于本地开发 / Docker
 */
export function initSchemaSync(db: { exec: (sql: string) => void }): void {
  for (const ddl of DDLs) {
    db.exec(ddl);
  }
  for (const alt of ALTERS) {
    try {
      db.exec(alt);
    } catch {
      // 列已存在，跳过
    }
  }
}
