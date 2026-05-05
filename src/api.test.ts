// src/api.test.ts — API route integration tests
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import app from "./index.js";
import { getDbClient, resetDb } from "./adapters/db/sqlite.js";
import type { DbClient } from "./adapters/db/interface.js";
import type { LiteHubEnv } from "./types.js";

process.env.LITEHUB_DB = ":memory:";
process.env.LITEHUB_TOKEN = "";

let db: DbClient;
let uid = 0;
const uniq = (prefix: string) => `${prefix}-${++uid}-${Date.now()}`;

// 创建测试环境的应用
const createTestApp = () => {
  const testApp = new Hono<LiteHubEnv>();
  testApp.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });
  testApp.route("/", app);
  return testApp;
};

beforeEach(() => {
  resetDb();
  db = getDbClient();
});

describe("API endpoints", () => {
  describe("public endpoints", () => {
    it("GET /api returns API info", async () => {
      const testApp = createTestApp();
      const res = await testApp.request("/api");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(data.name).toBe("LiteHub");
      expect(data.endpoints).toHaveProperty("mcp");
    });

    it("GET /api/agents returns agents list", async () => {
      const testApp = createTestApp();
      const res = await testApp.request("/api/agents");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.agents)).toBe(true);
    });

    it("GET /api/queues returns queues list", async () => {
      const testApp = createTestApp();
      const res = await testApp.request("/api/queues");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.queues)).toBe(true);
    });

    it("GET /api/pools returns pools list", async () => {
      const testApp = createTestApp();
      const res = await testApp.request("/api/pools");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.pools)).toBe(true);
    });

    it("GET /api/mcp returns MCP configuration with valid URLs", async () => {
      const testApp = createTestApp();
      const res = await testApp.request("/api/mcp", {
        headers: {
          host: "localhost:3000",
          "x-forwarded-proto": "http"
        }
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data).toHaveProperty("mcpServers");
      expect(data.mcpServers).toHaveProperty("litehub");
      expect(data.mcpServers.litehub.url).toBe("http://localhost:3000/mcp");
      expect(data).toHaveProperty("tools");
      expect(Array.isArray(data.tools)).toBe(true);
    });

    it("GET /.well-known/agent-card.json returns agent card with valid URLs", async () => {
      const testApp = createTestApp();
      const res = await testApp.request("/.well-known/agent-card.json", {
        headers: {
          host: "localhost:3000",
          "x-forwarded-proto": "https"
        }
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.name).toBe("LiteHub");
      expect(data.capabilities).toHaveProperty("queue");
      expect(data.capabilities.queue.produce).toBe("https://localhost:3000/api/agent/produce");
      expect(data.capabilities).toHaveProperty("mcp");
      expect(data.capabilities.mcp.endpoint).toBe("https://localhost:3000/api/mcp");
    });
  });

  describe("agent registration", () => {
    it("POST /api/agent/register registers an agent", async () => {
      const testApp = createTestApp();
      const agentId = uniq("agent");
      const res = await testApp.request("/api/agent/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          name: "Test Agent",
          role: "both",
          queues: ["test-queue"]
        })
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(data.agent.agentId).toBe(agentId);
    });

    it("POST /api/agent/register returns 400 for missing fields", async () => {
      const testApp = createTestApp();
      const res = await testApp.request("/api/agent/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.ok).toBe(false);
      expect(data.error).toContain("缺少必填字段");
    });
  });

  describe("produce and consume", () => {
    it("can produce data to a queue", async () => {
      const testApp = createTestApp();
      const agentId = uniq("prod");
      const queueName = uniq("q");

      // Register first
      await testApp.request("/api/agent/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          name: "Producer",
          role: "producer",
          queues: [queueName]
        })
      });

      // Produce
      const res = await testApp.request("/api/agent/produce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          queue: queueName,
          data: "Hello from test"
        })
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(data.pointer).toHaveProperty("queue", queueName);
    });

    it("returns 403 when producing with unregistered agent", async () => {
      const testApp = createTestApp();
      const res = await testApp.request("/api/agent/produce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "unknown",
          queue: "any",
          data: "test"
        })
      });
      expect(res.status).toBe(403);
    });

    it("can peek a queue", async () => {
      const testApp = createTestApp();
      const agentId = uniq("prod");
      const queueName = uniq("q");

      // Setup
      await testApp.request("/api/agent/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          name: "Producer",
          role: "producer",
          queues: [queueName]
        })
      });
      await testApp.request("/api/agent/produce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          queue: queueName,
          data: "Peek me"
        })
      });

      // Peek
      const res = await testApp.request(`/api/peek?queue=${queueName}`);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(data.pointer).toBeDefined();
      expect(data.pointer).toHaveProperty("queue", queueName);
    });
  });

  describe("pool operations", () => {
    it("can create and join a pool", async () => {
      const testApp = createTestApp();
      const agentId = uniq("pool-agent");
      const poolName = uniq("pool");

      // Register agent
      await testApp.request("/api/agent/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          name: "Pool Agent",
          role: "both",
          queues: []
        })
      });

      // Create pool
      const createRes = await testApp.request("/api/pool/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: poolName,
          description: "Test pool"
        })
      });
      expect(createRes.status).toBe(200);
      const createData = await createRes.json() as any;
      expect(createData.ok).toBe(true);

      // Join pool
      const joinRes = await testApp.request("/api/pool/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pool: poolName,
          agentId
        })
      });
      expect(joinRes.status).toBe(200);
    });
  });

  describe("A2A tasks", () => {
    it("can list tasks (GET is public)", async () => {
      const testApp = createTestApp();
      const listRes = await testApp.request("/api/a2a/tasks");
      expect(listRes.status).toBe(200);
      const listData = await listRes.json() as any;
      expect(listData.ok).toBe(true);
      expect(Array.isArray(listData.tasks)).toBe(true);
    });

    it("POST /api/a2a/tasks requires auth when token is set", async () => {
      const testApp = createTestApp();
      const agentId = uniq("a2a-agent");

      // Save original env
      const originalToken = process.env.LITEHUB_TOKEN;
      process.env.LITEHUB_TOKEN = "test-token";

      try {
        const res = await testApp.request("/api/a2a/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId,
            name: "Test task",
            input: "Test input"
          })
        });
        // Without auth header, should be 401 or 403
        expect([401, 403]).toContain(res.status);
      } finally {
        // Restore original env
        process.env.LITEHUB_TOKEN = originalToken;
      }
    });
  });

  describe("ACP runs and contexts", () => {
    it("can list ACP runs (GET is public)", async () => {
      const testApp = createTestApp();
      const res = await testApp.request("/api/acp/runs");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.runs)).toBe(true);
    });

    it("can list ACP contexts (GET is public)", async () => {
      const testApp = createTestApp();
      const res = await testApp.request("/api/acp/contexts");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.contexts)).toBe(true);
    });

    it("POST /api/acp/runs requires auth when token is set", async () => {
      const testApp = createTestApp();
      const agentId = uniq("acp-agent");

      const originalToken = process.env.LITEHUB_TOKEN;
      process.env.LITEHUB_TOKEN = "test-token";

      try {
        const res = await testApp.request("/api/acp/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId,
            name: "Test run"
          })
        });
        expect([401, 403]).toContain(res.status);
      } finally {
        process.env.LITEHUB_TOKEN = originalToken;
      }
    });
  });

  describe("webhook test endpoint", () => {
    it("POST /api/webhook/test logs the payload", async () => {
      const testApp = createTestApp();
      const res = await testApp.request("/api/webhook/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: "payload" })
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(data.received).toBe(true);
    });

    it("GET /api/webhook/test returns logs", async () => {
      const testApp = createTestApp();
      const res = await testApp.request("/api/webhook/test");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.logs)).toBe(true);
    });
  });

  describe("queue block/unblock", () => {
    it("POST /api/queues/block blocks a queue", async () => {
      const testApp = createTestApp();
      await testApp.request("/api/agent/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "p1", name: "Producer", role: "producer", queues: ["test-q"] }),
      });
      const res = await testApp.request("/api/queues/block", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queue: "test-q" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
    });

    it("POST /api/queues/unblock unblocks a queue", async () => {
      const testApp = createTestApp();
      await testApp.request("/api/agent/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "p1", name: "Producer", role: "producer", queues: ["test-q"] }),
      });
      await testApp.request("/api/queues/block", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queue: "test-q" }),
      });
      const res = await testApp.request("/api/queues/unblock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queue: "test-q" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
    });

    it("blocked queue returns empty on consume", async () => {
      const testApp = createTestApp();
      await testApp.request("/api/agent/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "p1", name: "Producer", role: "producer", queues: ["bq"] }),
      });
      await testApp.request("/api/agent/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "c1", name: "Consumer", role: "consumer", queues: ["bq"] }),
      });
      await testApp.request("/api/agent/produce", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "p1", queue: "bq", data: "hello" }),
      });
      await testApp.request("/api/queues/block", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queue: "bq" }),
      });
      const res = await testApp.request("/api/agent/consume", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "c1", queue: "bq" }),
      });
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(data.data).toBeUndefined();
    });
  });

  describe("agent delete", () => {
    it("POST /api/agent/delete removes an agent", async () => {
      const testApp = createTestApp();
      await testApp.request("/api/agent/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "del1", name: "ToDelete", role: "producer", queues: ["dq"] }),
      });
      const res = await testApp.request("/api/agent/delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "del1" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
    });

    it("deleted agent cannot consume", async () => {
      const testApp = createTestApp();
      await testApp.request("/api/agent/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "del2", name: "ToDelete", role: "consumer", queues: ["dq2"] }),
      });
      await testApp.request("/api/agent/delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "del2" }),
      });
      const res = await testApp.request("/api/agent/consume", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "del2", queue: "dq2" }),
      });
      const data = await res.json() as any;
      expect(data.ok).toBe(false);
    });
  });

  describe("pool block/unblock", () => {
    it("POST /api/pools/block blocks a pool", async () => {
      const testApp = createTestApp();
      await testApp.request("/api/pool/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool: "bp", agentId: "a1" }),
      });
      const res = await testApp.request("/api/pools/block", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool: "bp" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
    });

    it("POST /api/pools/unblock unblocks a pool", async () => {
      const testApp = createTestApp();
      await testApp.request("/api/pool/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool: "ubp", agentId: "a1" }),
      });
      await testApp.request("/api/pools/block", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool: "ubp" }),
      });
      const res = await testApp.request("/api/pools/unblock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool: "ubp" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
    });

    it("blocked pool is reflected in list", async () => {
      const testApp = createTestApp();
      await testApp.request("/api/pool/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool: "bplist", agentId: "a1" }),
      });
      await testApp.request("/api/pools/block", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool: "bplist" }),
      });
      const res = await testApp.request("/api/pools");
      const data = await res.json() as any;
      const pool = data.pools.find((p: any) => p.name === "bplist");
      expect(pool.blocked).toBe(1);
    });

    it("pool block/unblock toggle persists correctly", async () => {
      const testApp = createTestApp();
      const poolName = uniq("toggle-pool");
      await testApp.request("/api/pool/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool: poolName, agentId: "a1" }),
      });

      // 初始状态：未阻断
      let res = await testApp.request("/api/pools");
      let data = await res.json() as any;
      let pool = data.pools.find((p: any) => p.name === poolName);
      expect(pool.blocked).toBe(0);

      // 第一次阻断
      await testApp.request("/api/pools/block", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool: poolName }),
      });
      res = await testApp.request("/api/pools");
      data = await res.json() as any;
      pool = data.pools.find((p: any) => p.name === poolName);
      expect(pool.blocked).toBe(1);

      // 解阻断
      await testApp.request("/api/pools/unblock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool: poolName }),
      });
      res = await testApp.request("/api/pools");
      data = await res.json() as any;
      pool = data.pools.find((p: any) => p.name === poolName);
      expect(pool.blocked).toBe(0);

      // 再次阻断
      await testApp.request("/api/pools/block", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool: poolName }),
      });
      res = await testApp.request("/api/pools");
      data = await res.json() as any;
      pool = data.pools.find((p: any) => p.name === poolName);
      expect(pool.blocked).toBe(1);
    });
  });
});
