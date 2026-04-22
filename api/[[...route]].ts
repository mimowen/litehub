// api/[[...route]].ts — Vercel 部署入口
// 使用 Turso 适配器，避免引入 better-sqlite3
import { handle } from "hono/vercel";
import app from "../src/adapters/vercel";

export const config = {
  runtime: "nodejs",
};

export default handle(app);
