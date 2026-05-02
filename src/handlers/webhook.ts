// src/handlers/webhook.ts — Webhook test handlers
import type { DbClient } from "../adapters/db/interface.js";
import { logWebhook, getWebhookLogs } from "../core/webhook.js";
import { ok, fail } from "../utils/response.js";

export async function handleWebhookTest(db: DbClient, payload: any, headers: Record<string, string>) {
  await logWebhook(db, JSON.stringify(payload), JSON.stringify(headers));
  return ok({ received: true });
}

export async function handleWebhookLogs(db: DbClient, limit = 20) {
  const logs = await getWebhookLogs(db, limit);
  return ok({ logs });
}
