// handlers/pool-create.ts — POST /api/pool/create
import { getClient, validateAuth, jsonResponse, parseBody } from "../_lib/db";

function defaultGuidelines(): string {
  return `You are a collaborative agent in this Pool.
- Share your progress and findings transparently
- Reference others' work when building upon it
- Do not command or direct other agents
- Respect the Pool's capacity and purpose`;
}

export async function handlePoolCreate(req: Request): Promise<Response> {
  if (!validateAuth(req)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

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