// src/core/queue.test.ts — Queue core logic tests
import { describe, it, expect, beforeEach } from "vitest";
import { getDbClient, resetDb } from "../adapters/db/sqlite.js";
import type { DbClient } from "../adapters/db/interface.js";
import {
  ensureAgent, registerAgent, getAgent, listAgents,
  queueExists, ensureQueue, listQueues,
  produce, consume, peek,
} from "./queue.js";

process.env.LITEHUB_DB = ":memory:";

let db: DbClient;
let uid = 0;
const uniq = (prefix: string) => `${prefix}-${++uid}-${Date.now()}`;

beforeEach(() => {
  resetDb();
  db = getDbClient();
});

describe("ensureAgent", () => {
  it("returns false for unknown agent", async () => {
    expect(await ensureAgent(db, "unknown")).toBe(false);
  });

  it("returns true after registration", async () => {
    await registerAgent(db, { agentId: uniq("a"), name: "Agent 1", role: "producer", queues: [] });
    const id = `a-1-${Date.now()}`;
    await registerAgent(db, { agentId: id, name: "Agent", role: "producer", queues: [] });
    expect(await ensureAgent(db, id)).toBe(true);
  });
});

describe("registerAgent", () => {
  it("registers an agent and creates queues", async () => {
    const result = await registerAgent(db, { agentId: uniq("a"), name: "Agent 1", role: "producer", queues: ["raw", "processed"] });
    expect(result.agent.agentId).toMatch(/^a-/);
    expect(result.agent.name).toBe("Agent 1");
    expect(result.agent.role).toBe("producer");
    expect(result.createdQueues).toContain("raw");
    expect(result.createdQueues).toContain("processed");
  });

  it("can list registered agents", async () => {
    const id1 = uniq("a"), id2 = uniq("a");
    await registerAgent(db, { agentId: id1, name: "Agent 1", role: "producer", queues: [] });
    await registerAgent(db, { agentId: id2, name: "Agent 2", role: "consumer", queues: [] });
    const agents = await listAgents(db);
    const ids = agents.map(a => a.agentId);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it("can get a single agent", async () => {
    const id = uniq("a");
    await registerAgent(db, { agentId: id, name: "Agent 1", role: "both", queues: ["q1"] });
    const agent = await getAgent(db, id);
    expect(agent).not.toBeNull();
    expect(agent!.agentId).toBe(id);
    expect(agent!.queues).toEqual(["q1"]);
  });
});

describe("queue operations", () => {
  it("ensures queue exists", async () => {
    const qn = uniq("q");
    expect(await queueExists(db, qn)).toBe(false);
    await ensureQueue(db, qn, "test queue", "creator");
    expect(await queueExists(db, qn)).toBe(true);
  });

  it("lists queues with stats", async () => {
    const qn = uniq("q");
    await registerAgent(db, { agentId: uniq("a"), name: "A1", role: "producer", queues: [qn] });
    const queues = await listQueues(db);
    expect(queues.find(q => q.name === qn)).toBeDefined();
  });
});

describe("produce / consume / peek", () => {
  it("produces data to a queue", async () => {
    const qn = uniq("q");
    const prodId = uniq("prod");
    await registerAgent(db, { agentId: prodId, name: "Producer", role: "producer", queues: [qn] });
    const pointer = await produce(db, qn, "Hello World", prodId);
    expect(pointer).not.toBeNull();
    expect(pointer!.queue).toBe(qn);
    expect(pointer!.producerId).toBe(prodId);
    expect(pointer!.size).toBe(11);
  });

  it("returns null when producing to non-existent queue", async () => {
    const pointer = await produce(db, "nonexistent", "data", "agent");
    expect(pointer).toBeNull();
  });

  it("consumes data from a queue (FIFO)", async () => {
    const qn = uniq("q");
    const prodId = uniq("prod"), consId = uniq("cons");
    await registerAgent(db, { agentId: prodId, name: "Producer", role: "producer", queues: [qn] });
    await registerAgent(db, { agentId: consId, name: "Consumer", role: "consumer", queues: [] });
    await produce(db, qn, "First", prodId);
    await produce(db, qn, "Second", prodId);

    const items = await consume(db, qn, consId, 1);
    expect(items).toHaveLength(1);
    expect(items[0].data).toBe("First");
    expect(items[0].text).toBe("First");
  });

  it("detects loops (same agent produced and consumed)", async () => {
    const qn = uniq("q");
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "both", queues: [qn] });
    await produce(db, qn, "data", agentId);
    const items = await consume(db, qn, agentId, 1, { loopDetection: true });
    expect(items).toHaveLength(0); // skipped due to loop
  });

  it("peeks without consuming", async () => {
    const qn = uniq("q");
    const prodId = uniq("prod");
    await registerAgent(db, { agentId: prodId, name: "Producer", role: "producer", queues: [qn] });
    await produce(db, qn, "visible", prodId);
    const p1 = await peek(db, qn);
    expect(p1).not.toBeNull();
    expect(p1!.producerId).toBe(prodId);
    // Peek again — still there
    const p2 = await peek(db, qn);
    expect(p2).not.toBeNull();
  });

  it("returns empty array when queue is empty", async () => {
    const qn = uniq("q");
    const prodId = uniq("prod"), consId = uniq("cons");
    await registerAgent(db, { agentId: prodId, name: "Producer", role: "producer", queues: [qn] });
    await registerAgent(db, { agentId: consId, name: "Consumer", role: "consumer", queues: [] });
    const items = await consume(db, qn, consId, 1);
    expect(items).toHaveLength(0);
  });
});
