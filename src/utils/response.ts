// src/utils/response.ts — Unified response helpers
export function ok<T>(data: T) {
  return { ok: true as const, ...data };
}

export function fail(error: string, status = 400) {
  return { ok: false as const, error, status };
}

export function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

export type HandlerResult = { ok: true; [k: string]: any } | { ok: false; error: string; status: number };

export function send(c: any, result: HandlerResult) {
  if (result.ok) return c.json(result);
  const { status, ...body } = result as any;
  return c.json(body, status || 400);
}
