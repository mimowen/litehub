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
      lineage TEXT DEFAULT '[]',
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
    { sql: `CREATE TABLE IF NOT EXISTS pools (
      name TEXT PRIMARY KEY,
      description TEXT DEFAULT '',
      guidelines TEXT DEFAULT '你是 Pool 中的协作者。参考他人的工作成果，但不要干预或修改他人的任务。只负责你自己的分析和执行。',
      max_members INTEGER DEFAULT 20,
      created_at TEXT DEFAULT (datetime('now'))
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS pool_members (
      pool TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (pool, agent_id)
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS pool_messages (
      id TEXT PRIMARY KEY,
      pool TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      reply_to TEXT,
      tags TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    )`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_pool_messages_pool ON pool_messages(pool, created_at)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_pool_messages_reply ON pool_messages(reply_to)`, args: [] },
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

// ─── Auth ────────────────────────────────────────────────────────────────

const AUTH_TOKENS = buildTokenSet();

function buildTokenSet(): Set<string> {
  const primary = process.env.LITEHUB_TOKEN || "";
  const extra = process.env.LITEHUB_TOKENS || "";
  const set = new Set<string>();
  if (primary) set.add(primary);
  for (const t of extra.split(",").map((s) => s.trim()).filter(Boolean)) {
    set.add(t);
  }
  return set;
}

export function authEnabled(): boolean {
  return AUTH_TOKENS.size > 0;
}

/**
 * Validate Bearer token from request.
 * Returns null if auth is disabled or token matches, otherwise returns a 401 Response.
 */
export function validateAuth(request: Request): Response | null {
  if (!authEnabled()) return null; // auth disabled

  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token || !AUTH_TOKENS.has(token)) {
    return jsonResponse({ ok: false, error: "Unauthorized: missing or invalid Bearer token" }, 401);
  }
  return null;
}
