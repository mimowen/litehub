// api/pool/speak.ts — 在 Pool 中发言
import { getClient, validateAuth } from "../_lib/turso.js";

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const authErr = validateAuth(req);
  if (authErr) return authErr;

  try {
    const body = (await req.json()) as { pool?: string; agentId?: string; content?: string; replyTo?: string; tags?: string[]; metadata?: Record<string, string> };
    const { pool, agentId, content, replyTo, tags, metadata } = body;
    if (!pool || !agentId || !content) return json({ ok: false, error: "缺少必填字段: pool, agentId, content" }, 400);

    const db = getClient();
    const id = crypto.randomUUID();
    const tagsJson = JSON.stringify(tags || []);
    const metadataJson = JSON.stringify(metadata || {});

    await db.execute({
      sql: "INSERT INTO pool_messages (id, pool, agent_id, content, reply_to, tags, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [id, pool, agentId, content, replyTo || null, tagsJson, metadataJson],
    });

    return json({
      ok: true,
      message: { id, pool, agentId, content, replyTo: replyTo || null, tags: tags || [], metadata: metadata || {}, createdAt: new Date().toISOString() },
    });
  } catch (e: any) {
    return json({ ok: false, error: e.message }, 500);
  }
}

function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
}
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}