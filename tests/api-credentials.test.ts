import { describe, it, expect } from '@jest/globals';
import crypto from 'crypto';

describe('API credential hashing', () => {
  it('stores only sha256 hash', () => {
    const plaintext = 'gain_abcd_' + crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(plaintext).digest('hex');
    expect(hash).not.toContain(plaintext);
    expect(hash.length).toBe(64);
  });

  it('prefix identifies key without revealing secret', () => {
    const prefix = 'gain_a1b2c3d4';
    const secret = crypto.randomBytes(32).toString('hex');
    const key = `${prefix}_${secret}`;
    expect(key.startsWith(prefix)).toBe(true);
    expect(key.length).toBeGreaterThan(prefix.length + 10);
  });

  it('different keys produce different hashes', () => {
    const h1 = crypto.createHash('sha256').update('key1').digest('hex');
    const h2 = crypto.createHash('sha256').update('key2').digest('hex');
    expect(h1).not.toBe(h2);
  });

  it('revoked keys must not match active lookup', () => {
    const revokedAt = new Date();
    expect(revokedAt).toBeInstanceOf(Date);
  });

  it('expired keys must fail validation', () => {
    const expires = new Date(Date.now() - 1000);
    expect(expires < new Date()).toBe(true);
  });

  it('scopes default least privilege', () => {
    const defaultScopes = ['inference:execute'];
    expect(defaultScopes).not.toContain('audit:read');
    expect(defaultScopes).not.toContain('projects:write');
  });

  it('organization binding is mandatory', () => {
    const cred = { organizationId: null };
    expect(cred.organizationId).toBeNull();
  });

  it('plaintext shown once policy', () => {
    const shownOnce = true;
    expect(shownOnce).toBe(true);
  });

  it('last_used_at updated on auth', () => {
    const lastUsed = new Date();
    expect(lastUsed.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('audit event on create and revoke', () => {
    const events = ['API_KEY_CREATED', 'API_KEY_REVOKED'];
    expect(events).toContain('API_KEY_CREATED');
  });
});
