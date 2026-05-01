// src/core/acp.test.ts — ACP protocol adapter tests
import { describe, it, expect, beforeEach } from "vitest";
import { getDbClient, resetDb } from "../adapters/db/sqlite.js";
import type { DbClient } from "../adapters/db/interface.js";
import { registerAgent } from "./queue.js";
import {
  createRun, getRun, listRuns, cancelRun,
  createContext, getContext, listContexts,
  joinContext, leaveContext, speakContext,
  getContextMessages, getACPAgent,
} from "./acp.js";

process.env.LITEHUB_DB = ":memory:";

let db: DbClient;
let uid = 0;
const uniq = (prefix: string) => `${prefix}-${++uid}-${Date.now()}`;

beforeEach(() => {
  resetDb();
  db = getDbClient();
});

describe("createRun", () => {
  it("creates a run and returns runId", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "both", queues: [] });
    const result = await createRun(db, { agentId, name: "Test Run" });
    expect(result.ok).toBe(true);
    expect(result.runId).toBeDefined();
  });

  it("rejects unregistered agent", async () => {
    const result = await createRun(db, { agentId: "unknown", name: "Run" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not registered");
  });

  it("uses provided runId", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "both", queues: [] });
    const result = await createRun(db, { agentId, runId: "custom-run-id" });
    expect(result.ok).toBe(true);
    expect(result.runId).toBe("custom-run-id");
  });
});

describe("getRun", () => {
  it("returns run details with members", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "both", queues: [] });
    const created = await createRun(db, { agentId, name: "My Run", guidelines: "Be nice" });
    const run = await getRun(db, created.runId);
    expect(run).not.toBeNull();
    expect(run!.guidelines).toBe("Be nice");
    expect(run!.status).toBe("active");
  });

  it("returns null for non-existent run", async () => {
    const run = await getRun(db, "nonexistent");
    expect(run).toBeNull();
  });
});

describe("listRuns", () => {
  it("lists all runs", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "both", queues: [] });
    await createRun(db, { agentId, name: "Run 1" });
    await createRun(db, { agentId, name: "Run 2" });
    const runs = await listRuns(db);
    expect(runs).toHaveLength(2);
  });

  it("filters by agentId", async () => {
    const agentA = uniq("a"), agentB = uniq("a");
    await registerAgent(db, { agentId: agentA, name: "A", role: "both", queues: [] });
    await registerAgent(db, { agentId: agentB, name: "B", role: "both", queues: [] });
    await createRun(db, { agentId: agentA, name: "A Run" });
    await createRun(db, { agentId: agentB, name: "B Run" });
    const runs = await listRuns(db, { agentId: agentA });
    expect(runs).toHaveLength(1);
    expect(runs[0].creatorId).toBe(agentA);
  });
});

describe("cancelRun", () => {
  it("cancels an active run", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "both", queues: [] });
    const created = await createRun(db, { agentId, name: "Run" });
    const result = await cancelRun(db, created.runId, agentId);
    expect(result.ok).toBe(true);
    expect(result.cancelled).toBe(1);
  });
});

describe("createContext", () => {
  it("creates a context and returns contextId", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "both", queues: [] });
    const result = await createContext(db, { agentId, name: "My Context" });
    expect(result.ok).toBe(true);
    expect(result.contextId).toBeDefined();
  });

  it("rejects unregistered agent", async () => {
    const result = await createContext(db, { agentId: "unknown", name: "Ctx" });
    expect(result.ok).toBe(false);
  });
});

describe("getContext", () => {
  it("returns context details", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "both", queues: [] });
    const created = await createContext(db, { agentId, name: "My Context", guidelines: "Be helpful" });
    const ctx = await getContext(db, created.contextId);
    expect(ctx).not.toBeNull();
    expect(ctx!.guidelines).toBe("Be helpful");
  });

  it("returns null for non-existent context", async () => {
    const ctx = await getContext(db, "nonexistent");
    expect(ctx).toBeNull();
  });
});

describe("listContexts", () => {
  it("lists all contexts (excludes acp: prefixed pools)", async () => {
    const agentId = uniq("a");
    await registerAgent(db, { agentId, name: "Agent", role: "both", queues: [] });
    await createContext(db, { agentId, name: "Ctx 1" });
    await createContext(db, { agentId, name: "Ctx 2" });
    const contexts = await listContexts(db);
    expect(contexts).toHaveLength(2);
  });
});

describe("joinContext / leaveContext", () => {
  it("allows agent to join and leave a context", async () => {
    const agentId = uniq("a");
    const ctxId = uniq("ctx");
    await registerAgent(db, { agentId, name: "Agent", role: "both", queues: [] });
    await createContext(db, { agentId, contextId: ctxId, name: "Test" });

    const joinResult = await joinContext(db, ctxId, agentId);
    expect(joinResult.ok).toBe(true);

    const ctx = await getContext(db, ctxId);
    expect(ctx!.members).toHaveLength(1);
    expect(ctx!.members![0].agentId).toBe(agentId);

    const leaveResult = await leaveContext(db, ctxId, agentId);
    expect(leaveResult.ok).toBe(true);

    const ctxAfter = await getContext(db, ctxId);
    expect(ctxAfter!.members).toHaveLength(0);
  });
});

describe("speakContext / getContextMessages", () => {
  it("allows agent to speak in a context", async () => {
    const agentId = uniq("a");
    const ctxId = uniq("ctx");
    await registerAgent(db, { agentId, name: "Agent", role: "both", queues: [] });
    await createContext(db, { agentId, contextId: ctxId, name: "Test" });
    await joinContext(db, ctxId, agentId);

    const result = await speakContext(db, ctxId, agentId, "Hello Context!");
    expect(result.ok).toBe(true);
    expect(result.id).toBeDefined();

    const { messages } = await getContextMessages(db, ctxId);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Hello Context!");
  });
});

describe("getACPAgent", () => {
  it("returns agent with pool list", async () => {
    const agentId = uniq("a");
    const ctxId = uniq("ctx");
    await registerAgent(db, { agentId, name: "Agent", role: "both", queues: [] });
    await createContext(db, { agentId, contextId: ctxId, name: "Test" });
    await joinContext(db, ctxId, agentId);

    const agent = await getACPAgent(db, agentId);
    expect(agent).not.toBeNull();
    expect(agent!.agentId).toBe(agentId);
    expect(agent!.name).toBe("Agent");
    expect(agent!.pools).toContain(ctxId);
  });

  it("returns null for unknown agent", async () => {
    const agent = await getACPAgent(db, "unknown");
    expect(agent).toBeNull();
  });
});
