// src/protocols/a2a.test.ts — A2A Protocol JSON-RPC 2.0 compliance tests
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { getDbClient, resetDb } from "../adapters/db/sqlite.js";
import type { DbClient } from "../adapters/db/interface.js";
import { registerAgent } from "../core/queue.js";
import { handleA2ARequest } from "./a2a.js";

process.env.LITEHUB_DB = ":memory:";

let db: DbClient;
let uid = 0;
const uniq = (prefix: string) => `${prefix}-${++uid}-${Date.now()}`;

beforeEach(() => {
  resetDb();
  db = getDbClient();
});

describe("A2A JSON-RPC 2.0 Protocol", () => {
  const agentId = "test-agent";
  const baseUrl = "http://localhost:3000";

  describe("message/send", () => {
    it("creates a new task with JSON-RPC 2.0 format", async () => {
      await registerAgent(db, { agentId, name: "Test Agent", role: "producer", queues: [] });

      const request = {
        jsonrpc: "2.0" as const,
        id: "req-001",
        method: "message/send",
        params: {
          message: {
            role: "user" as const,
            parts: [{ type: "text" as const, text: "Hello, Agent!" }],
            messageId: crypto.randomUUID(),
          },
        },
      };

      const response = await handleA2ARequest(db, request, agentId, baseUrl);

      expect(response.jsonrpc).toBe("2.0");
      expect(response.id).toBe("req-001");
      expect(response.result).toBeDefined();
      expect((response.result as any).task).toBeDefined();
      expect((response.result as any).task.id).toBeDefined();
      expect((response.result as any).task.status.state).toBe("submitted");
    });

    it("sends message to existing task", async () => {
      await registerAgent(db, { agentId, name: "Test Agent", role: "producer", queues: [] });

      const createRequest = {
        jsonrpc: "2.0" as const,
        id: "req-001",
        method: "message/send",
        params: {
          message: {
            role: "user" as const,
            parts: [{ type: "text" as const, text: "First message" }],
            messageId: crypto.randomUUID(),
          },
        },
      };

      const createResponse = await handleA2ARequest(db, createRequest, agentId, baseUrl);
      const taskId = (createResponse.result as any).task.id;

      const sendRequest = {
        jsonrpc: "2.0" as const,
        id: "req-002",
        method: "message/send",
        params: {
          id: taskId,
          message: {
            role: "agent" as const,
            parts: [{ type: "text" as const, text: "Reply message" }],
            messageId: crypto.randomUUID(),
          },
        },
      };

      const sendResponse = await handleA2ARequest(db, sendRequest, agentId, baseUrl);

      expect(sendResponse.jsonrpc).toBe("2.0");
      expect(sendResponse.id).toBe("req-002");
      expect((sendResponse.result as any).task.id).toBe(taskId);
    });
  });

  describe("tasks/get", () => {
    it("returns task by id", async () => {
      await registerAgent(db, { agentId, name: "Test Agent", role: "producer", queues: [] });

      const createRequest = {
        jsonrpc: "2.0" as const,
        id: "req-001",
        method: "message/send",
        params: {
          message: {
            role: "user" as const,
            parts: [{ type: "text" as const, text: "Test task" }],
            messageId: crypto.randomUUID(),
          },
        },
      };

      const createResponse = await handleA2ARequest(db, createRequest, agentId, baseUrl);
      const taskId = (createResponse.result as any).task.id;

      const getRequest = {
        jsonrpc: "2.0" as const,
        id: "req-002",
        method: "tasks/get",
        params: { id: taskId },
      };

      const getResponse = await handleA2ARequest(db, getRequest, agentId, baseUrl);

      expect(getResponse.jsonrpc).toBe("2.0");
      expect((getResponse.result as any).task.id).toBe(taskId);
    });

    it("returns null for non-existent task", async () => {
      await registerAgent(db, { agentId, name: "Test Agent", role: "producer", queues: [] });

      const request = {
        jsonrpc: "2.0" as const,
        id: "req-001",
        method: "tasks/get",
        params: { id: "non-existent-task" },
      };

      const response = await handleA2ARequest(db, request, agentId, baseUrl);

      expect(response.jsonrpc).toBe("2.0");
      expect((response.result as any).task).toBeNull();
    });
  });

  describe("tasks/list", () => {
    it("lists all tasks", async () => {
      await registerAgent(db, { agentId, name: "Test Agent", role: "producer", queues: [] });

      for (let i = 0; i < 3; i++) {
        await handleA2ARequest(
          db,
          {
            jsonrpc: "2.0",
            id: `req-${i}`,
            method: "message/send",
            params: {
              message: {
                role: "user",
                parts: [{ type: "text", text: `Task ${i}` }],
                messageId: crypto.randomUUID(),
              },
            },
          },
          agentId,
          baseUrl,
        );
      }

      const request = {
        jsonrpc: "2.0" as const,
        id: "req-list",
        method: "tasks/list",
        params: {},
      };

      const response = await handleA2ARequest(db, request, agentId, baseUrl);

      expect(response.jsonrpc).toBe("2.0");
      expect((response.result as any).tasks).toHaveLength(3);
    });
  });

  describe("tasks/cancel", () => {
    it("cancels a task", async () => {
      await registerAgent(db, { agentId, name: "Test Agent", role: "producer", queues: [] });

      const createRequest = {
        jsonrpc: "2.0" as const,
        id: "req-001",
        method: "message/send",
        params: {
          message: {
            role: "user" as const,
            parts: [{ type: "text" as const, text: "Task to cancel" }],
            messageId: crypto.randomUUID(),
          },
        },
      };

      const createResponse = await handleA2ARequest(db, createRequest, agentId, baseUrl);
      const taskId = (createResponse.result as any).task.id;

      const cancelRequest = {
        jsonrpc: "2.0" as const,
        id: "req-002",
        method: "tasks/cancel",
        params: { id: taskId },
      };

      const cancelResponse = await handleA2ARequest(db, cancelRequest, agentId, baseUrl);

      expect(cancelResponse.jsonrpc).toBe("2.0");
      expect((cancelResponse.result as any).task.status.state).toBe("cancelled");
    });
  });

  describe("JSON-RPC 2.0 Error Handling", () => {
    it("returns PARSE_ERROR for invalid JSON", async () => {
      const response = await handleA2ARequest(db, "invalid json", agentId, baseUrl);

      expect(response.jsonrpc).toBe("2.0");
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32700);
    });

    it("returns INVALID_REQUEST for missing jsonrpc version", async () => {
      const request = {
        id: "req-001",
        method: "message/send",
        params: {},
      };

      const response = await handleA2ARequest(db, request, agentId, baseUrl);

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32600);
    });

    it("returns METHOD_NOT_FOUND for unknown method", async () => {
      const request = {
        jsonrpc: "2.0" as const,
        id: "req-001",
        method: "unknown/method",
        params: {},
      };

      const response = await handleA2ARequest(db, request, agentId, baseUrl);

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32601);
    });

    it("returns INVALID_PARAMS for missing message", async () => {
      await registerAgent(db, { agentId, name: "Test Agent", role: "producer", queues: [] });

      const request = {
        jsonrpc: "2.0" as const,
        id: "req-001",
        method: "message/send",
        params: {},
      };

      const response = await handleA2ARequest(db, request, agentId, baseUrl);

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602);
    });
  });

  describe("agent/authenticatedExtendedCard", () => {
    it("returns agent card", async () => {
      await registerAgent(db, { agentId, name: "Test Agent", role: "producer", queues: [] });

      const request = {
        jsonrpc: "2.0" as const,
        id: "req-001",
        method: "agent/authenticatedExtendedCard",
        params: {},
      };

      const response = await handleA2ARequest(db, request, agentId, baseUrl);

      expect(response.jsonrpc).toBe("2.0");
      expect((response.result as any).name).toBe("LiteHub A2A Agent");
      expect((response.result as any).capabilities.streaming).toBe(true);
      expect((response.result as any).capabilities.pushNotifications).toBe(true);
    });
  });
});
