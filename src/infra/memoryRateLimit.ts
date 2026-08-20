/**
 * Process-local rate limit fallback for non-production / when Redis not required.
 * Never used as a substitute when REQUIRE_DISTRIBUTED_RATE_LIMIT=true.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkMemoryRateLimit(
  key: string,
  limit: number,
  windowSec: number
): { allowed: boolean; remaining: number; retryAfterSec?: number } {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  let entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    buckets.set(key, entry);
  }
  entry.count += 1;
  if (entry.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, remaining: Math.max(0, limit - entry.count) };
}

/** Test helper */
export function resetMemoryRateLimits(): void {
  buckets.clear();
}
