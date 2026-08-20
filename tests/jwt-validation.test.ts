import { describe, it, expect } from '@jest/globals';
import crypto from 'crypto';
import { verifyHs256, validateClaims, JwtValidationError } from '../src/auth/jwtValidator';

function makeJwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

describe('JWT validation', () => {
  const secret = 'test-secret-key-for-jwt-validation';
  const now = Math.floor(Date.now() / 1000);

  it('accepts valid HS256 token', () => {
    const token = makeJwt({ sub: 'user-1', exp: now + 3600, iss: 'galaxia', aud: 'ain' }, secret);
    process.env.JWT_ISSUER = 'galaxia';
    process.env.JWT_AUDIENCE = 'ain';
    const payload = validateClaims(verifyHs256(token, secret));
    expect(payload.sub).toBe('user-1');
  });

  it('rejects missing sub', () => {
    const token = makeJwt({ exp: now + 3600 }, secret);
    expect(() => validateClaims(verifyHs256(token, secret))).toThrow(JwtValidationError);
  });

  it('rejects expired token', () => {
    const token = makeJwt({ sub: 'u1', exp: now - 120 }, secret);
    expect(() => validateClaims(verifyHs256(token, secret))).toThrow(JwtValidationError);
  });

  it('rejects wrong issuer', () => {
    process.env.JWT_ISSUER = 'expected-iss';
    const token = makeJwt({ sub: 'u1', exp: now + 3600, iss: 'wrong' }, secret);
    expect(() => validateClaims(verifyHs256(token, secret))).toThrow(JwtValidationError);
  });

  it('rejects wrong audience', () => {
    process.env.JWT_AUDIENCE = 'expected-aud';
    const token = makeJwt({ sub: 'u1', exp: now + 3600, aud: 'wrong' }, secret);
    expect(() => validateClaims(verifyHs256(token, secret))).toThrow(JwtValidationError);
  });

  it('rejects invalid signature', () => {
    const token = makeJwt({ sub: 'u1', exp: now + 3600 }, secret);
    expect(() => verifyHs256(token, 'wrong-secret')).toThrow(JwtValidationError);
  });

  it('rejects malformed JWT', () => {
    expect(() => verifyHs256('not.a.valid.jwt.token', secret)).toThrow(JwtValidationError);
  });

  it('rejects algorithm none header', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'u1' })).toString('base64url');
    expect(() => verifyHs256(`${header}.${body}.`, secret)).toThrow(JwtValidationError);
  });
});
