// handlers/pool-speak.ts — POST /api/pool/speak
import { getClient, validateAuth, jsonResponse, parseBody } from "../../api/_lib/db";

export async function handlePoolSpeak(req: Request): Promise<Response> {
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const body = await parseBody(req);
  const { pool, agentId, content, replyTo, tags, metadata } = body;
  if (!pool || !agentId || !content) {
    return jsonResponse({ ok: false, error: "Missing required fields" }, 400);
  }

  const id = crypto.randomUUID();
  const db = getClient();
  await db.execute({
    sql: `INSERT INTO pool_messages (id, pool, agent_id, content, reply_to, tags, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, pool, agentId, content, replyTo || null, JSON.stringify(tags || []), JSON.stringify(metadata || {})]
  });
  return jsonResponse({ ok: true, id });
}