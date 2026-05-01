// src/adapters/db/d1.ts — Cloudflare D1 实现
import type { DbClient, DbResult } from "./interface.js";
import { initSchemaAsync } from "../../core/schema.js";

export interface D1Config {
  d1: D1Database;
}

/**
 * 获取 D1 适配的 DbClient
 * Cloudflare Workers 环境下通过 c.env.DB 获取 D1Database 实例
 */
export async function getDbClient(config: D1Config): Promise<DbClient> {
  const { d1 } = config;

  // Initialize schema using D1
  const schemaExec = async (sql: string, _args?: unknown[]) => {
    await d1.prepare(sql).run();
    return { rowsAffected: 0 };
  };
  await initSchemaAsync(schemaExec);

  return {
    async execute(sql: string, args: unknown[] = []): Promise<DbResult> {
      const stmt = d1.prepare(sql);
      const bound = args.length > 0 ? stmt.bind(...args) : stmt;
      const isSelect = sql.trim().toUpperCase().startsWith("SELECT");

      if (isSelect) {
        const result = await bound.all();
        return {
          rows: (result.results || []) as Record<string, unknown>[],
          rowsAffected: result.results?.length || 0,
        };
      } else {
        const result = await bound.run();
        return {
          rows: [],
          rowsAffected: result.meta.changes,
        };
      }
    },
  };
}
