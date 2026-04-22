// api/_lib/turso.ts — Shared Turso client for Vercel Functions
// Vercel ignores files prefixed with _ in api/
import { createClient, Client } from "@libsql/client";

const TURSO_URL = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL || "";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "";

let _client: Client | null = null;

export function getClient(): Client {
  if (_client) return _client;
  if (!TURSO_URL) {
    throw new Error("Missing TURSO_URL or TURSO_DATABASE_URL environment variable");
  }
  _client = createClient({
    url: TURSO_URL,
    authToken: TURSO_AUTH_TOKEN,
  });
  return _client;
}

export async function initDb() {
  const db = getClient();
  await db.batch([
    { sql: `CREATE TABLE IF NOT EXISTS pointers (
      id TEXT PRIMARY KEY,
      queue TEXT NOT NULL,
      producer_id TEXT NOT NULL,
      data TEXT NOT NULL,
      size INTEGER NOT NULL,
      content_type TEXT DEFAULT 'text/plain',
      metadata TEXT DEFAULT '{}',
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    )`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_pointers_queue_status ON pointers(queue, status)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_pointers_queue ON pointers(queue)`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS queues (
      name TEXT PRIMARY KEY,
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      queues TEXT DEFAULT '[]',
      poll_interval INTEGER DEFAULT 0,
      registered_at TEXT DEFAULT (datetime('now'))
    )`, args: [] },
  ], "write");
}

export function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function parseBody(request: Request): Promise<any> {
  return request.json();
}
