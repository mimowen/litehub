// src/core/webhook.test.ts — Webhook / Push notification tests
import { describe, it, expect, beforeEach } from "vitest";
import { getDbClient, resetDb } from "../adapters/db/sqlite.js";
import type { DbClient } from "../adapters/db/interface.js";
import {
  setPushSubscription, getPushSubscriptions,
  logWebhook, getWebhookLogs,
} from "./webhook.js";

process.env.LITEHUB_DB = ":memory:";

let db: DbClient;
let uid = 0;
const uniq = (prefix: string) => `${prefix}-${++uid}-${Date.now()}`;

beforeEach(() => {
  resetDb();
  db = getDbClient();
});

describe("setPushSubscription / getPushSubscriptions", () => {
  it("creates a push subscription", async () => {
    const agentId = uniq("a");
    const result = await setPushSubscription(db, {
      agentId,
      webhookUrl: "https://example.com/webhook",
      secret: "my-secret",
      scope: "queue",
    });
    expect(result.ok).toBe(true);
  });

  it("retrieves push subscriptions by scope", async () => {
    const agentId = uniq("a");
    await setPushSubscription(db, {
      agentId,
      webhookUrl: "https://example.com/hook1",
      scope: "queue",
    });
    await setPushSubscription(db, {
      agentId,
      webhookUrl: "https://example.com/hook2",
      scope: "a2a",
    });

    const queueSubs = await getPushSubscriptions(db, agentId, "queue");
    expect(queueSubs).toHaveLength(1);
    expect(queueSubs[0].targetUrl).toBe("https://example.com/hook1");

    const a2aSubs = await getPushSubscriptions(db, agentId, "a2a");
    expect(a2aSubs).toHaveLength(1);
    expect(a2aSubs[0].targetUrl).toBe("https://example.com/hook2");
  });

  it("returns empty for unknown agent", async () => {
    const subs = await getPushSubscriptions(db, "unknown", "queue");
    expect(subs).toHaveLength(0);
  });

  it("creates subscription with taskId as scopeName", async () => {
    const agentId = uniq("a");
    await setPushSubscription(db, {
      agentId,
      taskId: "task-123",
      webhookUrl: "https://example.com/task-hook",
      scope: "a2a",
    });
    const subs = await getPushSubscriptions(db, agentId, "a2a");
    expect(subs).toHaveLength(1);
    expect(subs[0].scopeName).toBe("task-123");
  });
});

describe("logWebhook / getWebhookLogs", () => {
  it("logs a webhook payload", async () => {
    await logWebhook(db, '{"event":"test"}', '{"content-type":"application/json"}');
    const logs = await getWebhookLogs(db);
    expect(logs).toHaveLength(1);
    expect(logs[0].payload).toBe('{"event":"test"}');
    expect(logs[0].receivedAt).toBeTruthy();
  });

  it("logs multiple webhooks and respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await logWebhook(db, `{"event":"event-${i}"}`);
    }
    const logs = await getWebhookLogs(db, 3);
    expect(logs).toHaveLength(3);
    expect(logs[0].payload).toBe('{"event":"event-4"}'); // most recent first
  });

  it("returns empty for no logs", async () => {
    const logs = await getWebhookLogs(db);
    expect(logs).toHaveLength(0);
  });
});
