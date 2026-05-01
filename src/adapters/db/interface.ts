// src/adapters/db/interface.ts — 统一数据库接口
// 所有平台（本地/Vercel/CF Workers）共享此接口
// 核心业务逻辑只依赖此接口，不依赖具体 DB 驱动

export interface DbRow {
  [key: string]: unknown;
}

export interface DbResult {
  rows: DbRow[];
  rowsAffected: number;
}

export interface DbClient {
  /** 执行 SQL 语句（INSERT/UPDATE/DELETE/SELECT） */
  execute(sql: string, args?: unknown[]): Promise<DbResult>;

  /** 关闭连接（可选，用于优雅关闭） */
  close?(): void;
}

/**
 * 安全获取单行结果
 */
export function getOne(result: DbResult): DbRow | null {
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * 安全获取单列值
 */
export function getValue<T = unknown>(result: DbResult, column: string): T | null {
  const row = getOne(result);
  return row ? (row[column] as T) : null;
}
