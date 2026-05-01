// src/core/pool.test.ts — Pool core logic tests
import { describe, it, expect, beforeEach } from "vitest";
import { getDbClient, resetDb } from "../adapters/db/sqlite.js";
import type { DbClient } from "../adapters/db/interface.js";
import { registerAgent } from "./queue.js";
import {
  createPool, getPool, listPools,
  joinPool, leavePool, listMembers,
  speak, getMessages,
} from "./pool.js";

process.env.LITEHUB_DB = ":memory:";

let db: DbClient;
let uid = 0;
const uniq = (prefix: string) => `${prefix}-${++uid}-${Date.now()}`;

beforeEach(() => {
  resetDb();
  db = getDbClient();
});

describe("createPool", () => {
  it("creates a pool with defaults", async () => {
    const pool = await createPool(db, uniq("pool"));
    expect(pool.maxMembers).toBe(20);
    expect(pool.memberCount).toBe(0);
  });

  it("creates a pool with custom settings", async () => {
    const name = uniq("pool");
    const pool = await createPool(db, name, "desc", "guidelines", 5);
    expect(pool.name).toBe(name);
    expect(pool.description).toBe("desc");
    expect(pool.guidelines).toBe("guidelines");
    expect(pool.maxMembers).toBe(5);
  });
});

describe("getPool / listPools", () => {
  it("returns null for non-existent pool", async () => {
    const pool = await getPool(db, "nope");
    expect(pool).toBeNull();
  });

  it("lists all pools", async () => {
    const name1 = uniq("pool"), name2 = uniq("pool");
    await createPool(db, name1);
    await createPool(db, name2);
    const pools = await listPools(db);
    const names = pools.map(p => p.name);
    expect(names).toContain(name1);
    expect(names).toContain(name2);
  });
});

describe("joinPool / leavePool / listMembers", () => {
  it("allows agent to join a pool", async () => {
    const agentId = uniq("a"), poolName = uniq("pool");
    await registerAgent(db, { agentId, name: "A1", role: "both", queues: [] });
    await createPool(db, poolName);
    const result = await joinPool(db, poolName, agentId);
    expect(result.ok).toBe(true);
    const members = await listMembers(db, poolName);
    expect(members).toHaveLength(1);
    expect(members[0].agentId).toBe(agentId);
  });

  it("rejects unregistered agent", async () => {
    const poolName = uniq("pool");
    await createPool(db, poolName);
    const result = await joinPool(db, poolName, "unknown");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not registered");
  });

  it("allows agent to leave a pool", async () => {
    const agentId = uniq("a"), poolName = uniq("pool");
    await registerAgent(db, { agentId, name: "A1", role: "both", queues: [] });
    await createPool(db, poolName);
    await joinPool(db, poolName, agentId);
    await leavePool(db, poolName, agentId);
    const members = await listMembers(db, poolName);
    expect(members).toHaveLength(0);
  });
});

describe("speak / getMessages", () => {
  it("allows agent to speak in a pool", async () => {
    const agentId = uniq("a"), poolName = uniq("pool");
    await registerAgent(db, { agentId, name: "A1", role: "both", queues: [] });
    await createPool(db, poolName);
    await joinPool(db, poolName, agentId);
    const msg = await speak(db, poolName, agentId, "Hello!");
    expect("error" in msg).toBe(false);
    if (!("error" in msg)) {
      expect(msg.id).toBeDefined();
      expect(msg.content).toBe("Hello!");
    }
  });

  it("retrieves messages from a pool", async () => {
    const agentId = uniq("a"), poolName = uniq("pool");
    await registerAgent(db, { agentId, name: "A1", role: "both", queues: [] });
    await createPool(db, poolName);
    await joinPool(db, poolName, agentId);
    await speak(db, poolName, agentId, "Msg 1");
    await speak(db, poolName, agentId, "Msg 2");
    const result = await getMessages(db, poolName);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toBe("Msg 1");
    expect(result.messages[1].content).toBe("Msg 2");
  });
});
