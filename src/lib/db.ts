// src/lib/db.ts — SQLite 数据库初始化
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.LITEHUB_DB || path.join(process.cwd(), "litehub.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS pointers (
      id          TEXT PRIMARY KEY,
      queue       TEXT NOT NULL,
      producer_id TEXT NOT NULL,
      data        BLOB NOT NULL,
      size        INTEGER NOT NULL,
      content_type TEXT DEFAULT 'text/plain',
      metadata    TEXT DEFAULT '{}',
      status      TEXT DEFAULT 'pending',  -- pending / consumed
      lineage     TEXT DEFAULT '[]',        -- JSON array of producer IDs for loop detection
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pointers_queue_status ON pointers(queue, status);
    CREATE INDEX IF NOT EXISTS idx_pointers_queue ON pointers(queue);

    CREATE TABLE IF NOT EXISTS queues (
      name        TEXT PRIMARY KEY,
      description TEXT DEFAULT '',
      creator_id  TEXT DEFAULT '',
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agents (
      agent_id      TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL,  -- producer / consumer / both
      queues        TEXT DEFAULT '[]',  -- JSON array
      poll_interval INTEGER DEFAULT 0,
      registered_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pools (
      name        TEXT PRIMARY KEY,
      description TEXT DEFAULT '',
      guidelines  TEXT DEFAULT '你是 Pool 中的协作者。参考他人的工作成果，但不要干预或修改他人的任务。只负责你自己的分析和执行。',
      max_members INTEGER DEFAULT 20,
      creator_id  TEXT DEFAULT '',
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pool_members (
      pool       TEXT NOT NULL,
      agent_id   TEXT NOT NULL,
      joined_at  TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (pool, agent_id)
    );

    CREATE TABLE IF NOT EXISTS pool_messages (
      id          TEXT PRIMARY KEY,
      pool        TEXT NOT NULL,
      agent_id    TEXT NOT NULL,
      content     TEXT NOT NULL,
      reply_to    TEXT,
      tags        TEXT DEFAULT '[]',
      metadata    TEXT DEFAULT '{}',
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pool_messages_pool ON pool_messages(pool, created_at);
    CREATE INDEX IF NOT EXISTS idx_pool_messages_reply ON pool_messages(reply_to);
  `);

  // Migrations: add columns if missing
  const pointerCols = _db.prepare("PRAGMA table_info(pointers)").all() as any[];
  if (!pointerCols.some((c) => c.name === "lineage")) {
    _db.exec("ALTER TABLE pointers ADD COLUMN lineage TEXT DEFAULT '[]'");
  }

  const queueCols = _db.prepare("PRAGMA table_info(queues)").all() as any[];
  if (!queueCols.some((c) => c.name === "creator_id")) {
    _db.exec("ALTER TABLE queues ADD COLUMN creator_id TEXT DEFAULT ''");
  }

  const poolCols = _db.prepare("PRAGMA table_info(pools)").all() as any[];
  if (!poolCols.some((c) => c.name === "creator_id")) {
    _db.exec("ALTER TABLE pools ADD COLUMN creator_id TEXT DEFAULT ''");
  }

  return _db;
}

/** 关闭数据库连接（测试用） */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
