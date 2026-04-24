/**
 * LiteHub 统一路由入口
 * Vercel 只看到这 1 个 Function，内部自己分发到各个处理器
 */
import { handleAgents } from "../lib/handlers/agents";
import { handleQueues } from "../lib/handlers/queues";
import { handlePeek } from "../lib/handlers/peek";
import { handleAgentRegister } from "../lib/handlers/agent-register";
import { handleProduce } from "../lib/handlers/produce";
import { handleConsume } from "../lib/handlers/consume";
import { handlePipe } from "../lib/handlers/pipe";
import { handlePools } from "../lib/handlers/pools";
import { handlePoolCreate } from "../lib/handlers/pool-create";
import { handlePoolJoin } from "../lib/handlers/pool-join";
import { handlePoolLeave } from "../lib/handlers/pool-leave";
import { handlePoolSpeak } from "../lib/handlers/pool-speak";
import { handlePoolMessages } from "../lib/handlers/pool-messages";
import { handlePoolMembers } from "../lib/handlers/pool-members";
import { handleSkill } from "../lib/handlers/skill";
import { handleDashboard } from "../lib/handlers/dashboard";
import { handleMcpConfig } from "../lib/handlers/mcp-config";
import { handleMcpSse } from "../lib/handlers/mcp-sse";
import { handleIndex } from "../lib/handlers/index";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default async function handler(req: Request) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/^\/+/, "").replace(/\/+$/, "") || "/";

  // 路由表
  const routes: Record<string, (req: Request) => Promise<Response>> = {
    "/": handleIndex,
    "agents": handleAgents,
    "queues": handleQueues,
    "peek": handlePeek,
    "agent/register": handleAgentRegister,
    "agent/produce": handleProduce,
    "agent/consume": handleConsume,
    "agent/pipe": handlePipe,
    "pools": handlePools,
    "pool/create": handlePoolCreate,
    "pool/join": handlePoolJoin,
    "pool/leave": handlePoolLeave,
    "pool/speak": handlePoolSpeak,
    "pool/messages": handlePoolMessages,
    "pool/members": handlePoolMembers,
    "skill": handleSkill,
    "skills": handleSkill, // alias
    "dashboard": handleDashboard,
    "mcp": handleMcpConfig,
    "mcp/sse": handleMcpSse,
  };

  // 查找处理器
  const handler = routes[path];
  if (!handler) {
    return new Response(JSON.stringify({ error: "Not Found", path }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const response = await handler(req);
    // 添加 CORS headers 到响应
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  } catch (err) {
    console.error(`Handler error for ${path}:`, err);
    return new Response(JSON.stringify({
      error: "Internal Server Error",
      message: err instanceof Error ? err.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
}
