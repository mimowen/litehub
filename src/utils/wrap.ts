// src/utils/wrap.ts — Hono route wrapper: auto try/catch + send
import type { Context } from "hono";
import type { HandlerResult } from "./response.js";

export function wrap(handler: (c: Context) => Promise<HandlerResult>) {
  return async (c: Context) => {
    try {
      const result = await handler(c);
      if (result.ok) return c.json(result);
      const { status, ...body } = result as any;
      return c.json(body, status || 400);
    } catch (e: any) {
      return c.json({ ok: false as const, error: e.message }, 500);
    }
  };
}
