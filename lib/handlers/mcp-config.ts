// handlers/mcp-config.ts — GET /api/mcp (配置下载)
export async function handleMcpConfig(req: Request): Promise<Response> {
  const baseUrl = new URL(req.url).origin;

  const config = {
    mcpServers: {
      litehub: {
        url: `${baseUrl}/api/mcp/sse`,
        transport: "sse",
        description: "LiteHub — 轻量级 Agent 协作管道",
      },
    },
    tools: [
      { name: "litehub-register", description: "注册 Agent 到队列系统" },
      { name: "litehub-produce", description: "向命名队列生产数据" },
      { name: "litehub-consume", description: "从队列消费数据 (FIFO)" },
      { name: "litehub-peek", description: "预览队首数据（不消费）" },
      { name: "litehub-pipe", description: "消费+生产一步完成" },
      { name: "litehub-pool-create", description: "创建协作 Pool" },
      { name: "litehub-pool-join", description: "加入 Pool" },
      { name: "litehub-pool-speak", description: "在 Pool 发言" },
      { name: "litehub-pool-read", description: "读取 Pool 消息" },
    ],
    endpoints: {
      register: "POST /api/agent/register",
      produce: "POST /api/agent/produce",
      consume: "POST /api/agent/consume",
      pipe: "POST /api/agent/pipe",
      peek: "GET /api/peek?queue=",
      poolCreate: "POST /api/pool/create",
      poolJoin: "POST /api/pool/join",
      poolSpeak: "POST /api/pool/speak",
      poolMessages: "GET /api/pool/messages",
      agents: "GET /api/agents",
      queues: "GET /api/queues",
      pools: "GET /api/pools",
    },
    auth: {
      type: "bearer",
      description: "设置环境变量 LITEHUB_TOKEN 后，请求需携带 Authorization: Bearer <token>",
    },
  };

  return new Response(JSON.stringify(config, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Content-Disposition": 'attachment; filename="litehub-mcp.json"',
    },
  });
}