// api/[[...route]].ts — Vercel 部署适配器
// Vercel 会自动识别 api/ 目录下的文件作为 Serverless Functions
import { handle } from "hono/vercel";
import app from "../src/index";

// 导出 Vercel 需要的 handler
export const config = {
  runtime: "nodejs",
};

export default handle(app);
