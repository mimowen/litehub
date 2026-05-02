// src/middleware/auth.ts — Bearer Token authentication middleware
import type { MiddlewareHandler } from "hono";
import { getBaseUrl } from "../utils.js";

const PUBLIC_PATHS = new Set([
  "/.well-known/agent-card.json",
  "/api/webhook/test",
  "/api/agents", "/api/queues", "/api/pools",
  "/api/peek", "/api/skill", "/api/skills", "/api/dashboard",
  "/api/mcp",
  "/api/mcp/sse",
  "/api/a2a/tasks", "/api/acp/runs", "/api/acp/contexts", "/api/acp/agents",
]);

const PUBLIC_GET_PATTERNS = [
  /^\/api\/acp\/runs\/[^/]+\/stream$/,
  /^\/api\/a2a\/tasks\/[\w-]+$/,
  /^\/api\/acp\/runs\/[\w-]+$/,
  /^\/api\/acp\/contexts\/[\w-]+$/,
  /^\/api\/acp\/agents\/.+$/,
];

function isPublicPath(pathname: string, method: string): boolean {
  if (method === "GET" && PUBLIC_PATHS.has(pathname)) return true;
  if (pathname === "/api/webhook/test") return true;
  if (pathname === "/api/mcp/sse") return true;
  if (method === "GET" && PUBLIC_GET_PATTERNS.some((p) => p.test(pathname))) return true;
  return false;
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const token = process.env.LITEHUB_TOKEN || "";
  if (!token) return next();

  const fullUrl = new URL(c.req.url, getBaseUrl(c));
  const path = fullUrl.pathname;

  if (isPublicPath(path, c.req.method)) return next();

  const extraTokens = (process.env.LITEHUB_TOKENS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const validTokens = extraTokens.length > 0
    ? new Set([token, ...extraTokens])
    : new Set([token]);

  const header = c.req.header("Authorization") || "";
  const t = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!t || !validTokens.has(t)) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }

  await next();
};
