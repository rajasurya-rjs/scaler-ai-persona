// Best-effort in-memory rate limiter. Serverless instances are ephemeral so this
// is a soft guard against casual abuse of the public endpoints, not a hard SLA.

const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit = 20, windowMs = 60_000): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now > rec.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  rec.count += 1;
  if (rec.count > limit) {
    return { ok: false, retryAfter: Math.ceil((rec.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

export function clientKey(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "anon"
  );
}
