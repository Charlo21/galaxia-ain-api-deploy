import { describe, it, expect, beforeEach } from '@jest/globals';
import { checkMemoryRateLimit, resetMemoryRateLimits } from '../src/infra/memoryRateLimit';

describe('Memory rate limit (dev fallback)', () => {
  beforeEach(() => resetMemoryRateLimits());

  it('allows under limit', () => {
    const a = checkMemoryRateLimit('t1', 3, 60);
    expect(a.allowed).toBe(true);
  });

  it('blocks over limit', () => {
    checkMemoryRateLimit('t2', 2, 60);
    checkMemoryRateLimit('t2', 2, 60);
    const blocked = checkMemoryRateLimit('t2', 2, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });
});
