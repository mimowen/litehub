// src/adapters/db/sqlite.ts — better-sqlite3 实现（本地/VPS/Docker）
import Database from "better-sqlite3";
import path from "path";
import type { DbClient, DbResult, DbRow } from "./interface.js";
import { initSchemaSync } from "../../core/schema.js";

const DB_PATH = process.env.LITEHUB_DB || path.join(process.cwd(), "litehub.db");

let _db: Database.Database | null = null;

function getRawDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  return _db;
}

/**
 * 获取 SQLite 适配的 DbClient
 */
export function getDbClient(): DbClient {
  const db = getRawDb();
  // 确保 schema 已初始化（使用统一 DDL）
  initSchemaSync(db);

  return {
    async execute(sql: string, args: unknown[] = []): Promise<DbResult> {
      const stmt = db.prepare(sql);
      const isSelect = sql.trim().toUpperCase().startsWith("SELECT");
      if (isSelect) {
        const rows = stmt.all(...args) as DbRow[];
        return { rows, rowsAffected: rows.length };
      } else {
        const info = stmt.run(...args);
        return { rows: [], rowsAffected: info.changes };
      }
    },
    close() {
      if (_db) {
        _db.close();
        _db = null;
      }
    },
  };
}

/**
 * 获取原生 better-sqlite3 实例（仅过渡期使用，新代码应使用 DbClient）
 * @deprecated 使用 getDbClient() 代替
 */
export function getRawDbInstance(): Database.Database {
  return getRawDb();
}

/**
 * 重置数据库连接（测试用）
 * 关闭连接并清除所有表数据
 */
export function resetDb(): void {
  if (_db) {
    try {
      _db.exec("DELETE FROM pool_messages");
      _db.exec("DELETE FROM pool_members");
      _db.exec("DELETE FROM acp_runs");
      _db.exec("DELETE FROM a2a_tasks");
      _db.exec("DELETE FROM push_subscriptions");
      _db.exec("DELETE FROM webhook_logs");
      _db.exec("DELETE FROM pointers");
      _db.exec("DELETE FROM pools");
      _db.exec("DELETE FROM queues");
      _db.exec("DELETE FROM agents");
    } catch {
      // fallback: close and reopen
      _db.close();
      _db = null;
    }
  }
}
