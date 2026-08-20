/**
 * Distributed rate limiting — Upstash REST and/or Redis URL (Render Key Value).
 * Returns null when not configured — callers must fail-closed for sensitive ops.
 */
export type RateLimitMode = 'distributed' | 'memory' | 'unavailable';

export type RateLimitCheck = {
  allowed: boolean;
  remaining: number;
  mode: RateLimitMode;
  retryAfterSec?: number;
};

export function rateLimitConfigured(): boolean {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
      process.env.REDIS_URL ||
      process.env.RENDER_REDIS_URL
  );
}

async function checkViaUpstash(
  key: string,
  limit: number,
  windowSec: number
): Promise<RateLimitCheck | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    const bucket = `rl:${key}:${Math.floor(Date.now() / (windowSec * 1000))}`;
    const incrRes = await fetch(`${url}/incr/${encodeURIComponent(bucket)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const incrData = (await incrRes.json()) as { result?: number };
    const count = incrData.result ?? 1;
    if (count === 1) {
      await fetch(`${url}/expire/${encodeURIComponent(bucket)}/${windowSec}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      mode: 'distributed',
      retryAfterSec: count > limit ? windowSec : undefined,
    };
  } catch {
    return { allowed: false, remaining: 0, mode: 'unavailable', retryAfterSec: windowSec };
  }
}

async function checkViaRedisUrl(
  key: string,
  limit: number,
  windowSec: number
): Promise<RateLimitCheck | null> {
  const redisUrl = process.env.REDIS_URL || process.env.RENDER_REDIS_URL;
  if (!redisUrl) return null;

  try {
    // Dynamic import keeps Upstash-only deploys lightweight when redis pkg unused at runtime
    const { createClient } = await import('redis');
    const client = createClient({ url: redisUrl });
    client.on('error', () => undefined);
    await client.connect();
    try {
      const bucket = `rl:${key}:${Math.floor(Date.now() / (windowSec * 1000))}`;
      const count = await client.incr(bucket);
      if (count === 1) {
        await client.expire(bucket, windowSec);
      }
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        mode: 'distributed',
        retryAfterSec: count > limit ? windowSec : undefined,
      };
    } finally {
      await client.quit().catch(() => undefined);
    }
  } catch {
    return { allowed: false, remaining: 0, mode: 'unavailable', retryAfterSec: windowSec };
  }
}

export async function checkDistributedRateLimit(
  key: string,
  limit: number,
  windowSec: number
): Promise<RateLimitCheck | null> {
  const upstash = await checkViaUpstash(key, limit, windowSec);
  if (upstash) return upstash;
  return checkViaRedisUrl(key, limit, windowSec);
}

export function requireDistributedRateLimit(): boolean {
  return (process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT || 'false').toLowerCase() === 'true';
}
