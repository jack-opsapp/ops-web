/**
 * Sliding-window rate limit backed by Vercel KV (Upstash Redis), with an
 * in-memory fallback when KV credentials are not present.
 *
 * Backend selection:
 *   - If `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set, every check
 *     pipelines INCR/EXPIRE/TTL against KV. This is the canonical mode
 *     when the project has a Vercel KV (Upstash Redis) integration
 *     attached — strict cross-instance enforcement.
 *   - If either env var is missing, the check falls back to a per-process
 *     in-memory counter. Per-Vercel-function-instance enforcement only —
 *     a determined attacker spreading requests across cold-started
 *     instances can exceed the configured cap. Acceptable at current OPS
 *     scale (small authenticated user base, no abuse observed). To
 *     re-enable strict KV-backed enforcement, attach a Vercel KV
 *     integration to the project and the env vars auto-populate.
 *
 * History: a previous revision threw in production when KV creds were
 * missing, on the theory that misconfiguration should fail loudly.
 * Reverted on 2026-05-15 after the May-12 photo upload outage was traced
 * to this throw — the project never had KV provisioned, and every
 * /api/uploads/presign call was returning 500 instead of degrading
 * gracefully. Soft fallback is now the prod path; restore strict
 * enforcement by attaching KV, not by re-throwing.
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
