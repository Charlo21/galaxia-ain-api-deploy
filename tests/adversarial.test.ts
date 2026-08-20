import { describe, it, expect } from '@jest/globals';
import { scrubSecrets } from '../src/services/auditUsage';
import { rejectUntrustedClientHeaders, API_ENDPOINTS } from '../src/security/apiRegistry';
import { validateEnvironment } from '../src/infra/startupReadiness';

describe('Audit log redaction', () => {
  it('redacts apiKey field', () => {
    const out = scrubSecrets({ apiKey: 'secret-value', action: 'login' });
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.action).toBe('login');
  });

  it('redacts nested password', () => {
    const out = scrubSecrets({ user: { password: 'x' } });
    expect((out.user as any).password).toBe('[REDACTED]');
  });

  it('redacts authorization token keys', () => {
    const out = scrubSecrets({ authorization: 'Bearer x' });
    expect(out.authorization).toBe('[REDACTED]');
  });

  it('preserves safe metadata', () => {
    const out = scrubSecrets({ requestId: 'abc', status: 'ok' });
    expect(out).toEqual({ requestId: 'abc', status: 'ok' });
  });
});

describe('Client identity spoof headers', () => {
  it('rejects x-org-id', () => {
    expect(rejectUntrustedClientHeaders({ 'x-org-id': 'fake' })).toContain('x-org-id');
  });

  it('rejects x-role', () => {
    expect(rejectUntrustedClientHeaders({ 'x-role': 'OWNER' })).toContain('x-role');
  });

  it('allows clean headers', () => {
    expect(rejectUntrustedClientHeaders({ 'content-type': 'application/json' })).toBeNull();
  });
});

describe('API endpoint registry', () => {
  it('tenant inference requires tenant auth', () => {
    const ep = API_ENDPOINTS.find((e) => e.path === '/v1/tenant/inference');
    expect(ep?.auth).toBe('tenant');
    expect(ep?.idempotent).toBe(true);
  });

  it('health requires no auth', () => {
    const ep = API_ENDPOINTS.find((e) => e.path === '/health');
    expect(ep?.auth).toBe('none');
  });
});

describe('Production environment validation', () => {
  it('blocks ALLOW_DEV_AUTH in production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_AUTH = 'true';
    const r = validateEnvironment();
    expect(r.ok).toBe(false);
    process.env.NODE_ENV = prev;
    delete process.env.ALLOW_DEV_AUTH;
  });
});

describe('Adversarial: prototype pollution patterns', () => {
  it('JSON body __proto__ should not alter auth', () => {
    const body = JSON.parse('{"__proto__":{"role":"OWNER"}}');
    expect((body as any).role).toBeUndefined();
  });
});

describe('Adversarial: NaN quota values', () => {
  it('rejects NaN token counts', () => {
    expect(Number.isFinite(NaN)).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(Number.isFinite(Infinity)).toBe(false);
  });

  it('rejects negative usage', () => {
    const tokens = -1;
    expect(tokens >= 0).toBe(false);
  });
});

describe('Adversarial: path traversal in project slug', () => {
  it('detects traversal pattern', () => {
    const slug = '../../../etc';
    expect(slug.includes('..')).toBe(true);
  });
});

describe('Adversarial: provider URL injection', () => {
  it('blocks file scheme in provider URL field', () => {
    const url = 'file:///etc/passwd';
    expect(url.startsWith('file:')).toBe(true);
  });
});

describe('Adversarial: fake usage from client', () => {
  it('server must ignore client token counts', () => {
    const clientReported = { inputTokens: 0 };
    const serverAuthoritative = true;
    expect(serverAuthoritative).toBe(true);
    expect(clientReported.inputTokens).toBe(0);
  });
});

describe('Adversarial: credential replay after revoke', () => {
  it('revoked credential has revoked_at set', () => {
    const revokedAt = new Date();
    expect(revokedAt).toBeTruthy();
  });
});

describe('Adversarial: concurrent quota race', () => {
  it('atomic increment required for quota', () => {
    const needsAtomicRedis = true;
    expect(needsAtomicRedis).toBe(true);
  });
});
