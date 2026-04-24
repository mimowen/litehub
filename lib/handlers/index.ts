// handlers/index.ts — GET /api (index page)
import { jsonResponse } from "../../api/_lib/db";

export async function handleIndex(req: Request): Promise<Response> {
  return jsonResponse({
    ok: true,
    name: "LiteHub",
    version: "2.0.0",
    endpoints: {
      agents: "/api/agents",
      queues: "/api/queues",
      pools: "/api/pools",
      mcp: "/api/mcp",
      dashboard: "/api/dashboard"
    }
  });
}
