// api/skill.ts — Skill 文件下载端点（Vercel Serverless Functions）
// GET /api/skill          → 技能列表
// GET /api/skill/:name    → 下载技能文件（attachment）
import { jsonResponse } from "./_lib/turso.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const SKILLS_DIR = "skills";

// 技能注册表（每次新增 skill 文件在这里加一条）
const SKILL_REGISTRY = [
  {
    name: "litehub",
    file: "litehub.md",
    description: "LiteHub AI Agent 协作技能 — 注册、生产、消费、管道、轮询循环、Fan-Out",
  },
];

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return cors(204);
    }

    const url = new URL(req.url);
    const path = url.pathname.replace("/api/skill", "");

    // GET /api/skill → 技能列表
    if (req.method === "GET" && (!path || path === "/")) {
      return new Response(JSON.stringify({ ok: true, skills: SKILL_REGISTRY }, null, 2), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // GET /api/skill/:name → 下载技能文件
    if (req.method === "GET" && path.startsWith("/")) {
      const skillName = decodeURIComponent(path.slice(1));
      return downloadSkill(skillName);
    }

    return jsonResponse({ ok: false, error: "Not found" }, 404);
  },
};

function cors(status = 200): Response {
  return new Response(null, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function downloadSkill(name: string): Response {
  if (!/^[\w\-.]+$/.test(name)) {
    return jsonResponse({ ok: false, error: "Invalid skill name" }, 400);
  }

  const fileName = name.endsWith(".md") ? name : `${name}.md`;
  const registry = SKILL_REGISTRY.find(
    (s) => s.name === name || s.file === fileName
  );
  if (!registry) {
    return jsonResponse({ ok: false, error: `Skill '${name}' not found` }, 404);
  }

  // 解析 api/skill.ts 所在目录 → 项目根目录 → skills/目录
  const currentFile = fileURLToPath(import.meta.url);
  const baseDir = join(dirname(currentFile), "..");
  const fullPath = join(baseDir, SKILLS_DIR, fileName);

  let content: string;
  try {
    content = readFileSync(fullPath, "utf-8");
  } catch {
    return jsonResponse({ ok: false, error: "Skill file not found on server" }, 404);
  }

  const bytes = new TextEncoder().encode(content);
  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(bytes.byteLength),
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
