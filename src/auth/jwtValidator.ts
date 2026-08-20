/**
 * JWT validation — deny-by-default, algorithm allowlist, no client org trust.
 */
import crypto from 'crypto';
import { pool } from '../config/database';
import { AuthContext, OrgRole } from './types';

const ALLOWED_ALGORITHMS = new Set(['HS256', 'RS256']);
const CLOCK_SKEW_SEC = Number(process.env.JWT_CLOCK_SKEW_SEC || '60');

export class JwtValidationError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

type JwtPayload = {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  org_id?: string;
  organization_id?: string;
  role?: string;
};

function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function verifyHs256(token: string, secret: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtValidationError('MALFORMED_JWT', 'Malformed JWT');
  const [headerB64, payloadB64, sigB64] = parts;
  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
  } catch {
    throw new JwtValidationError('MALFORMED_JWT', 'Invalid JWT header');
  }
  if (!header.alg || !ALLOWED_ALGORITHMS.has(header.alg)) {
    throw new JwtValidationError('ALGORITHM_NOT_ALLOWED', `Algorithm ${header.alg} not allowed`);
  }
  if (header.alg === 'none') {
    throw new JwtValidationError('ALGORITHM_NOT_ALLOWED', 'Unsigned JWT rejected');
  }
  if (header.alg !== 'HS256') {
    throw new JwtValidationError('ALGORITHM_NOT_ALLOWED', 'Only HS256 local validation implemented');
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  const sigBuf = base64UrlDecode(sigB64);
  const expBuf = base64UrlDecode(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new JwtValidationError('INVALID_SIGNATURE', 'JWT signature invalid');
  }
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    throw new JwtValidationError('MALFORMED_JWT', 'Invalid JWT payload');
  }
  return payload;
}

function validateClaims(payload: JwtPayload): JwtPayload {
  const now = Math.floor(Date.now() / 1000);
  const expectedIss = process.env.JWT_ISSUER;
  const expectedAud = process.env.JWT_AUDIENCE;

  if (!payload.sub) throw new JwtValidationError('MISSING_SUB', 'JWT missing sub claim');
  if (payload.exp !== undefined && payload.exp + CLOCK_SKEW_SEC < now) {
    throw new JwtValidationError('TOKEN_EXPIRED', 'JWT expired');
  }
  if (payload.nbf !== undefined && payload.nbf - CLOCK_SKEW_SEC > now) {
    throw new JwtValidationError('TOKEN_NOT_YET_VALID', 'JWT not yet valid');
  }
  if (expectedIss && payload.iss !== expectedIss) {
    throw new JwtValidationError('WRONG_ISSUER', 'JWT issuer mismatch');
  }
  if (expectedAud) {
    const aud = payload.aud;
    const ok = Array.isArray(aud) ? aud.includes(expectedAud) : aud === expectedAud;
    if (!ok) throw new JwtValidationError('WRONG_AUDIENCE', 'JWT audience mismatch');
  }
  // Never trust role/org from JWT without DB membership verification
  return payload;
}

export async function authFromBearerJwt(token: string): Promise<AuthContext | null> {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  let payload: JwtPayload;
  try {
    payload = validateClaims(verifyHs256(token, secret));
  } catch {
    return null;
  }

  // Resolve org from DB membership — ignore client-forged org in token unless member verified
  const orgHint = payload.organization_id || payload.org_id;
  if (!orgHint) return null;

  const member = await pool.query(
    `SELECT m.role, m.status, o.status AS org_status
     FROM organization_members m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = $1 AND m.organization_id = $2`,
    [payload.sub, orgHint]
  );
  if (!member.rows.length) return null;
  if (member.rows[0].status !== 'active' || member.rows[0].org_status !== 'active') return null;

  return {
    userId: payload.sub!,
    organizationId: orgHint,
    role: member.rows[0].role as OrgRole,
    scopes: [],
    requestId: crypto.randomUUID(),
  };
}

export { verifyHs256, validateClaims };
