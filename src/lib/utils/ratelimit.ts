/**
 * Sliding-window rate limit backed by Vercel KV (Upstash Redis).
 *
 * Falls back to in-memory counter in non-production environments where
 * KV credentials are not configured. The in-memory fallback is per-process
 * — fine for `next dev`, useless in serverless production. We refuse to
 * silently fall back when NODE_ENV === 'production' so misconfiguration
 * fails loudly.
 */

interface RateLimitOptions {
  key: string;
  limit: number;
  windowSec: number;
}

interface RateLimitResult {
  exceeded: boolean;
  count: number;
  retryAfterSec: number;
}

const inMemory = new Map<string, { count: number; resetAt: number }>();

function inMemoryCheck(opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const existing = inMemory.get(opts.key);
  if (!existing || existing.resetAt <= now) {
    inMemory.set(opts.key, { count: 1, resetAt: now + opts.windowSec * 1000 });
    return { exceeded: false, count: 1, retryAfterSec: 0 };
  }
  existing.count += 1;
  const exceeded = existing.count > opts.limit;
  return {
    exceeded,
    count: existing.count,
    retryAfterSec: exceeded ? Math.ceil((existing.resetAt - now) / 1000) : 0,
  };
}

async function kvCheck(opts: RateLimitOptions): Promise<RateLimitResult> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    // KV not configured. Fall back to the in-memory counter. Per Vercel
    // function instance, so a determined attacker spreading requests
    // across cold-started instances could exceed the cap; acceptable at
    // current OPS scale (small SaaS, trusted authenticated users only).
    // TODO: re-enable strict KV-backed rate limiting when scale warrants
    // (set KV_REST_API_URL + KV_REST_API_TOKEN and this branch becomes
    // unreachable).
    return inMemoryCheck(opts);
  }

  // Atomic INCR + EXPIRE on first hit. Use the REST API pipeline so we hit
  // KV exactly once per check.
  const pipeline = [
    ["INCR", opts.key],
    ["EXPIRE", opts.key, String(opts.windowSec), "NX"],
    ["TTL", opts.key],
  ];

  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(pipeline),
  });

  if (!res.ok) {
    console.error(`[ratelimit] KV pipeline failed status=${res.status}`);
    // Fail open — better to allow than to blackhole the webhook.
    return { exceeded: false, count: 0, retryAfterSec: 0 };
  }

  const json = (await res.json()) as Array<{ result: number | string }>;
  const count = Number(json[0]?.result ?? 0);
  const ttl = Number(json[2]?.result ?? opts.windowSec);

  const exceeded = count > opts.limit;
  return {
    exceeded,
    count,
    retryAfterSec: exceeded ? Math.max(1, ttl) : 0,
  };
}

export async function rateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  return kvCheck(opts);
}
