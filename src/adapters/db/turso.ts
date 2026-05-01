// src/adapters/db/turso.ts — Turso/libsql 实现（Vercel Edge / Serverless）
import { createClient, type Client, type InValue } from "@libsql/client/http";
import type { DbClient, DbResult } from "./interface.js";
import { initSchemaAsync } from "../../core/schema.js";

let _client: Client | null = null;
let _schemaInitialized = false;

export interface TursoConfig {
  url: string;
  authToken?: string;
}

/**
 * 获取 Turso 适配的 DbClient
 * @param config — 可选配置，不传则从环境变量读取
 */
export async function getDbClient(config?: TursoConfig): Promise<DbClient> {
  if (!_client) {
    const url = config?.url || process.env.TURSO_URL || process.env.TURSO_DATABASE_URL || "";
    if (!url) throw new Error("Missing Turso URL. Set TURSO_URL or pass config.");
    _client = createClient({
      url,
      authToken: config?.authToken || process.env.TURSO_AUTH_TOKEN || "",
    });
  }

  // Initialize schema on first use
  if (!_schemaInitialized) {
    const execute = async (sql: string, _args?: unknown[]) => {
      const result = await _client!.execute({ sql, args: [] as InValue[] });
      return { rowsAffected: result.rowsAffected };
    };
    await initSchemaAsync(execute);
    _schemaInitialized = true;
  }

  return {
    async execute(sql: string, args: unknown[] = []): Promise<DbResult> {
      const result = await _client!.execute({ sql, args: args as InValue[] });
      return {
        rows: result.rows as Record<string, unknown>[],
        rowsAffected: result.rowsAffected,
      };
    },
    close() {
      // Turso HTTP client 无需显式关闭
      _client = null;
      _schemaInitialized = false;
    },
  };
}

/**
 * 重置客户端（测试用）
 */
export function resetDb(): void {
  _client = null;
  _schemaInitialized = false;
}
