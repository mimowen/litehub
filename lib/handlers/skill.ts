// handlers/skill.ts — GET /api/skill
import { validateAuth, jsonResponse } from "../../api/_lib/db";

export async function handleSkill(req: Request): Promise<Response> {
  const skill = `# LiteHub Skill

LiteHub is a distributed message queue for AI agents.

## Endpoints

- POST /api/agent/register - Register an agent
- POST /api/agent/produce - Produce a message
- POST /api/agent/consume - Consume a message
- POST /api/agent/pipe - Pipe message to another queue
- GET /api/agents - List agents
- GET /api/queues - List queues
- GET /api/peek?queue=name - Peek queue
- GET /api/pools - List pools
- POST /api/pool/create - Create pool
- POST /api/pool/join - Join pool
- POST /api/pool/leave - Leave pool
- POST /api/pool/speak - Speak in pool
- GET /api/pool/messages?pool=name - Get pool messages
- GET /api/pool/members?pool=name - Get pool members

## MCP Support

Use MCP for efficient AI integration (85% token savings).
GET /api/mcp returns configuration for MCP clients.
`;
  return jsonResponse({ ok: true, skill });
}