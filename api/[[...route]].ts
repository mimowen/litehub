/**
 * LiteHub 统一路由入口
 * Vercel 只看到这 1 个 Function，内部自己分发到各个处理器
 */
import { handleAgents } from "./handlers/agents";
import { handleQueues } from "./handlers/queues";
import { handlePeek } from "./handlers/peek";
import { handleAgentRegister } from "./handlers/agent-register";
import { handleProduce } from "./handlers/produce";
import { handleConsume } from "./handlers/consume";
import { handlePipe } from "./handlers/pipe";
import { handlePools } from "./handlers/pools";
import { handlePoolCreate } from "./handlers/pool-create";
import { handlePoolJoin } from "./handlers/pool-join";
import { handlePoolLeave } from "./handlers/pool-leave";
import { handlePoolSpeak } from "./handlers/pool-speak";
import { handlePoolMessages } from "./handlers/pool-messages";
import { handlePoolMembers } from "./handlers/pool-members";
import { handleSkill } from "./handlers/skill";
import { handleDashboard } from "./handlers/dashboard";
import { handleMcpConfig } from "./handlers/mcp-config";
import { handleMcpSse } from "./handlers/mcp-sse";
import { handleIndex } from "./handlers/index";

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
