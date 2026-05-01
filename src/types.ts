// src/types.ts — 共享 Hono 类型定义
import type { DbClient } from "./adapters/db/interface.js";

export type LiteHubEnv = {
  Variables: {
    db: DbClient;
  };
  Bindings: {
    DB?: D1Database;
  };
};
