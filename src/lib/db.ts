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
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pointers_queue_status ON pointers(queue, status);
    CREATE INDEX IF NOT EXISTS idx_pointers_queue ON pointers(queue);

    CREATE TABLE IF NOT EXISTS queues (
      name        TEXT PRIMARY KEY,
      description TEXT DEFAULT '',
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
  `);
  return _db;
}

/** 关闭数据库连接（测试用） */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
