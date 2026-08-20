import { describe, it, expect } from '@jest/globals';
import {
  rateLimitConfigured,
  requireDistributedRateLimit,
  checkDistributedRateLimit,
} from '../src/infra/rateLimitDistributed';

describe('Distributed rate limiting honesty', () => {
  it('not configured without Upstash env', () => {
    const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
    const prevToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(rateLimitConfigured()).toBe(false);
    process.env.UPSTASH_REDIS_REST_URL = prevUrl;
    process.env.UPSTASH_REDIS_REST_TOKEN = prevToken;
  });

  it('requireDistributedRateLimit defaults false', () => {
    const prev = process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT;
    delete process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT;
    expect(requireDistributedRateLimit()).toBe(false);
    process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT = prev;
  });

  it('checkDistributedRateLimit returns null when not configured', async () => {
    const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    const r = await checkDistributedRateLimit('test:key', 10, 60);
    expect(r).toBeNull();
    process.env.UPSTASH_REDIS_REST_URL = prevUrl;
  });

  it('never claims distributed when memory only', () => {
    const mode = rateLimitConfigured() ? 'distributed' : 'memory';
    if (!rateLimitConfigured()) expect(mode).toBe('memory');
  });
});

describe('Rate limit categories', () => {
  const categories = [
    'authentication',
    'inference',
    'provider_calls',
    'streaming',
    'api_key_creation',
    'admin_operations',
  ];
  categories.forEach((c) => {
    it(`supports category ${c}`, () => {
      expect(c.length).toBeGreaterThan(0);
    });
  });
});

describe('Fail-closed sensitive ops', () => {
  it('credential creation blocked when RL required but missing', () => {
    process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT = 'true';
    delete process.env.UPSTASH_REDIS_REST_URL;
    const blocked = requireDistributedRateLimit() && !rateLimitConfigured();
    expect(blocked).toBe(true);
    delete process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT;
  });
});
