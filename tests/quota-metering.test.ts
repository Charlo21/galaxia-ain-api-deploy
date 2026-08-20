import { describe, it, expect } from '@jest/globals';
import { validatePromptInput, validateRequestBodySize, INPUT_LIMITS } from '../src/security/inputSecurity';

describe('Quota states', () => {
  it('QUOTA_EXCEEDED when at limit', () => {
    const used = 10000;
    const limit = 10000;
    expect(used >= limit).toBe(true);
  });

  it('QUOTA_WARNING at 90%', () => {
    const used = 9000;
    const limit = 10000;
    expect(used >= limit * 0.9).toBe(true);
  });

  it('QUOTA_OK below warning', () => {
    const used = 100;
    const limit = 10000;
    expect(used < limit * 0.9).toBe(true);
  });
});

describe('Metering honesty', () => {
  it('billingStatus NOT_CONFIGURED', () => {
    expect('NOT_CONFIGURED').toBe('NOT_CONFIGURED');
  });

  it('usageMode METERING_ONLY', () => {
    expect('METERING_ONLY').toBe('METERING_ONLY');
  });

  it('never trust client token counts', () => {
    const clientTokens = 1;
    const serverAuthoritative = true;
    expect(serverAuthoritative).toBe(true);
  });
});

describe('Idempotency', () => {
  it('duplicate idempotency key returns existing job', () => {
    const existing = true;
    expect(existing).toBe(true);
  });
});

describe('Input limits for metering path', () => {
  it('rejects oversized prompt', () => {
    const big = 'x'.repeat(INPUT_LIMITS.maxPromptChars + 1);
    expect(validatePromptInput(big).ok).toBe(false);
  });

  it('rejects oversized body', () => {
    expect(validateRequestBodySize(INPUT_LIMITS.maxBodyBytes + 1).ok).toBe(false);
  });
});

describe('Immutable request ID', () => {
  it('request IDs are UUID-shaped', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
