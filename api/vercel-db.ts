// src/vercel-db.ts — Turso database client for Vercel serverless (HTTP mode)
import { createClient, type Client } from "@libsql/client/http";

let _client: Client | null = null;

export function getDb(): Client {
  if (_client) return _client;
  const url = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL || "";
  if (!url) throw new Error("Missing TURSO_URL environment variable");
  _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || "" });
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
