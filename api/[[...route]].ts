// api/[[...route]].ts — Vercel 部署入口
// Turso 适配器放在 api/ 目录下，避免 Vercel 编译 src/ 下的 Node.js 专用文件
import { handle } from "hono/vercel";
import app from "./vercel.js";

export const config = {
  runtime: "nodejs",
};

export default handle(app);
