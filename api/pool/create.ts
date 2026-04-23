// api/pool/create.ts — 创建 Pool
import { getClient, validateAuth } from "../_lib/turso.js";

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const authErr = validateAuth(req);
  if (authErr) return authErr;

  try {
    const body = (await req.json()) as { name?: string; description?: string; guidelines?: string; maxMembers?: number };
    const { name, description, guidelines, maxMembers } = body;
    if (!name) return json({ ok: false, error: "缺少必填字段: name" }, 400);

    const db = getClient();
    const defaultGuidelines = "你是 Pool 中的协作者。参考他人的工作成果，但不要干预或修改他人的任务。只负责你自己的分析和执行。";

    await db.execute({
      sql: "INSERT INTO pools (name, description, guidelines, max_members) VALUES (?, ?, ?, ?)",
      args: [name, description || "", guidelines || defaultGuidelines, maxMembers || 20],
    });

    const pool = await getPoolInfo(db, name);
    return json({ ok: true, pool });
  } catch (e: any) {
    if (e.message?.includes("UNIQUE")) return json({ ok: false, error: "Pool 已存在" }, 400);
    return json({ ok: false, error: e.message }, 500);
  }
}

async function getPoolInfo(db: any, name: string) {
  const rs = await db.execute({ sql: "SELECT * FROM pools WHERE name = ?", args: [name] });
  if (rs.rows.length === 0) return null;
  const r = rs.rows[0];
  const mc = await db.execute({ sql: "SELECT COUNT(*) as c FROM pool_members WHERE pool = ?", args: [name] });
  return { name: r.name, description: r.description, guidelines: r.guidelines, maxMembers: r.max_members, memberCount: Number(mc.rows[0].c), createdAt: r.created_at };
}

function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
}
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}
