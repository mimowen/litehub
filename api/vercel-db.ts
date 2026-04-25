// src/vercel-db.ts — Turso database client for Vercel serverless (HTTP mode)
import { createClient, type Client } from "@libsql/client/http";

// DDL: 所有表的 CREATE TABLE（idempotent，可重复执行）
const DDL = `
  CREATE TABLE IF NOT EXISTS pointers (
    id          TEXT PRIMARY KEY,
    queue       TEXT NOT NULL,
    producer_id TEXT NOT NULL,
    data        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    content_type TEXT DEFAULT 'text/plain',
    metadata    TEXT DEFAULT '{}',
    status      TEXT DEFAULT 'pending',
    lineage     TEXT DEFAULT '[]',
    created_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pointers_queue_status ON pointers(queue, status);
  CREATE INDEX IF NOT EXISTS idx_pointers_queue ON pointers(queue);

  CREATE TABLE IF NOT EXISTS queues (
    name        TEXT PRIMARY KEY,
    description TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agents (
    agent_id      TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL,
    queues        TEXT DEFAULT '[]',
    poll_interval INTEGER DEFAULT 0,
    registered_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pools (
    name        TEXT PRIMARY KEY,
    description TEXT DEFAULT '',
    guidelines  TEXT DEFAULT 'You are a collaborative agent in this Pool. Share progress transparently. Reference others'' work. Do not command other agents.',
    max_members INTEGER DEFAULT 20,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pool_members (
    pool      TEXT NOT NULL,
    agent_id  TEXT NOT NULL,
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (pool, agent_id)
  );

  CREATE TABLE IF NOT EXISTS pool_messages (
    id         TEXT PRIMARY KEY,
    pool       TEXT NOT NULL,
    agent_id   TEXT NOT NULL,
    content    TEXT NOT NULL,
    reply_to   TEXT,
    tags       TEXT DEFAULT '[]',
    metadata   TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pool_messages_pool ON pool_messages(pool, created_at);
  CREATE INDEX IF NOT EXISTS idx_pool_messages_reply ON pool_messages(reply_to);
`;

let _client: Client | null = null;
let _initialized = false;

async function initDb(client: Client) {
  if (_initialized) return;
  await client.execute(DDL);
  _initialized = true;
}

export async function getDb(): Promise<Client> {
  if (_client) {
    await initDb(_client);
    return _client;
  }
  const url = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL || "";
  if (!url) throw new Error("Missing TURSO_URL environment variable");
  _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || "" });
  await initDb(_client);
  return _client;
}

export function validateAuth(req: Request): boolean {
  const token = process.env.LITEHUB_TOKEN;
  const tokens = process.env.LITEHUB_TOKENS;
  if (!token && !tokens) return true; // Open mode
  const authHeader = req.headers.get("Authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (token && bearerToken === token) return true;
  if (tokens) {
    const allowed = tokens.split(",").map(t => t.trim());
    if (allowed.includes(bearerToken)) return true;
  }
  return false;
}

export function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function body(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}
