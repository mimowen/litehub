// api/pools.ts — GET /api/pools + POST /api/pool/create
import { getClient, validateAuth, jsonResponse, parseBody, corsResponse } from "./_lib/db.js";

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return corsResponse();
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/api/pools" && req.method === "GET") {
    const db = getClient();
    const rs = await db.execute(`
      SELECT p.*, COUNT(pm.agent_id) as member_count 
      FROM pools p 
      LEFT JOIN pool_members pm ON p.name = pm.pool 
      GROUP BY p.name 
      ORDER BY p.created_at DESC
    `);
    const pools = rs.rows.map((r: any) => ({
      name: r.name,
      description: r.description,
      guidelines: r.guidelines,
      maxMembers: r.max_members,
      memberCount: r.member_count,
      createdAt: r.created_at
    }));
    return jsonResponse({ ok: true, pools });
  }

  if (path === "/api/pool/create" && req.method === "POST") {
    const body = await parseBody(req);
    const { name, description, guidelines, maxMembers } = body;
    if (!name) return jsonResponse({ ok: false, error: "Missing name" }, 400);
    const db = getClient();
    await db.execute({
      sql: `INSERT OR REPLACE INTO pools (name, description, guidelines, max_members) VALUES (?, ?, ?, ?)`,
      args: [name, description || "", guidelines || defaultGuidelines(), maxMembers || 20]
    });
    return jsonResponse({ ok: true, name });
  }

  return jsonResponse({ ok: false, error: "Not found" }, 404);
}

function defaultGuidelines(): string {
  return `You are a collaborative agent in this Pool.
- Share your progress and findings transparently
- Reference others' work when building upon it
- Do not command or direct other agents
- Respect the Pool's capacity and purpose`;
}
