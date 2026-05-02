// src/core/a2a.test.ts — A2A protocol adapter tests
import { describe, it, expect, beforeEach } from "vitest";
import { getDbClient, resetDb } from "../adapters/db/sqlite.js";
import type { DbClient } from "../adapters/db/interface.js";
import { registerAgent } from "./queue.js";
import {
  createTask, getTask, listTasks, updateTask, cancelTask,
  setPushNotification, getPushNotification,
  sendToTask,
} from "./a2a.js";

process.env.LITEHUB_DB = ":memory:";

let db: DbClient;
let uid = 0;
const uniq = (prefix: string) => `${prefix}-${++uid}-${Date.now()}`;

beforeEach(() => {
  resetDb();
  db = getDbClient();
});

describe("createTask", () => {
  it("creates a task and returns taskId", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "producer", queues: [] });
    const result = await createTask(db, { agentId, name: "Test Task", input: { key: "val" } });
    expect(result.ok).toBe(true);
    expect(result.taskId).toBeDefined();
    expect(result.queue).toContain("a2a:");
  });

  it("rejects unregistered agent", async () => {
    const result = await createTask(db, { agentId: "unknown", name: "Task" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not registered");
  });

  it("uses provided taskId", async () => {
    const agentId = uniq("a");
    const taskId = "my-custom-task";
    await registerAgent(db, { agentId, name: "Agent", role: "producer", queues: [] });
    const result = await createTask(db, { agentId, taskId, name: "Custom" });
    expect(result.ok).toBe(true);
    expect(result.taskId).toBe(taskId);
  });

  it("creates task with target agent", async () => {
    const agentId = uniq("a");
    const targetId = uniq("b");
    await registerAgent(db, { agentId, name: "A", role: "producer", queues: [] });
    await registerAgent(db, { agentId: targetId, name: "B", role: "consumer", queues: [] });
    const result = await createTask(db, { agentId, targetAgentId: targetId, name: "Delegated" });
    expect(result.ok).toBe(true);
    expect(result.queue).toContain(targetId);
  });
});

describe("getTask", () => {
  it("returns task details with messages", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "producer", queues: [] });
    const created = await createTask(db, { agentId, name: "My Task", input: { hello: "world" } });
    const task = await getTask(db, created.taskId!);
    expect(task).not.toBeNull();
    expect(task!.name).toBe("My Task");
    expect(task!.status).toBe("pending");
    expect(task!.messages).toHaveLength(1);
  });

  it("returns null for non-existent task", async () => {
    const task = await getTask(db, "nonexistent");
    expect(task).toBeNull();
  });
});

describe("listTasks", () => {
  it("lists all tasks", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "producer", queues: [] });
    await createTask(db, { agentId, name: "Task 1" });
    await createTask(db, { agentId, name: "Task 2" });
    const tasks = await listTasks(db);
    expect(tasks).toHaveLength(2);
  });

  it("filters by agentId", async () => {
    const agentA = uniq("a"), agentB = uniq("a");
    await registerAgent(db, { agentId: agentA, name: "A", role: "producer", queues: [] });
    await registerAgent(db, { agentId: agentB, name: "B", role: "producer", queues: [] });
    await createTask(db, { agentId: agentA, name: "A Task" });
    await createTask(db, { agentId: agentB, name: "B Task" });
    const tasks = await listTasks(db, { agentId: agentA });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].agentId).toBe(agentA);
  });

  it("filters by status", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "producer", queues: [] });
    const t1 = await createTask(db, { agentId, name: "Task 1" });
    await updateTask(db, t1.taskId!, agentId, "completed");
    await createTask(db, { agentId, name: "Task 2" });
    const pending = await listTasks(db, { status: "pending" });
    const completed = await listTasks(db, { status: "completed" });
    expect(pending).toHaveLength(1);
    expect(completed).toHaveLength(1);
  });
});

describe("updateTask", () => {
  it("updates task status", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "producer", queues: [] });
    const task = await createTask(db, { agentId, name: "Task" });
    const result = await updateTask(db, task.taskId!, agentId, "running");
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(1);

    const updated = await getTask(db, task.taskId!);
    expect(updated!.status).toBe("running");
  });

  it("rejects invalid status", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "producer", queues: [] });
    const task = await createTask(db, { agentId, name: "Task" });
    const result = await updateTask(db, task.taskId!, agentId, "invalid");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid status");
  });
});

describe("cancelTask", () => {
  it("cancels a pending task", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "producer", queues: [] });
    const task = await createTask(db, { agentId, name: "Task" });
    const result = await cancelTask(db, task.taskId!, agentId);
    expect(result.ok).toBe(true);
    expect(result.cancelled).toBe(1);

    const cancelled = await getTask(db, task.taskId!);
    expect(cancelled!.status).toBe("cancelled");
  });
});

describe("push notification", () => {
  it("sets and gets push notifications", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "producer", queues: [] });
    await setPushNotification(db, { agentId, webhookUrl: "https://example.com/hook", secret: "s3cret" });
    const subs = await getPushNotification(db, agentId);
    expect(subs).toHaveLength(1);
    expect(subs[0].targetUrl).toBe("https://example.com/hook");
    expect(subs[0].secret).toBe("s3cret");
    expect(subs[0].scope).toBe("a2a");
  });

  it("returns empty array for agent with no subscriptions", async () => {
    const subs = await getPushNotification(db, "unknown");
    expect(subs).toHaveLength(0);
  });
});

describe("sendToTask", () => {
  it("sends a message to an existing task", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "producer", queues: [] });
    const created = await createTask(db, { agentId, name: "Test Task" });
    const result = await sendToTask(db, { taskId: created.taskId!, agentId, message: { text: "Hello" } });
    expect(result.ok).toBe(true);
    expect(result.pointerId).toBeDefined();

    const task = await getTask(db, created.taskId!);
    expect(task!.messages).toHaveLength(2);
  });

  it("rejects non-existent task", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "producer", queues: [] });
    const result = await sendToTask(db, { taskId: "nonexistent", agentId, message: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("rejects message to completed task", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "producer", queues: [] });
    const created = await createTask(db, { agentId, name: "Task" });
    await updateTask(db, created.taskId!, agentId, "completed");
    const result = await sendToTask(db, { taskId: created.taskId!, agentId, message: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("already completed");
  });

  it("sends message with metadata", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "producer", queues: [] });
    const created = await createTask(db, { agentId, name: "Task" });
    const result = await sendToTask(db, {
      taskId: created.taskId!,
      agentId,
      message: { type: "response", data: "answer" },
      messageId: "msg-123",
      metadata: { priority: "high" },
    });
    expect(result.ok).toBe(true);
  });
});
