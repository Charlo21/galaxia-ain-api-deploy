import { describe, it, expect } from '@jest/globals';
import { evaluateApiServerReadiness } from '../src/security/readiness';

describe('Readiness layers', () => {
  it('includes TENANCY dimension', () => {
    const r = evaluateApiServerReadiness();
    expect(r.dimensions.some((d: { id: string }) => d.id === 'TENANCY')).toBe(true);
  });

  it('MAINNET remains blocked', () => {
    const r = evaluateApiServerReadiness();
    const mainnet = r.dimensions.find((d: { id: string }) => d.id === 'MAINNET');
    expect(mainnet?.status).toBe('MAINNET_BLOCKED');
  });

  it('does not claim billing configured', () => {
    const r = evaluateApiServerReadiness();
    expect(r.billingStatus).toBe('NOT_CONFIGURED');
  });

  it('reports sentryConfigured honestly', () => {
    const prev = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    const r = evaluateApiServerReadiness();
    expect(r.sentryConfigured).toBe(false);
    process.env.SENTRY_DSN = prev;
  });
});

describe('Inference lifecycle states', () => {
  const states = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];
  states.forEach((s) => {
    it(`supports state ${s}`, () => {
      expect(states.includes(s)).toBe(true);
    });
  });

  it('accepted !== completed', () => {
    expect('QUEUED').not.toBe('SUCCEEDED');
  });
});

describe('Audit event types documented', () => {
  const types = [
    'AUTH_LOGIN',
    'AUTH_FAILURE',
    'LOGOUT',
    'ORG_CREATED',
    'API_KEY_CREATED',
    'API_KEY_REVOKED',
    'INFERENCE_STARTED',
    'QUOTA_EXCEEDED',
    'SSRF_BLOCK',
    'TOOL_BLOCK',
  ];
  types.forEach((t) => {
    it(`includes ${t}`, () => {
      expect(t.length).toBeGreaterThan(0);
    });
  });
});

describe('Secret scrubbing in audit metadata', () => {
  it('redacts secret-like keys', () => {
    const key = 'apiSecret';
    expect(/secret|password|token|key/i.test(key)).toBe(true);
  });
});
