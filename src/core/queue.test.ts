// src/core/queue.test.ts — Queue core logic tests
import { describe, it, expect, beforeEach } from "vitest";
import { getDbClient, resetDb } from "../adapters/db/sqlite.js";
import type { DbClient } from "../adapters/db/interface.js";
import {
  ensureAgent, registerAgent, getAgent, listAgents,
  queueExists, ensureQueue, listQueues,
  produce, consume, peek,
  deleteAgent, blockQueue, unblockQueue, getQueueStatus,
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

describe("deleteAgent", () => {
  it("deletes an existing agent", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "producer", queues: [] });
    expect(await getAgent(db, agentId)).not.toBeNull();
    
    const result = await deleteAgent(db, agentId);
    expect(result.success).toBe(true);
    expect(result.message).toContain("unregistered");
    
    expect(await getAgent(db, agentId)).toBeNull();
  });

  it("returns error for non-existent agent", async () => {
    const result = await deleteAgent(db, "non-existent");
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("prevents deleted agent from consuming", async () => {
    const qn = uniq("q");
    const prodId = uniq("prod"), consId = uniq("cons");
    await registerAgent(db, { agentId: prodId, name: "Producer", role: "producer", queues: [qn] });
    await registerAgent(db, { agentId: consId, name: "Consumer", role: "consumer", queues: [] });
    await produce(db, qn, "data", prodId);
    
    await deleteAgent(db, consId);
    
    await expect(consume(db, qn, consId, 1)).rejects.toThrow("not registered");
  });
});

describe("blockQueue", () => {
  it("blocks a queue", async () => {
    const qn = uniq("q");
    await ensureQueue(db, qn);
    
    const result = await blockQueue(db, qn);
    expect(result.success).toBe(true);
    
    const status = await getQueueStatus(db, qn);
    expect(status!.blocked).toBe(true);
  });

  it("returns error for non-existent queue", async () => {
    const result = await blockQueue(db, "non-existent");
    expect(result.success).toBe(false);
  });

  it("prevents consumption from blocked queue", async () => {
    const qn = uniq("q");
    const prodId = uniq("prod"), consId = uniq("cons");
    await registerAgent(db, { agentId: prodId, name: "Producer", role: "producer", queues: [qn] });
    await registerAgent(db, { agentId: consId, name: "Consumer", role: "consumer", queues: [] });
    await produce(db, qn, "data", prodId);
    
    await blockQueue(db, qn);
    
    const result = await consume(db, qn, consId, 1);
    expect(result).toEqual([]);
  });
});

describe("unblockQueue", () => {
  it("unblocks a blocked queue", async () => {
    const qn = uniq("q");
    await ensureQueue(db, qn);
    await blockQueue(db, qn);
    
    const result = await unblockQueue(db, qn);
    expect(result.success).toBe(true);
    
    const status = await getQueueStatus(db, qn);
    expect(status!.blocked).toBe(false);
  });

  it("allows consumption after unblock", async () => {
    const qn = uniq("q");
    const prodId = uniq("prod"), consId = uniq("cons");
    await registerAgent(db, { agentId: prodId, name: "Producer", role: "producer", queues: [qn] });
    await registerAgent(db, { agentId: consId, name: "Consumer", role: "consumer", queues: [] });
    await produce(db, qn, "data", prodId);
    
    await blockQueue(db, qn);
    await unblockQueue(db, qn);
    
    const items = await consume(db, qn, consId, 1);
    expect(items).toHaveLength(1);
  });
});

describe("many-to-many queues", () => {
  it("supports multiple producers and consumers on same queue", async () => {
    const qn = uniq("q");
    const prod1 = uniq("prod"), prod2 = uniq("prod"), cons1 = uniq("cons"), cons2 = uniq("cons");
    
    await registerAgent(db, { agentId: prod1, name: "P1", role: "producer", queues: [qn] });
    await registerAgent(db, { agentId: prod2, name: "P2", role: "producer", queues: [qn] });
    await registerAgent(db, { agentId: cons1, name: "C1", role: "consumer", queues: [] });
    await registerAgent(db, { agentId: cons2, name: "C2", role: "consumer", queues: [] });
    
    await produce(db, qn, "from-p1", prod1);
    await produce(db, qn, "from-p2", prod2);
    
    const items1 = await consume(db, qn, cons1, 1);
    expect(items1).toHaveLength(1);
    expect(items1[0].text).toBe("from-p1");
    
    const items2 = await consume(db, qn, cons2, 1);
    expect(items2).toHaveLength(1);
    expect(items2[0].text).toBe("from-p2");
  });

  it("one agent can produce to multiple queues", async () => {
    const q1 = uniq("q"), q2 = uniq("q");
    const prodId = uniq("prod");
    await registerAgent(db, { agentId: prodId, name: "Multi-Producer", role: "producer", queues: [q1, q2] });
    
    await produce(db, q1, "data-q1", prodId);
    await produce(db, q2, "data-q2", prodId);
    
    const consId = uniq("cons");
    await registerAgent(db, { agentId: consId, name: "C1", role: "consumer", queues: [q1, q2] });
    
    const items1 = await consume(db, q1, consId, 1);
    expect(items1[0].text).toBe("data-q1");
    const items2 = await consume(db, q2, consId, 1);
    expect(items2[0].text).toBe("data-q2");
  });

  it("one consumer can subscribe to multiple queues", async () => {
    const q1 = uniq("q"), q2 = uniq("q");
    const prod1 = uniq("prod"), prod2 = uniq("prod");
    await registerAgent(db, { agentId: prod1, name: "P1", role: "producer", queues: [q1] });
    await registerAgent(db, { agentId: prod2, name: "P2", role: "producer", queues: [q2] });
    
    const consId = uniq("cons");
    await registerAgent(db, { agentId: consId, name: "Multi-Consumer", role: "consumer", queues: [q1, q2] });
    
    await produce(db, q1, "from-q1", prod1);
    await produce(db, q2, "from-q2", prod2);
    
    const items1 = await consume(db, q1, consId, 1);
    expect(items1[0].text).toBe("from-q1");
    const items2 = await consume(db, q2, consId, 1);
    expect(items2[0].text).toBe("from-q2");
  });

  it("blocking one queue does not affect others", async () => {
    const q1 = uniq("q"), q2 = uniq("q");
    const prodId = uniq("prod"), consId = uniq("cons");
    await registerAgent(db, { agentId: prodId, name: "P", role: "producer", queues: [q1, q2] });
    await registerAgent(db, { agentId: consId, name: "C", role: "consumer", queues: [q1, q2] });
    
    await produce(db, q1, "data-q1", prodId);
    await produce(db, q2, "data-q2", prodId);
    
    await blockQueue(db, q1);
    
    const items1 = await consume(db, q1, consId, 1);
    expect(items1).toEqual([]);
    
    const items2 = await consume(db, q2, consId, 1);
    expect(items2).toHaveLength(1);
    expect(items2[0].text).toBe("data-q2");
  });

  it("listAgents returns pools field", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "A1", role: "both", queues: ["q1"] });
    const agents = await listAgents(db);
    const agent = agents.find(a => a.agentId === agentId);
    expect(agent).toBeDefined();
    expect(agent!.pools).toBeDefined();
  });
});
