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

  it("auto-joins creator as member when creatorId is provided", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "A1", role: "both", queues: [] });
    const poolName = uniq("pool");
    await createPool(db, poolName, "desc", undefined, undefined, agentId);
    const pool = await getPool(db, poolName);
    expect(pool).not.toBeNull();
    if (pool) {
      expect(pool.memberCount).toBe(1);
      expect(pool.creatorId).toBe(agentId);
    }
    const members = await listMembers(db, poolName);
    expect(members).toHaveLength(1);
    expect(members[0].agentId).toBe(agentId);
  });

  it("does not auto-join when no creatorId", async () => {
    const poolName = uniq("pool");
    await createPool(db, poolName);
    const pool = await getPool(db, poolName);
    expect(pool).not.toBeNull();
    if (pool) {
      expect(pool.memberCount).toBe(0);
    }
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
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe("Msg 1");
      expect(result.messages[1].content).toBe("Msg 2");
    }
  });

  it("rejects speaking to non-existent pool", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "A1", role: "both", queues: [] });
    const msg = await speak(db, "non-existent-pool", agentId, "Hello!");
    expect("error" in msg).toBe(true);
    if ("error" in msg) {
      expect(msg.error).toContain("not found");
    }
  });

  it("rejects speaking by non-member agent", async () => {
    const agentId1 = uniq("a1"), agentId2 = uniq("a2"), poolName = uniq("pool");
    await registerAgent(db, { agentId: agentId1, name: "A1", role: "both", queues: [] });
    await registerAgent(db, { agentId: agentId2, name: "A2", role: "both", queues: [] });
    await createPool(db, poolName);
    await joinPool(db, poolName, agentId1);
    const msg = await speak(db, poolName, agentId2, "Hello!");
    expect("error" in msg).toBe(true);
    if ("error" in msg) {
      expect(msg.error).toContain("not a member");
    }
  });

  it("rejects reading by non-member agent", async () => {
    const agentId1 = uniq("a1"), agentId2 = uniq("a2"), poolName = uniq("pool");
    await registerAgent(db, { agentId: agentId1, name: "A1", role: "both", queues: [] });
    await registerAgent(db, { agentId: agentId2, name: "A2", role: "both", queues: [] });
    await createPool(db, poolName);
    await joinPool(db, poolName, agentId1);
    await speak(db, poolName, agentId1, "Hello!");
    const result = await getMessages(db, poolName, agentId2);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("not a member");
    }
  });

  it("allows reading without agentId", async () => {
    const agentId = uniq("a"), poolName = uniq("pool");
    await registerAgent(db, { agentId, name: "A1", role: "both", queues: [] });
    await createPool(db, poolName);
    await joinPool(db, poolName, agentId);
    await speak(db, poolName, agentId, "Hello!");
    const result = await getMessages(db, poolName);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.messages).toHaveLength(1);
    }
  });

  it("rejects reading from blocked pool", async () => {
    const agentId = uniq("a"), poolName = uniq("pool");
    await registerAgent(db, { agentId, name: "A1", role: "both", queues: [] });
    await createPool(db, poolName);
    await joinPool(db, poolName, agentId);
    await speak(db, poolName, agentId, "Hello!");
    await db.execute("UPDATE pools SET blocked = 1 WHERE name = ?", [poolName]);
    const result = await getMessages(db, poolName, agentId);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("blocked");
    }
  });
});
