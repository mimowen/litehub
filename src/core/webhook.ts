// src/core/webhook.ts — Push notification + Webhook 触发逻辑（平台无关）
import type { DbClient } from "../adapters/db/interface.js";

// ─── Push Notification ────────────────────────────────────────────────────

export interface PushSubscription {
  id: string;
  subscriberId: string;
  targetUrl: string;
  scope: string;
  scopeName: string;
  secret?: string;
  createdAt: string;
}

/**
 * Fire a webhook to a single URL (non-blocking, best-effort)
 */
export async function firePushNotification(
  webhookUrl: string,
  payload: object,
  secret?: string,
): Promise<void> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret) headers["X-LiteHub-Secret"] = secret;
    // A2A spec compliant payload wrapping
    const a2aPayload = {
      jsonrpc: "2.0",
      method: "notifications/task_updated",
      params: payload,
    };
    await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(a2aPayload),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* non-critical */
  }
}

/**
 * Notify all subscribers for a given scope/scopeName
 */
export async function notifySubscribers(
  db: DbClient,
  scope: string,
  scopeName: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const result = await db.execute(
    "SELECT target_url, secret FROM push_subscriptions WHERE scope = ? AND scope_name = ?",
    [scope, scopeName],
  );

  for (const row of result.rows) {
    let payload: Record<string, unknown>;
    if (scope === "a2a" || scope === "queue") {
      const pointerId = (data as any).pointerId || (data as any).messageId || scopeName;
      const status =
        event.includes("produced") || event.includes("created")
          ? "pending"
          : event.includes("consumed")
            ? "working"
            : event.includes("completed")
              ? "completed"
              : event.includes("cancelled")
                ? "cancelled"
                : "pending";
      payload = { event: "task_updated", taskId: pointerId, status, ...data };
    } else {
      payload = { event, scope, scopeName, ...data };
    }
    firePushNotification(row.target_url as string, payload, row.secret as string | undefined);
  }
}

// ─── Push Subscription CRUD ───────────────────────────────────────────────

export async function setPushSubscription(
  db: DbClient,
  params: {
    agentId: string;
    taskId?: string;
    webhookUrl: string;
    secret?: string;
    scope?: string;
  },
): Promise<{ ok: boolean; message: string }> {
  const { agentId, taskId, webhookUrl, secret, scope = "a2a" } = params;
  const scopeName = taskId || agentId;
  const id = `${agentId}-${scope}-${Date.now()}`;

  await db.execute(
    `INSERT OR REPLACE INTO push_subscriptions (id, subscriber_id, target_url, scope, scope_name, secret, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [id, agentId, webhookUrl, scope, scopeName, secret ?? ""],
  );

  return { ok: true, message: "Push notification configured" };
}

export async function getPushSubscriptions(
  db: DbClient,
  agentId: string,
  scope = "a2a",
): Promise<PushSubscription[]> {
  const result = await db.execute(
    "SELECT id, subscriber_id, target_url, scope, scope_name, secret, created_at FROM push_subscriptions WHERE subscriber_id = ? AND scope = ?",
    [agentId, scope],
  );

  return result.rows.map((r) => ({
    id: r.id as string,
    subscriberId: r.subscriber_id as string,
    targetUrl: r.target_url as string,
    scope: r.scope as string,
    scopeName: r.scope_name as string,
    secret: r.secret as string,
    createdAt: r.created_at as string,
  }));
}

// ─── Webhook Logs (持久化) ────────────────────────────────────────────────

export async function logWebhook(
  db: DbClient,
  payload: string,
  headers?: string,
): Promise<void> {
  await db.execute(
    "INSERT INTO webhook_logs (payload, headers, received_at) VALUES (?, ?, datetime('now'))",
    [payload, headers || "{}"],
  );
}

export async function getWebhookLogs(
  db: DbClient,
  limit = 20,
): Promise<{ id: number; payload: string; headers: string; receivedAt: string }[]> {
  const result = await db.execute(
    "SELECT id, payload, headers, received_at FROM webhook_logs ORDER BY id DESC LIMIT ?",
    [limit],
  );
  return result.rows.map((r) => ({
    id: r.id as number,
    payload: r.payload as string,
    headers: r.headers as string,
    receivedAt: r.received_at as string,
  }));
}
