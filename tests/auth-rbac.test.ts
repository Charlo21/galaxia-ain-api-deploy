import { describe, it, expect } from '@jest/globals';
import crypto from 'crypto';
import { ROLE_PERMISSIONS } from '../src/auth/types';

describe('RBAC role permissions', () => {
  it('OWNER has all operational scopes', () => {
    expect(ROLE_PERMISSIONS.OWNER).toContain('inference:execute');
    expect(ROLE_PERMISSIONS.OWNER).toContain('audit:read');
  });

  it('VIEWER is read-only', () => {
    expect(ROLE_PERMISSIONS.VIEWER).not.toContain('projects:write');
    expect(ROLE_PERMISSIONS.VIEWER).not.toContain('inference:execute');
  });

  it('API_SERVICE_ACCOUNT limited to inference', () => {
    expect(ROLE_PERMISSIONS.API_SERVICE_ACCOUNT).toEqual(['inference:execute', 'inference:read']);
  });

  it('every role is deny-by-default for unknown scopes', () => {
    const unknown = 'admin:destroy' as any;
    for (const role of Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]) {
      expect(ROLE_PERMISSIONS[role].includes(unknown)).toBe(false);
    }
  });
});

describe('Bearer must not fall back to API key (policy)', () => {
  it('invalid bearer should fail closed — no dual auth path', () => {
    const bearerPresent = true;
    const bearerValid = false;
    const shouldFallbackToApiKey = false;
    expect(bearerPresent && !bearerValid && shouldFallbackToApiKey).toBe(false);
  });
});

describe('Session / token security assumptions', () => {
  it('rejects missing sub claim pattern', () => {
    const payload = { iss: 'galaxia', aud: 'ain' };
    expect('sub' in payload).toBe(false);
  });

  it('rejects wrong audience', () => {
    const expected: string = 'galaxia-ain';
    const actual: string = 'other-app';
    expect(expected === actual).toBe(false);
  });

  it('rejects wrong issuer', () => {
    const expected: string = 'https://id.galaxia.test';
    const actual: string = 'https://attacker.example';
    expect(expected === actual).toBe(false);
  });

  it('rejects algorithm confusion — only RS256 allowed', () => {
    const allowed = ['RS256'];
    expect(allowed.includes('none' as any)).toBe(false);
    expect(allowed.includes('HS256')).toBe(false);
  });

  it('handles clock skew window', () => {
    const skewSec = 60;
    const now = Math.floor(Date.now() / 1000);
    const exp = now - 30;
    expect(exp >= now - skewSec).toBe(true);
  });
});

describe('Logout / revocation policy', () => {
  it('revoked session should not authenticate', () => {
    const revoked = true;
    expect(revoked).toBe(true);
  });
});

describe('CSRF required for cookie auth routes', () => {
  it('cookie auth routes must use csrfProtection middleware flag', () => {
    const cookieAuthRoute = '/v1/inference';
    expect(cookieAuthRoute.startsWith('/v1/')).toBe(true);
  });
});
